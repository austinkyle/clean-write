import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import type { MappedFinding } from '@/features/analysis/types';
import { fnv1a } from '@/features/analysis/normalize';
import { parseDocumentContent, type TiptapNode } from '@/features/documents/content';
import { closeHistory } from '@tiptap/pm/history';

export type ReplaceEditorRangeInput = {
  editor: Editor;
  from: number;
  to: number;
  expectedText: string;
  replacement: string;
  documentId?: string;
  currentDocumentId?: string;
  editorGeneration?: number;
  currentGeneration?: number;
};

export type ReplaceEditorRangeResult =
  | { ok: true; from: number; to: number; replacement: string }
  | { ok: false; reason: 'invalid-range' | 'stale-finding' | 'document-mismatch' | 'generation-mismatch' };
export type ReplacementRequest =
  | { finding: MappedFinding; replacement: string }
  | { documentId: string; editorGeneration: number; from: number; to: number; expectedText: string; replacement: string };

export type BlockSelectionSnapshot = {
  requestId: string;
  documentId: string;
  editorGeneration: number;
  from: number;
  to: number;
  topLevelStart: number;
  topLevelEnd: number;
  expectedSourceSliceJson: ReadonlyArray<TiptapNode>;
  sourceHash: string;
};

export type CaptureBlockSelectionResult =
  | { ok: true; value: BlockSelectionSnapshot }
  | { ok: false; reason: 'invalid-range' };

export type ReplaceEditorBlocksInput = {
  editor: Editor;
  snapshot: BlockSelectionSnapshot;
  currentDocumentId: string;
  currentGeneration: number;
  replacementSliceJson: ReadonlyArray<TiptapNode>;
};
export type BlockReplacementRequest = Omit<ReplaceEditorBlocksInput, 'editor'>;

export type ReplaceEditorBlocksResult =
  | { ok: true; from: number; to: number; replacedBlockCount: number; replacementBlockCount: number }
  | { ok: false; reason: 'invalid-range' | 'stale-finding' | 'document-mismatch' | 'generation-mismatch' | 'invalid-replacement' };

function normalizeComparedText(value: string) {
  return value.replace(/\r\n?/gu, '\n');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

type TopLevelBoundary = { index: number; from: number; to: number };

function topLevelBoundaries(doc: ProseMirrorNode): TopLevelBoundary[] {
  const boundaries: TopLevelBoundary[] = [];
  doc.forEach((node, offset, index) => boundaries.push({ index, from: offset, to: offset + node.nodeSize }));
  return boundaries;
}

function matchingTopLevelRange(doc: ProseMirrorNode, from: number, to: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > doc.content.size) return null;
  const boundaries = topLevelBoundaries(doc);
  const start = boundaries.find((boundary) => boundary.from === from);
  const end = boundaries.find((boundary) => boundary.to === to);
  if (!start || !end || start.index > end.index) return null;
  return { start, end, count: end.index - start.index + 1 };
}

function canonicalSlice(doc: ProseMirrorNode, from: number, to: number): ReadonlyArray<TiptapNode> | null {
  try {
    const content = doc.slice(from, to).content.toJSON();
    const parsed = parseDocumentContent({ type: 'doc', content });
    return parsed.content;
  } catch {
    return null;
  }
}

function sameCanonicalValue(left: unknown, right: unknown) {
  return stableSerialize(left) === stableSerialize(right);
}

export function captureBlockSelection(editor: Editor, from: number, to: number, documentId: string, editorGeneration: number, requestId: string): CaptureBlockSelectionResult {
  const range = matchingTopLevelRange(editor.state.doc, from, to);
  const slice = range ? canonicalSlice(editor.state.doc, from, to) : null;
  if (!range || !slice || !slice.length) return { ok: false, reason: 'invalid-range' };
  return {
    ok: true,
    value: {
      requestId,
      documentId,
      editorGeneration,
      from,
      to,
      topLevelStart: range.start.index,
      topLevelEnd: range.end.index + 1,
      expectedSourceSliceJson: slice,
      sourceHash: fnv1a(stableSerialize(slice)),
    },
  };
}

