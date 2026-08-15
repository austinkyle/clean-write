import { parseDocumentContent, type TiptapNode } from '@/features/documents/content';
import { SkimmableResponseSchema } from './schemas';
import type { SkimmableBlock, SkimmableInline, SkimmableResponse } from './types';

function inlineText(block: SkimmableBlock) {
  const runs: SkimmableInline = 'items' in block ? block.items.flatMap((item) => item.content) : block.content;
  return runs.map((run) => run.text).join('');
}

function normalizeInlineMarks(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.marks !== null) return value;
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'marks'));
}

export function normalizeSkimmableProviderResponse(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.fragment)) return input;
  return {
    ...record,
    fragment: record.fragment.map((block) => {
      if (!block || typeof block !== 'object') return block;
      const blockRecord = block as Record<string, unknown>;
      if (Array.isArray(blockRecord.content)) return { ...blockRecord, content: blockRecord.content.map(normalizeInlineMarks) };
      if (Array.isArray(blockRecord.items)) {
        return {
          ...blockRecord,
          items: blockRecord.items.map((item) => item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content)
            ? { ...(item as Record<string, unknown>), content: ((item as Record<string, unknown>).content as unknown[]).map(normalizeInlineMarks) }
            : item),
        };
      }
      return block;
    }),
  };
}

export function validateSkimmableResponse(input: unknown, sourceLength?: number): SkimmableResponse {
  const parsed = SkimmableResponseSchema.parse(input);
  const outputLength = parsed.fragment.reduce((total, block) => total + inlineText(block).length, 0);
  const allowedLength = sourceLength === undefined ? 12_000 : Math.min(12_000, Math.ceil(sourceLength * 1.5) + 500);
  if (outputLength > allowedLength) throw new Error('Skimmable output exceeds the allowed output size.');
  return parsed;
}

function toInline(content: SkimmableInline) {
  return content.map((run) => ({
    type: 'text' as const,
    text: run.text,
    ...(run.marks?.length ? { marks: run.marks.map((mark) => ({ type: mark.type as 'bold' | 'italic' })) } : {}),
  }));
}

export function skimmableAstToCanonicalFragment(input: unknown, sourceLength?: number): ReadonlyArray<TiptapNode> {
  const response = validateSkimmableResponse(input, sourceLength);
  const fragment = response.fragment.map((block): TiptapNode => {
    if (block.type === 'paragraph') return { type: 'paragraph', content: toInline(block.content) };
    if (block.type === 'heading') return { type: 'heading', attrs: { level: block.level }, content: toInline(block.content) };
    return {
      type: block.type,
      content: block.items.map((item) => ({ type: 'listItem', content: [{ type: 'paragraph', content: toInline(item.content) }] })),
    };
  });
  return parseDocumentContent({ type: 'doc', content: fragment }).content;
}
