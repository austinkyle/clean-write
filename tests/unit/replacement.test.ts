import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { history, redo, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import { captureBlockSelection, replaceEditorBlocks, replaceEditorRange } from '@/features/editor/replacement';

function makeEditor(content: unknown) {
  return new Editor({ extensions: [StarterKit], content: content as never });
}

function makeHistoryEditor(content: unknown) {
  const schema = getSchema([StarterKit]);
  let currentState = EditorState.create({ schema, doc: schema.nodeFromJSON(content as never), plugins: [history()] });
  const fake = { get state() { return currentState; }, view: { dispatch(transaction: Parameters<typeof currentState.apply>[0]) { currentState = currentState.apply(transaction); }, focus() {} } };
  return fake as unknown as Editor;
}

describe('replaceEditorRange', () => {
  it('replaces the exact requested range as one undoable transaction', () => {
    const editor = makeHistoryEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use utilize here.' }] }] });
    const result = replaceEditorRange({ editor, from: 5, to: 12, expectedText: 'utilize', replacement: 'use' });
    expect(result.ok).toBe(true);
    expect(editor.state.doc.textContent).toBe('Use use here.');
    expect(undo(editor.state, (transaction) => editor.view.dispatch(transaction))).toBe(true);
    expect(editor.state.doc.textContent).toBe('Use utilize here.');
    expect(redo(editor.state, (transaction) => editor.view.dispatch(transaction))).toBe(true);
    expect(editor.state.doc.textContent).toBe('Use use here.');
  });

  it('rejects a stale or invalid range without mutating the document', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'utilize' }] }] });
    expect(replaceEditorRange({ editor, from: 1, to: 8, expectedText: 'changed', replacement: 'use' }).ok).toBe(false);
    expect(replaceEditorRange({ editor, from: 0, to: 99, expectedText: 'utilize', replacement: 'use' }).ok).toBe(false);
    expect(editor.getText()).toBe('utilize');
    editor.destroy();
  });

  it('preserves marks at an inline replacement boundary', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'utilize' }] }] });
    expect(replaceEditorRange({ editor, from: 1, to: 8, expectedText: 'utilize', replacement: 'use' }).ok).toBe(true);
    const textNode = editor.state.doc.firstChild?.firstChild;
    expect(textNode?.text).toBe('use');
    expect(textNode?.marks.some((mark) => mark.type.name === 'bold')).toBe(true);
    editor.destroy();
  });

  it('preserves a link mark for a replacement inside linked text', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: 'utilize' }] }] });
    expect(replaceEditorRange({ editor, from: 1, to: 8, expectedText: 'utilize', replacement: 'use' }).ok).toBe(true);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('link');
    editor.destroy();
  });
});

describe('replaceEditorBlocks', () => {
  it('replaces one top-level block with multiple native blocks as one undoable transaction', () => {
    const editor = makeHistoryEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dense explanation.' }] }] });
    const snapshot = captureBlockSelection(editor, 0, editor.state.doc.content.size, 'doc-1', 3, 'request-1');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const result = replaceEditorBlocks({ editor, snapshot: snapshot.value, currentDocumentId: 'doc-1', currentGeneration: 3, replacementSliceJson: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key idea' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A shorter explanation.' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First point' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second point' }] }] }] },
    ] });
    expect(result).toMatchObject({ ok: true, replacedBlockCount: 1, replacementBlockCount: 3 });
    expect(editor.state.doc.toJSON()).toMatchObject({ type: 'doc', content: [{ type: 'heading' }, { type: 'paragraph' }, { type: 'bulletList' }] });
    expect(undo(editor.state, (transaction) => editor.view.dispatch(transaction))).toBe(true);
    expect(editor.state.doc.textContent).toBe('Dense explanation.');
    expect(redo(editor.state, (transaction) => editor.view.dispatch(transaction))).toBe(true);
    expect(editor.state.doc.textContent).toContain('First point');
  });

  it('captures only exact top-level boundaries and rejects partial ranges', () => {
    const editor = makeHistoryEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First block.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second block.' }] }] });
    expect(captureBlockSelection(editor, 1, 5, 'doc-1', 0, 'request-1').ok).toBe(false);
    const snapshot = captureBlockSelection(editor, 0, editor.state.doc.child(0).nodeSize, 'doc-1', 0, 'request-2');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.topLevelStart).toBe(0);
    expect(snapshot.value.topLevelEnd).toBe(1);
    expect(snapshot.value.expectedSourceSliceJson[0]?.type).toBe('paragraph');
  });

  it('replaces multiple contiguous top-level blocks with multiple blocks', () => {
    const editor = makeHistoryEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First.' }] }, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Second.' }] }] });
    const snapshot = captureBlockSelection(editor, 0, editor.state.doc.content.size, 'doc-1', 0, 'request-multi');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const result = replaceEditorBlocks({ editor, snapshot: snapshot.value, currentDocumentId: 'doc-1', currentGeneration: 0, replacementSliceJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Combined.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Still native.' }] }] });
    expect(result).toMatchObject({ ok: true, replacedBlockCount: 2, replacementBlockCount: 2 });
    expect(editor.state.doc.textContent).toBe('Combined.Still native.');
  });

  it('rejects stale generation, document, source, and boundary proofs without mutation', () => {
    const editor = makeHistoryEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original.' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Keep.' }] }] });
    const firstSize = editor.state.doc.child(0).nodeSize;
    const snapshot = captureBlockSelection(editor, 0, firstSize, 'doc-1', 2, 'request-1');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const replacement = [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Changed.' }] }];
    expect(replaceEditorBlocks({ editor, snapshot: snapshot.value, currentDocumentId: 'doc-2', currentGeneration: 2, replacementSliceJson: replacement })).toMatchObject({ ok: false, reason: 'document-mismatch' });
    expect(replaceEditorBlocks({ editor, snapshot: snapshot.value, currentDocumentId: 'doc-1', currentGeneration: 3, replacementSliceJson: replacement })).toMatchObject({ ok: false, reason: 'generation-mismatch' });
    expect(replaceEditorBlocks({ editor, snapshot: { ...snapshot.value, sourceHash: 'wrong' }, currentDocumentId: 'doc-1', currentGeneration: 2, replacementSliceJson: replacement })).toMatchObject({ ok: false, reason: 'stale-finding' });
    expect(editor.state.doc.textContent).toBe('Original.Keep.');
  });

  it('rejects invalid replacement structures without mutating the source', () => {
    const editor = makeHistoryEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original.' }] }] });
    const snapshot = captureBlockSelection(editor, 0, editor.state.doc.content.size, 'doc-1', 0, 'request-1');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const result = replaceEditorBlocks({ editor, snapshot: snapshot.value, currentDocumentId: 'doc-1', currentGeneration: 0, replacementSliceJson: [{ type: 'table' } as never] });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-replacement' });
    expect(editor.state.doc.textContent).toBe('Original.');
  });
});
