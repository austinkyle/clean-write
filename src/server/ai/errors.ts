export type AIErrorCode = 'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_INVALID_RESPONSE' | 'AI_OUTPUT_LIMIT' | 'AI_ABORTED' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_INPUT_TOO_LARGE' | 'AI_UNAUTHORIZED';

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
  constructor(code: AIErrorCode, message: string, retryable = false) { super(message); this.name = 'AIError'; this.code = code; this.retryable = retryable; }
}

export function normalizeAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new AIError('AI_ABORTED', 'The AI request was cancelled.');
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 0;
  if (status === 401 || status === 403) return new AIError('AI_UNAUTHORIZED', 'The OpenAI API key is invalid or unavailable.');
  if (status === 429) return new AIError('AI_RATE_LIMITED', 'AI is receiving too many requests. Try again shortly.', true);
  if (status === 408 || status >= 500) return new AIError('AI_PROVIDER_UNAVAILABLE', 'AI is temporarily unavailable. Try again shortly.', true);
  if (error instanceof Error && /timeout|timed out/iu.test(error.message)) return new AIError('AI_TIMEOUT', 'The rewrite took too long. Try again.');
  return new AIError('AI_PROVIDER_UNAVAILABLE', 'AI is temporarily unavailable.');
}