/**
 * The only editor mutation path for a structural replacement. The current
 * source slice is proved again immediately before one history transaction.
 */
export function replaceEditorBlocks(input: ReplaceEditorBlocksInput): ReplaceEditorBlocksResult {
  const { editor, snapshot, replacementSliceJson } = input;
  if (snapshot.documentId !== input.currentDocumentId) return { ok: false, reason: 'document-mismatch' };
  if (snapshot.editorGeneration !== input.currentGeneration) return { ok: false, reason: 'generation-mismatch' };

  const currentRange = matchingTopLevelRange(editor.state.doc, snapshot.from, snapshot.to);
  if (!currentRange || currentRange.start.index !== snapshot.topLevelStart || currentRange.end.index + 1 !== snapshot.topLevelEnd) return { ok: false, reason: 'invalid-range' };
  const currentSlice = canonicalSlice(editor.state.doc, snapshot.from, snapshot.to);
  if (!currentSlice || !sameCanonicalValue(currentSlice, snapshot.expectedSourceSliceJson) || fnv1a(stableSerialize(currentSlice)) !== snapshot.sourceHash) return { ok: false, reason: 'stale-finding' };

  let parsedReplacement: ReadonlyArray<TiptapNode>;
  try {
    parsedReplacement = parseDocumentContent({ type: 'doc', content: replacementSliceJson }).content;
    if (!parsedReplacement.length) return { ok: false, reason: 'invalid-replacement' };
  } catch {
    return { ok: false, reason: 'invalid-replacement' };
  }

  try {
    const nodes = parsedReplacement.map((node) => editor.state.schema.nodeFromJSON(node as never));
    const transaction = closeHistory(editor.state.tr).replaceWith(snapshot.from, snapshot.to, Fragment.fromArray(nodes));
    transaction.setMeta('clearwrite-block-replacement', true);
    editor.view.dispatch(transaction);
    try { editor.view.focus(); } catch { /* headless tests have no mounted view; browser editors do */ }
    return { ok: true, from: snapshot.from, to: snapshot.to, replacedBlockCount: currentRange.count, replacementBlockCount: parsedReplacement.length };
  } catch {
    return { ok: false, reason: 'invalid-replacement' };
  }
}

/**
 * The only editor mutation path for local, grammar, and future AI replacements.
 * It validates the captured document snapshot before creating one ProseMirror
 * history transaction; callers never recover a range by searching text.
 */
export function replaceEditorRange(input: ReplaceEditorRangeInput): ReplaceEditorRangeResult {
  const { editor, from, to, expectedText, replacement } = input;
  if (input.documentId !== undefined && input.currentDocumentId !== undefined && input.documentId !== input.currentDocumentId) return { ok: false, reason: 'document-mismatch' };
  if (input.editorGeneration !== undefined && input.currentGeneration !== undefined && input.editorGeneration !== input.currentGeneration) return { ok: false, reason: 'generation-mismatch' };
  const max = editor.state.doc.content.size;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > max || typeof replacement !== 'string') return { ok: false, reason: 'invalid-range' };

  let currentText: string;
  try {
    currentText = editor.state.doc.textBetween(from, to, '\n', '\n');
  } catch {
    return { ok: false, reason: 'invalid-range' };
  }
  if (normalizeComparedText(currentText) !== normalizeComparedText(expectedText)) return { ok: false, reason: 'stale-finding' };

  const transaction = closeHistory(editor.state.tr).insertText(replacement, from, to);
  transaction.setMeta('clearwrite-replacement', true);
  editor.view.dispatch(transaction);
  try { editor.view.focus(); } catch { /* headless tests have no mounted view; browser editors do */ }
  return { ok: true, from, to, replacement };
}
