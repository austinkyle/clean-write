import { describe, expect, it } from 'vitest';

import { DEFAULT_DOCUMENT_CONTENT, parseDocumentContent, toPlainText } from '@/features/documents/content';

describe('canonical document content', () => {
  it('accepts the supported editor schema and derives plain text', () => {
    const content = parseDocumentContent({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'A thought.' }] },
      ],
    });

    expect(toPlainText(content)).toBe('A title\nA thought.');
  });

  it('rejects unsupported nodes and falls back to a valid empty document', () => {
    expect(() => parseDocumentContent({ type: 'doc', content: [{ type: 'image' }] })).toThrow('Invalid document content');
    expect(DEFAULT_DOCUMENT_CONTENT).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('accepts a schema-shaped hard break but rejects unsupported inline nodes', () => {
    const content = parseDocumentContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }, { type: 'hardBreak' }, { type: 'text', text: 'after' }] }],
    });
    expect(content.content[0]?.content?.map((node) => node.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(() => parseDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image' }] }] })).toThrow('Invalid document content');
    expect(() => parseDocumentContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'hardBreak', attrs: {} }] }] })).toThrow('Invalid document content');
  });
});
