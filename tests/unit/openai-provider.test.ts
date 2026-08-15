import OpenAI from 'openai';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { OpenAIProvider } from '@/server/ai/openai-provider';
import type { ProviderStructuredRequest } from '@/features/ai/types';

function request(signal?: AbortSignal): ProviderStructuredRequest<{ value: string }> {
  return {
    action: 'simplify',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
    maxOutputTokens: 100,
    instructions: 'Rewrite the text.',
    dataPacket: JSON.stringify({ target: 'A sentence.' }),
    schemaName: 'cleanwrite_rewrite',
    schema: z.object({ value: z.string() }),
    signal,
    store: false,
  };
}

describe('OpenAI structured provider boundary', () => {
  it('uses Responses structured output without persistence or tools', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedOptions: Record<string, unknown> | undefined;
    const fakeClient = {
      responses: {
        parse: async (body: Record<string, unknown>, options: Record<string, unknown>) => {
          capturedBody = body;
          capturedOptions = options;
          return { status: 'completed', output_parsed: { value: 'A clear sentence.' } };
        },
      },
    } as unknown as OpenAI;

    const result = await new OpenAIProvider('test-key', fakeClient).executeStructured(request());

    expect(result).toEqual({ value: 'A clear sentence.' });
    expect(capturedBody?.store).toBe(false);
    expect(capturedBody?.tools).toBeUndefined();
    expect((capturedBody?.text as { format: { type: string } }).format.type).toBe('json_schema');
    expect(capturedOptions?.maxRetries).toBe(0);
    expect(capturedOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a caller cancellation to a non-retryable aborted error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fakeClient = {
      responses: {
        parse: async (_body: unknown, options: { signal: AbortSignal }) => {
          if (options.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          await new Promise<void>((_, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
          });
          return { status: 'completed', output_parsed: { value: 'never' } };
        },
      },
    } as unknown as OpenAI;

    await expect(new OpenAIProvider('test-key', fakeClient).executeStructured(request(controller.signal))).rejects.toMatchObject({ code: 'AI_ABORTED', retryable: false });
  });

  it('maps the bounded provider deadline to a clean timeout error', async () => {
    const fakeClient = {
      responses: {
        parse: async (_body: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
      },
    } as unknown as OpenAI;

    await expect(new OpenAIProvider('test-key', fakeClient, 5).executeStructured(request())).rejects.toMatchObject({ code: 'AI_TIMEOUT', retryable: false });
  });

  it('normalizes a structured safety refusal without exposing provider payloads', async () => {
    const fakeClient = {
      responses: {
        parse: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'internal detail' }] }], output_parsed: null }),
      },
    } as unknown as OpenAI;

    await expect(new OpenAIProvider('test-key', fakeClient).executeStructured(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', message: 'AI could not safely rewrite that text.' });
  });

  it('reports missing configuration before making a provider call', async () => {
    await expect(new OpenAIProvider(undefined).executeStructured(request())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});
