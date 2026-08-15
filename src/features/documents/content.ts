import { z } from 'zod';

export type TiptapMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; attrs: { href: string; target?: string | null; rel?: string | null; class?: string | null } };

export type TiptapNode = {
  type: 'doc' | 'paragraph' | 'heading' | 'blockquote' | 'bulletList' | 'orderedList' | 'listItem' | 'text' | 'hardBreak';
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export type DocumentContent = { type: 'doc'; content: TiptapNode[] };

const RawNodeSchema = z.object({
  type: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(z.unknown()).optional(),
  text: z.string().optional(),
  marks: z.array(z.unknown()).optional(),
});

const RawMarkSchema = z.object({
  type: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const SAFE_LINK_PROTOCOL = /^(https?:|mailto:|\/|#)/i;
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem']);

function invalidContent(): never {
  throw new Error('Invalid document content');
}

function parseMark(input: unknown): TiptapMark {
  const result = RawMarkSchema.safeParse(input);
  if (!result.success) return invalidContent();

  if (result.data.type === 'bold' || result.data.type === 'italic') {
    return { type: result.data.type };
  }

  if (result.data.type === 'link') {
    const href = result.data.attrs?.href;
    if (typeof href !== 'string' || href.length > 2048 || !SAFE_LINK_PROTOCOL.test(href)) return invalidContent();
    return {
      type: 'link',
      attrs: {
        href,
        target: typeof result.data.attrs?.target === 'string' ? result.data.attrs.target : null,
        rel: typeof result.data.attrs?.rel === 'string' ? result.data.attrs.rel : null,
        class: typeof result.data.attrs?.class === 'string' ? result.data.attrs.class : null,
      },
    };
  }

  return invalidContent();
}

function parseNode(input: unknown, expected: TiptapNode['type'] | 'block' | 'inline'): TiptapNode {
  const result = RawNodeSchema.safeParse(input);
  if (!result.success) return invalidContent();

  const { type, attrs, content, text, marks } = result.data;
  if (expected === 'inline' && type !== 'text' && type !== 'hardBreak') return invalidContent();
  if (expected === 'block' && !BLOCK_TYPES.has(type)) return invalidContent();
  if (expected !== 'block' && expected !== 'inline' && type !== expected) return invalidContent();

  if (type === 'text') {
    if (!text || text.length > 100_000) return invalidContent();
    const parsedMarks = marks?.map(parseMark);
    if (marks && !parsedMarks) return invalidContent();
    return { type, text, ...(parsedMarks ? { marks: parsedMarks } : {}) };
  }

  if (type === 'hardBreak') {
    if (content !== undefined || text !== undefined || marks !== undefined || attrs !== undefined) return invalidContent();
    return { type };
  }

  if (type === 'heading') {
    const level = attrs?.level;
    if (level !== 1 && level !== 2 && level !== 3) return invalidContent();
  }

  if (type === 'orderedList') {
    const start = attrs?.start;
    if (start !== undefined && (typeof start !== 'number' || !Number.isInteger(start) || start < 1)) return invalidContent();
  }

  const children = content?.map((child) => {
    if (type === 'doc') return parseNode(child, 'block');
    if (type === 'blockquote') return parseNode(child, 'block');
    if (type === 'bulletList' || type === 'orderedList') return parseNode(child, 'listItem');
    if (type === 'listItem') return parseNode(child, 'paragraph');
    return parseNode(child, 'inline');
  });

  if (type !== 'text' && content === undefined && type !== 'paragraph' && type !== 'heading') return invalidContent();
  if (type === 'listItem' && (!children || children.length === 0)) return invalidContent();

  return {
    type: type as TiptapNode['type'],
    ...(attrs ? { attrs } : {}),
    ...(children ? { content: children } : {}),
  };
}

export const DEFAULT_DOCUMENT_CONTENT: DocumentContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export function parseDocumentContent(input: unknown): DocumentContent {
  const parsed = parseNode(input, 'doc');
  if (parsed.type !== 'doc') return invalidContent();
  return parsed as DocumentContent;
}

export function toPlainText(content: DocumentContent): string {
  const chunks: string[] = [];

  function visit(node: TiptapNode) {
    if (node.type === 'text') {
      chunks.push(node.text ?? '');
      return;
    }
    node.content?.forEach(visit);
    if (node.type !== 'doc' && node.type !== 'listItem') chunks.push('\n');
  }

  visit(content);
  return chunks.join('').replace(/\n+$/u, '');
}
