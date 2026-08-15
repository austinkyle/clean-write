import { describe, expect, it } from 'vitest';
import { analyzeProjection, calculateReadability, estimateSyllables, normalizeFindings, segmentBlock, type Projection } from '@/features/analysis';

const projection = (text: string): Projection => ({ text, segments: [{ kind: 'text', textStart: 0, textEnd: text.length, pmFrom: 1, pmTo: text.length + 1, blockIndex: 0 }], blocks: [{ index: 0, nodeType: 'paragraph', textStart: 0, textEnd: text.length, pmContentFrom: 1, pmContentTo: text.length + 1, isEmpty: !text }] });

describe('deterministic analysis', () => {
  it('segments practical sentence cases with offsets', () => {
    expect(segmentBlock('Dr. Smith arrived. It cost 3.14 dollars. “Really?” Yes… now.').map((item) => item.text)).toEqual(['Dr. Smith arrived.', 'It cost 3.14 dollars.', '“Really?”', 'Yes… now.']);
  });

  it('calculates deterministic statistics and readability', () => {
    const result = analyzeProjection(projection("This is a simple sentence.\nAnother paragraph."), 'default');
    expect(result.statistics.words).toBe(7);
    expect(result.statistics.sentences).toBe(2);
    expect(result.statistics.readingMinutes).toBe(1);
    expect(result.readability.grade).toBeTypeOf('number');
    expect(calculateReadability('', [], 'default').grade).toBeNull();
    expect(calculateReadability('A clear sentence.', segmentBlock('A clear sentence.'), 'accessible').hardThreshold).toBe(7.5);
    expect(calculateReadability('A clear sentence.', segmentBlock('A clear sentence.'), 'technical').veryHardThreshold).toBe(15.5);
  });

  it('detects local style findings with exact ranges and alternatives', () => {
    const result = analyzeProjection(projection('The process was implemented and really slowly utilize.'), 'default');
    expect(result.findings.map((finding) => finding.category)).toEqual(expect.arrayContaining(['complex_word', 'qualifier', 'adverb', 'passive_voice']));
    const complex = result.findings.find((finding) => finding.category === 'complex_word');
    expect(complex?.excerpt).toBe('utilize');
    expect(complex?.suggestions?.[0]?.replacement).toBe('use');
    expect(result.findings.every((finding) => projection('The process was implemented and really slowly utilize.').text.slice(finding.textStart, finding.textEnd) === finding.excerpt)).toBe(true);
  });

  it('classifies hard and very-hard sentences exclusively at the selected target', () => {
    const hardText = 'Readers consider the thoughtful design before writing a practical response for others.';
    const hardProjection = projection(hardText);
    expect(analyzeProjection(hardProjection, 'default').findings.some((finding) => finding.category === 'hard_sentence')).toBe(true);
    expect(analyzeProjection(hardProjection, 'default').findings.some((finding) => finding.category === 'very_hard_sentence')).toBe(false);
    expect(analyzeProjection(hardProjection, 'technical').findings.some((finding) => finding.category.includes('sentence'))).toBe(false);
    const veryHard = analyzeProjection(projection('Complexity complexity complexity complexity complexity complexity complexity complexity complexity complexity complexity complexity.'), 'default').findings.filter((finding) => finding.category.includes('sentence'));
    expect(veryHard.map((finding) => finding.category)).toEqual(['very_hard_sentence']);
  });

  it('handles syllable exceptions and silent e', () => {
    expect(estimateSyllables('cat')).toBe(1);
    expect(estimateSyllables('make')).toBe(1);
    expect(estimateSyllables('table')).toBe(2);
    expect(estimateSyllables('queue')).toBe(1);
    expect(estimateSyllables('rhythm')).toBe(2);
    expect(estimateSyllables('')).toBe(0);
  });

  it('drops malformed findings during normalization', () => {
    expect(normalizeFindings([{ id: '', category: 'adverb', severity: 'info', textStart: 0, textEnd: 4, excerpt: 'slow', message: '', explanation: '', metadata: {} }], 'fast')).toEqual([]);
  });
});
