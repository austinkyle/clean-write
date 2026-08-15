/* eslint-disable no-unused-vars */
import { analyzeProjection } from '@/features/analysis/pipeline';
import type { AnalyzeRequest, AnalyzeResponse, Projection } from '@/features/analysis/types';

const workerScope = self as unknown as { onmessage: ((...args: [MessageEvent<AnalyzeRequest>]) => void) | null; postMessage: (...args: [AnalyzeResponse]) => void };
workerScope.onmessage = (event) => {
  const request = event.data;
  if (request?.type !== 'analyze') return;
  const projection = { text: request.projection.text, blocks: request.projection.blocks.map((block) => ({ ...block, pmContentFrom: 0, pmContentTo: 0 })) , segments: [] } as Projection;
  const result = analyzeProjection(projection, request.settings.readabilityTarget);
  workerScope.postMessage({ type: 'result', requestId: request.requestId, documentId: request.documentId, editorGeneration: request.editorGeneration, ...result });
};
