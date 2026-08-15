import type { ReadabilityResult, ReadabilityTarget, SentenceSpan, TextFinding } from './types';
import { estimateSyllables } from './syllables';
import { tokenize } from './segmentation';

export const TARGETS: Record<ReadabilityTarget, { target: number; hard: number; veryHard: number }> = {
  accessible: { target: 7, hard: 7.5, veryHard: 10.5 },
  default: { target: 9, hard: 9.5, veryHard: 12.5 },
  technical: { target: 12, hard: 12.5, veryHard: 15.5 },
};

export function calculateReadability(text: string, sentences: SentenceSpan[], target: ReadabilityTarget): ReadabilityResult {
  const words = tokenize(text).length;
  const syllables = tokenize(text).reduce((sum, token) => sum + estimateSyllables(token.text), 0);
  const score = words < 3 || sentences.length === 0 ? null : 0.39 * (words / sentences.length) + 11.8 * (syllables / words) - 15.59;
  const preset = TARGETS[target];
  return { grade: score === null ? null : Math.round(score * 10) / 10, target, hardThreshold: preset.hard, veryHardThreshold: preset.veryHard };
}

export function detectSentenceDifficulty(sentences: SentenceSpan[], target: ReadabilityTarget): TextFinding[] {
  const preset = TARGETS[target];
  return sentences.flatMap((sentence) => {
    const words = sentence.words;
    if (words.length < 8) return [];
    const syllables = words.reduce((sum, token) => sum + estimateSyllables(token.text), 0);
    const grade = 0.39 * words.length + 11.8 * (syllables / words.length) - 15.59;
    const commas = (sentence.text.match(/[,;]/gu) ?? []).length;
    const conjunctions = words.filter((word) => /^(and|but|or|nor|for|yet|so)$/iu.test(word.text)).length;
    const lengthPenalty = words.length >= 35 ? 1.5 : words.length >= 25 ? 0.5 : 0;
    const clausePenalty = commas >= 5 ? 1 : commas >= 3 ? 0.5 : 0;
    const nestingPenalty = /[([{][\s\S]*[)\]}]/u.test(sentence.text) || conjunctions >= 3 ? 0.5 : 0;
    const difficultyScore = grade + lengthPenalty + clausePenalty + nestingPenalty;
    const category = difficultyScore > preset.veryHard && words.length >= 12 ? 'very_hard_sentence' : difficultyScore > preset.hard ? 'hard_sentence' : null;
    if (!category) return [];
    return [{ id: '', category, severity: category === 'very_hard_sentence' ? 'critical' : 'warning', textStart: sentence.textStart, textEnd: sentence.textEnd, excerpt: sentence.text, message: category === 'very_hard_sentence' ? 'Very hard sentence' : 'Hard sentence', explanation: 'This sentence may be difficult to read at the selected target.', confidence: 'high', metadata: { grade, difficultyScore, words: words.length, lengthPenalty, clausePenalty, nestingPenalty } } satisfies TextFinding];
  });
}
