import type { SentenceSpan, TextFinding } from '../types';
import { QUALIFIERS } from '../dictionaries/qualifiers';

export function detectQualifiers(text: string, sentences: SentenceSpan[]): TextFinding[] {
  const findings: TextFinding[] = [];
  for (const sentence of sentences) {
    for (const entry of [...QUALIFIERS].sort((a, b) => b.phrase.length - a.phrase.length)) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${entry.phrase.replace(/ /gu, '\\s+?')}(?![\\p{L}\\p{N}])`, 'giu');
      const local = sentence.text;
      for (const match of local.matchAll(pattern)) {
        const start = sentence.textStart + match.index!;
        findings.push({ id: '', category: 'qualifier', severity: 'info', textStart: start, textEnd: start + match[0].length, excerpt: text.slice(start, start + match[0].length), message: entry.confidence === 'low' ? 'Possible qualifier' : 'Qualifier', explanation: entry.removable ? 'This word may weaken the sentence and could be removed.' : 'This phrase may soften a claim.', confidence: entry.confidence, metadata: { removable: entry.removable } });
      }
    }
  }
  return findings;
}
