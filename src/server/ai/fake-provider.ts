/* eslint-disable no-unused-vars */
import type { AIProvider, ProviderStructuredRequest } from '@/features/ai/types';

export type FakeProviderHandler = (request: ProviderStructuredRequest<unknown>) => Promise<unknown>;
export class FakeAIProvider implements AIProvider {
  readonly id = 'fake';
  constructor(private readonly handler: FakeProviderHandler, private readonly configured = true) {}
  isConfigured() { return this.configured; }
  executeStructured<T>(request: ProviderStructuredRequest<T>) { return this.handler(request) as Promise<T>; }
}

export const DEFAULT_SKIMMABLE_RESPONSE = {
  fragment: [
    { type: 'heading', level: 2, content: [{ type: 'text', text: 'Key idea' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A clearer explanation.' }] },
    { type: 'bulletList', items: [{ content: [{ type: 'text', text: 'First point' }] }, { content: [{ type: 'text', text: 'Second point' }] }] },
  ],
} as const;

export function createSkimmableFakeProvider(response: unknown = DEFAULT_SKIMMABLE_RESPONSE, configured = true) {
  return new FakeAIProvider(async (request) => {
    if (request.action !== 'make_skimmable') throw new Error('Unexpected fake AI action.');
    return response;
  }, configured);
}
