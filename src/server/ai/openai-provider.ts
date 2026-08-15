import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { AIError, normalizeAIError } from './errors';
import type { AIProvider, ProviderStructuredRequest } from '@/features/ai/types';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  private readonly client: OpenAI | null;
  constructor(apiKey = process.env.OPENAI_API_KEY, client?: OpenAI, private readonly timeoutMs = 20_000) { this.client = client ?? (apiKey ? new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 }) : null); }
  isConfigured() { return this.client !== null; }
  async executeStructured<T>(request: ProviderStructuredRequest<T>): Promise<T> {
    if (!this.client) throw new AIError('AI_UNAVAILABLE', 'Add your OpenAI API key to enable AI tools.');
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const abortListener = request.signal ? () => timeoutController.abort(request.signal?.reason) : undefined;
    if (request.signal?.aborted) timeoutController.abort(request.signal.reason);
    if (request.signal && abortListener) request.signal.addEventListener('abort', abortListener, { once: true });
    try {
      const response = await this.client.responses.parse({
        model: request.model,
        store: false,
        instructions: request.instructions,
        input: [{ role: 'user', content: request.dataPacket }],
        reasoning: { effort: request.reasoningEffort },
        max_output_tokens: request.maxOutputTokens,
        text: { format: zodTextFormat(request.schema, request.schemaName) },
      }, { signal: timeoutController.signal, maxRetries: 0 });
      if (response.status === 'incomplete') throw new AIError('AI_OUTPUT_LIMIT', 'The AI response was too long. Try a shorter selection.');
      const refusal = response.output?.some((item) => 'content' in item && Array.isArray(item.content) && item.content.some((content) => content.type === 'refusal'));
      if (refusal) throw new AIError('AI_INVALID_RESPONSE', 'AI could not safely rewrite that text.');
      if (response.output_parsed == null) throw new AIError('AI_INVALID_RESPONSE', 'AI returned no usable suggestion.');
      return request.schema.parse(response.output_parsed);
    } catch (error) {
      if (request.signal?.aborted) throw new AIError('AI_ABORTED', 'The AI request was cancelled.');
      if (timeoutController.signal.aborted) throw new AIError('AI_TIMEOUT', 'The rewrite took too long. Try again.');
      throw normalizeAIError(error);
    } finally {
      clearTimeout(timeoutId);
      if (request.signal && abortListener) request.signal.removeEventListener('abort', abortListener);
    }
  }
}
