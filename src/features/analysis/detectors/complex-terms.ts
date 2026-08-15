import type { TextFinding } from '../types';
import { SIMPLE_ALTERNATIVES } from '../dictionaries/simple-alternatives';

function preserveCase(original: string, replacement: string) {
  if (original.toUpperCase() === original) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) return replacement[0]?.toUpperCase() + replacement.slice(1);
  return replacement;
}

export function detectComplexTerms(text: string): TextFinding[] {
  const findings: TextFinding[] = [];
  for (const [phrase, replacement] of [...SIMPLE_ALTERNATIVES].sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/ /gu, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const original = match[0];
      findings.push({ id: '', category: 'complex_word', severity: 'info', textStart: start, textEnd: start + original.length, excerpt: original, message: 'Complex word', explanation: 'A simpler alternative may make this clearer.', confidence: 'high', suggestions: [{ label: preserveCase(original, replacement), replacement: preserveCase(original, replacement), kind: 'local' }], metadata: { lexiconKey: phrase } });
    }
  }
  return findings;
}
