import type { AnalysisResult, Projection, ReadabilityTarget } from './types';
import { segmentProjectionBlocks } from './segmentation';
import { calculateStatistics } from './statistics';
import { calculateReadability, detectSentenceDifficulty } from './readability';
import { detectAdverbs } from './detectors/adverbs';
import { detectQualifiers } from './detectors/qualifiers';
import { detectPassiveVoice } from './detectors/passive-voice';
import { detectComplexTerms } from './detectors/complex-terms';
import { normalizeFindings, fnv1a } from './normalize';

export function analyzeProjection(projection: Projection, target: ReadabilityTarget): AnalysisResult {
  const sentences = segmentProjectionBlocks(projection.text, projection.blocks);
  const findings = normalizeFindings([
    ...detectSentenceDifficulty(sentences, target),
    ...detectAdverbs(sentences),
    ...detectQualifiers(projection.text, sentences),
    ...detectPassiveVoice(sentences),
    ...detectComplexTerms(projection.text),
  ], projection.text);
  return { statistics: calculateStatistics(projection), readability: calculateReadability(projection.text, sentences, target), findings, textHash: fnv1a(projection.text) };
}
