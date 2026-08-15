import type { AnalyzeResponse } from './types';

export function isFreshAnalysisResponse(response: AnalyzeResponse, identity: { documentId: string; editorGeneration: number; lastAcceptedRequestId: number; textHash: string }): boolean {
  return response.type === 'result' && response.documentId === identity.documentId && response.editorGeneration === identity.editorGeneration && response.requestId > identity.lastAcceptedRequestId && response.textHash === identity.textHash;
}
