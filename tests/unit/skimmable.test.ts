import { describe, expect, it } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';

import { parseDocumentContent } from '@/features/documents/content';
import { SkimmableProviderResponseSchema, SkimmableRequestSchema, SkimmableResponseSchema } from '@/features/ai/schemas';
import { skimmableAstToCanonicalFragment, validateSkimmableResponse } from '@/features/ai/skimmable';
import { documentToHtml, documentToMarkdown, documentToText } from '@/features/import-export/formats';

const validResponse = {
  fragment: [
    { type: 'heading', level: 2, content: [{ type: 'text', text: 'Key idea' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A concise explanation.', marks: [{ type: 'bold' }] }] },
    { type: 'bulletList', items: [{ content: [{ type: 'text', text: 'First point' }] }, { content: [{ type: 'text', text: 'Second point', marks: [{ type: 'italic' }] }] }] },
  ],
} as const;

describe('Make Skimmable AST', () => {
  it('uses a Responses-compatible provider schema with required nullable marks', () => {
    const format = zodTextFormat(SkimmableProviderResponseSchema, 'clearwrite_skimmable');
    const firstBlock = (format.schema.properties as { fragment: { items: { anyOf: Array<{ properties: { content: { items: { properties: { marks: unknown }; required: string[] } } } }> } } }).fragment.items.anyOf[0];
    expect(firstBlock?.properties.content.items.required).toContain('marks');
    expect(firstBlock?.properties.content.items.properties.marks).toMatchObject({ anyOf: [{ type: 'array' }, { type: 'null' }] });
  });

  it('accepts the constrained structure and converts to canonical Tiptap JSON', () => {
    const parsed = validateSkimmableResponse(validResponse, 100);
    expect(parsed.fragment[2]?.type).toBe('bulletList');
    expect(skimmableAstToCanonicalFragment(parsed)).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key idea' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A concise explanation.', marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First point' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second point', marks: [{ type: 'italic' }] }] }] },
      ] },
    ]);
  });

  it('rejects unsupported nodes, links, malformed marks, and excessive depth', () => {
    expect(SkimmableResponseSchema.safeParse({ fragment: [{ type: 'blockquote', content: [{ type: 'text', text: 'No' }] }] }).success).toBe(false);
    expect(SkimmableResponseSchema.safeParse({ fragment: [{ type: 'paragraph', content: [{ type: 'text', text: 'No', marks: [{ type: 'link' }] }] }] }).success).toBe(false);
    expect(SkimmableResponseSchema.safeParse({ fragment: [{ type: 'paragraph', content: [{ type: 'text', text: 'No', marks: [{ type: 'bold' }, { type: 'bold' }] }] }] }).success).toBe(false);
    expect(SkimmableResponseSchema.safeParse({ fragment: [{ type: 'bulletList', items: [{ content: [{ type: 'text', text: 'nested', marks: [] }] }] }] }).success).toBe(false);
  });

  it('rejects oversized output relative to the selected source', () => {
    expect(() => validateSkimmableResponse({ fragment: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(1_000) }] }] }, 10)).toThrow('output');
  });

  it('rejects unknown keys and preserves deterministic conversion', () => {
    expect(SkimmableResponseSchema.safeParse({ ...validResponse, extra: true }).success).toBe(false);
    const first = skimmableAstToCanonicalFragment(validResponse);
    const second = skimmableAstToCanonicalFragment(JSON.parse(JSON.stringify(validResponse)) as typeof validResponse);
    expect(second).toEqual(first);
    expect(parseDocumentContent({ type: 'doc', content: first }).content).toEqual(first);
  });

  it('accepts only bounded Make Skimmable requests', () => {
    const request = {
      requestId: 'a0d4d7a6-7d0f-4dd6-9eb2-46bb8fd9d0f3',
      documentId: 'c6a1d34f-4e9b-4d3c-8b82-4bdf7c3e4b8c',
      editorGeneration: 1,
      source: { fragment: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dense source.' }] }], text: 'Dense source.', hash: 'hash' },
      context: { before: '', after: '' },
      dialect: 'us',
    };
    expect(SkimmableRequestSchema.safeParse(request).success).toBe(true);
    expect(SkimmableRequestSchema.safeParse({ ...request, source: { ...request.source, text: 'x'.repeat(8_001) } }).success).toBe(false);
  });

  it('exports converted output through ordinary HTML, Markdown, and TXT paths', () => {
    const content = parseDocumentContent({ type: 'doc', content: skimmableAstToCanonicalFragment(validResponse) });
    expect(documentToHtml(content)).toContain('<ul>');
    expect(documentToMarkdown(content)).toContain('- First point');
    expect(documentToText(content)).toContain('Second point');
    expect(JSON.stringify(content)).not.toContain('ai');
  });
});
