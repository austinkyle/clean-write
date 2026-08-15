import type { SentenceSpan, TextFinding } from '../types';
import { ADVERB_EXCEPTIONS } from '../dictionaries/adverb-exceptions';

export function detectAdverbs(sentences: SentenceSpan[]): TextFinding[] {
  return sentences.flatMap((sentence) => sentence.words.flatMap((token, index) => {
    const value = token.text.toLowerCase();
    if (!/^[a-z]+ly$/u.test(value) || ADVERB_EXCEPTIONS.has(value) || (token.text[0] === token.text[0]?.toUpperCase() && index > 0)) return [];
    return [{ id: '', category: 'adverb', severity: 'info', textStart: token.textStart, textEnd: token.textEnd, excerpt: token.text, message: 'Possible adverb', explanation: 'Adverbs can sometimes make writing less direct.', confidence: 'medium', metadata: {} } satisfies TextFinding];
  }));
}
