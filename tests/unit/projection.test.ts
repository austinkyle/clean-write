import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { mapTextRange, projectDocument } from '@/features/analysis/projection';

const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } })]);
const makeDoc = (content: unknown[]) => schema.nodeFromJSON({ type: 'doc', content });

describe('analysis projection', () => {
  it('projects blocks, marks, hard breaks and separators with exact PM positions', () => {
    const doc = makeDoc([
      { type: 'paragraph', content: [{ type: 'text', text: 'Same ' }, { type: 'text', marks: [{ type: 'bold' }], text: 'Same' }, { type: 'hardBreak' }, { type: 'text', text: 'again.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Same' }] },
    ]);
    const projection = projectDocument(doc);
    expect(projection.text).toBe('Same Same\nagain.\nSame');
    expect(projection.segments.some((segment) => segment.kind === 'block_separator' && segment.pmFrom === null)).toBe(true);
    expect(mapTextRange(projection, 0, 4)).toEqual({ pmFrom: 1, pmTo: 5 });
    expect(mapTextRange(projection, 5, 9)).toEqual({ pmFrom: 6, pmTo: 10 });
    expect(mapTextRange(projection, 17, 21)).toEqual({ pmFrom: 19, pmTo: 23 });
    expect(mapTextRange(projection, 9, 10)).toEqual({ pmFrom: 10, pmTo: 11 });
    expect(mapTextRange(projection, 16, 17)).toBeNull();
  });

  it('keeps Unicode offsets in UTF-16 and maps a sentence across inline nodes', () => {
    const doc = makeDoc([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: '😀 world.' }] }]);
    const projection = projectDocument(doc);
    expect(projection.text).toBe('Hi 😀 world.');
    expect(projection.text.indexOf('world')).toBe(6);
    expect(mapTextRange(projection, 3, projection.text.length)).toEqual({ pmFrom: 4, pmTo: 13 });
  });
});
