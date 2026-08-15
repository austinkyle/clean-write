import { describe, expect, it } from 'vitest';
import { isFreshAnalysisResponse } from '@/features/analysis';
import type { AnalyzeResponse } from '@/features/analysis/types';

const response = (requestId: number, generation: number, documentId = 'doc-1'): AnalyzeResponse => ({ type: 'result', requestId, editorGeneration: generation, documentId, textHash: 'hash', statistics: { characters: 0, letters: 0, words: 0, sentences: 0, paragraphs: 0, readingMinutes: 0 }, readability: { grade: null, target: 'default', hardThreshold: 9.5, veryHardThreshold: 12.5 }, findings: [] });

describe('analysis freshness', () => {
  it('accepts only the current document, generation, hash and newer request', () => {
    const identity = { documentId: 'doc-1', editorGeneration: 2, lastAcceptedRequestId: 0, textHash: 'hash' };
    expect(isFreshAnalysisResponse(response(2, 2), identity)).toBe(true);
    expect(isFreshAnalysisResponse(response(1, 1), identity)).toBe(false);
    expect(isFreshAnalysisResponse(response(3, 2, 'doc-2'), identity)).toBe(false);
  });
});
