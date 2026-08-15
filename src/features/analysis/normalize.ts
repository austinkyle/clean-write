import type { FindingCategory, TextFinding } from './types';

const CATEGORY_PRIORITY: Record<FindingCategory, number> = { grammar: 0, spelling: 1, punctuation: 2, complex_word: 3, passive_voice: 4, qualifier: 5, adverb: 6, very_hard_sentence: 7, hard_sentence: 8 };

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeFindings(findings: TextFinding[], text: string): TextFinding[] {
  return findings.filter((finding) => {
    if (!Number.isInteger(finding.textStart) || !Number.isInteger(finding.textEnd) || finding.textStart < 0 || finding.textEnd <= finding.textStart || finding.textEnd > text.length) return false;
    return text.slice(finding.textStart, finding.textEnd) === finding.excerpt;
  }).map((finding) => ({ ...finding, id: fnv1a(`analysis-v1:${finding.category}:${finding.textStart}:${finding.textEnd}:${finding.excerpt}`) })).sort((a, b) => a.textStart - b.textStart || (b.textEnd - b.textStart) - (a.textEnd - a.textStart) || CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category]);
}
