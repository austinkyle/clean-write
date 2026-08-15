/**
 * Architectural validation only: proves the absolute positions used by the
 * approved Tiptap schema before the analysis projection is implemented.
 */
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';

const schema = getSchema([
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
]);

describe('ProseMirror positions for the CleanWrite schema', () => {
  it('uses absolute text positions independent of inline marks and list nesting', () => {
    const document = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Same ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'Same' },
            { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }], text: ' link' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First item' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second item' }] }] },
          ],
        },
      ],
    });

    const textPositions: Array<{ text: string; pos: number }> = [];
    document.descendants((node, pos) => {
      if (node.isText) textPositions.push({ text: node.text ?? '', pos });
    });

    expect(textPositions).toEqual([
      { text: 'Plan', pos: 1 },
      { text: 'Same ', pos: 7 },
      { text: 'Same', pos: 12 },
      { text: ' link', pos: 16 },
      { text: 'First item', pos: 25 },
      { text: 'Second item', pos: 39 },
    ]);
    expect(document.textBetween(7, 21, '')).toBe('Same Same link');

    const decoration = Decoration.inline(7, 21, { class: 'analysis-hard' }, { findingId: 'fixture-hard' });
    const decorations = DecorationSet.create(document, [decoration]);
    expect(decorations.find(7, 21)[0]).toMatchObject({ from: 7, to: 21, spec: { findingId: 'fixture-hard' } });
  });
});
