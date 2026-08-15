'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import type { DocumentContent } from '@/features/documents/content';
import { AnalysisExtension, analysisPluginKey, type AnalysisMeta } from './analysis-extension';
import { mapTextRange, projectDocument } from '@/features/analysis/projection';
import { reconcileGrammarResponse } from '@/features/ai/grammar-reconciliation';
import { fnv1a } from '@/features/analysis/normalize';
import { GRAMMAR_CONFIG } from '@/features/ai/actions';
import { isFreshAnalysisResponse } from '@/features/analysis/freshness';
import { calculateStatistics } from '@/features/analysis/statistics';
import { TARGETS } from '@/features/analysis/readability';
import { captureBlockSelection, replaceEditorBlocks, replaceEditorRange, type BlockReplacementRequest, type ReplaceEditorBlocksResult, type ReplaceEditorRangeResult, type ReplacementRequest } from '@/features/editor/replacement';
import type { AnalysisResult, AnalyzeResponse, FindingCategory, MappedFinding, ReadabilityTarget } from '@/features/analysis/types';
import type { GrammarCheckSnapshot, GrammarResponse, GrammarSource, SkimmableSourceBlock, SkimmableSourceSnapshot, SourceSnapshot, ToolbarAction } from '@/features/ai/types';

type RichTextEditorProps = {
  initialContent: DocumentContent;
  // eslint-disable-next-line no-unused-vars
  onChange: (content: JSONContent) => void;
  onFocus?: () => void;
  documentId: string;
  analysisEnabled: boolean;
  readabilityTarget: ReadabilityTarget;
  visibleCategories: FindingCategory[];
  // eslint-disable-next-line no-unused-vars
  onAnalysis?: (...args: [AnalysisResult, MappedFinding[]]) => void;
  // eslint-disable-next-line no-unused-vars
  onFindingClick?: (...args: [MappedFinding]) => void;
  replacementRequest?: ReplacementRequest | null;
  blockReplacementRequest?: BlockReplacementRequest | null;
  // eslint-disable-next-line no-unused-vars
  onReplacementResult?: (...args: [ReplaceEditorRangeResult]) => void;
  // eslint-disable-next-line no-unused-vars
  onBlockReplacementResult?: (...args: [ReplaceEditorBlocksResult]) => void;
  // eslint-disable-next-line no-unused-vars
  onAiAction?: (...args: [SourceSnapshot, ToolbarAction]) => void;
  // eslint-disable-next-line no-unused-vars
  onMakeSkimmable?: (...args: [SkimmableSourceSnapshot]) => void;
  // eslint-disable-next-line no-unused-vars
  onSkimmableSelectionChange?: (...args: [SkimmableSourceSnapshot | null]) => void;
  // eslint-disable-next-line no-unused-vars
  onSelectionChange?: (...args: [SourceSnapshot | null]) => void;
  grammarEnabled?: boolean;
  grammarConfigured?: boolean | null;
  grammarDialect?: import('@/features/ai/dialect').Dialect;
  // eslint-disable-next-line no-unused-vars
  onGrammarRequest?: (...args: [GrammarCheckSnapshot, AbortSignal]) => Promise<GrammarResponse>;
  // eslint-disable-next-line no-unused-vars
  onGrammarFindings?: (...args: [MappedFinding[]]) => void;
};

function ToolbarButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`editor-tool ${pressed ? 'is-active' : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EditorToolbar({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const [, rerender] = useState(0);

  useEffect(() => {
    const update = () => rerender((value) => value + 1);
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor]);

  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', current ?? 'https://');
    if (url === null) return;
    if (!url.trim() || url === 'https://') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url.trim() }).run();
  };

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
      <select
        className="heading-select"
        aria-label="Text style"
        value={editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph'}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'paragraph') editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="paragraph">Paragraph</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <span className="toolbar-divider" aria-hidden="true" />
      <ToolbarButton label="Bold" pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton label="Italic" pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton label="Add or edit link" pressed={editor.isActive('link')} onClick={setLink}>
        <span aria-hidden="true">↗</span>
      </ToolbarButton>
      <span className="toolbar-divider" aria-hidden="true" />
      <ToolbarButton label="Blockquote" pressed={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <span aria-hidden="true">❞</span>
      </ToolbarButton>
      <ToolbarButton label="Bulleted list" pressed={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <span aria-hidden="true">☷</span>
      </ToolbarButton>
      <ToolbarButton label="Numbered list" pressed={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <span aria-hidden="true">☰</span>
      </ToolbarButton>
      <span className="toolbar-spacer" />
      <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <span aria-hidden="true">↶</span>
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <span aria-hidden="true">↷</span>
      </ToolbarButton>
    </div>
  );
}

function selectionSnapshot(editor: NonNullable<ReturnType<typeof useEditor>>, documentId: string, editorGeneration: number): SourceSnapshot | null {
  const from = Math.max(1, editor.state.selection.from);
  const to = Math.min(editor.state.doc.content.size, editor.state.selection.to);
  if (from >= to) return null;
  const text = editor.state.doc.textBetween(from, to, '\n', '\n');
  if (!text || text.length > 8000) return null;
  const projection = projectDocument(editor.state.doc);
  const intersected = projection.segments.filter((item) => item.pmFrom !== null && item.pmTo !== null && item.pmFrom < to && item.pmTo > from);
  if (!intersected.length || intersected.some((item) => item.kind === 'block_separator') || new Set(intersected.map((item) => item.blockIndex)).size !== 1) return null;
  const first = intersected[0];
  const last = intersected[intersected.length - 1];
  const projectionStart = first.textStart + Math.max(0, from - first.pmFrom!);
  const projectionEnd = last.textStart + Math.min(last.textEnd - last.textStart, to - last.pmFrom!);
  const before = projection.text.slice(Math.max(0, projectionStart - 800), projectionStart);
  const after = projection.text.slice(projectionEnd, Math.min(projection.text.length, projectionEnd + 800));
  return { from, to, text, documentId, editorGeneration, textHash: fnv1a(`${documentId}:${editor.state.doc.textContent}:${from}:${to}`), context: { before, after } };
}

function isSkimmableSourceFragment(fragment: ReadonlyArray<import('@/features/documents/content').TiptapNode>): fragment is SkimmableSourceBlock[] {
  return fragment.length > 0 && fragment.every((node) => {
    if (node.type !== 'paragraph' && node.type !== 'heading') return false;
    return (node.content ?? []).length > 0 && (node.content ?? []).every((child) => child.type === 'text' && (child.marks ?? []).every((mark) => mark.type === 'bold' || mark.type === 'italic'));
  });
}

function skimmableSelectionSnapshot(editor: NonNullable<ReturnType<typeof useEditor>>, documentId: string, editorGeneration: number): SkimmableSourceSnapshot | null {
  const selectionFrom = editor.state.selection.from;
  const selectionTo = editor.state.selection.to;
  if (selectionFrom >= selectionTo) return null;
  const boundaries: Array<{ from: number; to: number }> = [];
  editor.state.doc.forEach((node, offset) => boundaries.push({ from: offset, to: offset + node.nodeSize }));
  const firstBoundary = boundaries.find((boundary) => boundary.from === selectionFrom || boundary.from + 1 === selectionFrom);
  const lastBoundary = [...boundaries].reverse().find((boundary) => boundary.to === selectionTo || boundary.to - 1 === selectionTo);
  if (!firstBoundary || !lastBoundary || firstBoundary.from > lastBoundary.from) return null;
  const from = firstBoundary.from;
  const to = lastBoundary.to;
  const captured = captureBlockSelection(editor, from, to, documentId, editorGeneration, 'selection');
  if (!captured.ok || !isSkimmableSourceFragment(captured.value.expectedSourceSliceJson) || captured.value.topLevelEnd - captured.value.topLevelStart > 12) return null;
  const sourceText = editor.state.doc.textBetween(from, to, '\n', '\n');
  if (!sourceText.trim() || sourceText.length > 8_000) return null;
  const projection = projectDocument(editor.state.doc);
  const selectedBlocks = projection.blocks.filter((block) => block.pmContentFrom >= from && block.pmContentTo <= to && block.textEnd > block.textStart);
  if (!selectedBlocks.length) return null;
  const firstBlock = selectedBlocks[0]!;
  const lastBlock = selectedBlocks[selectedBlocks.length - 1]!;
  return {
    ...captured.value,
    sourceText,
    sourceFragment: captured.value.expectedSourceSliceJson,
    context: {
      before: projection.text.slice(Math.max(0, firstBlock.textStart - 800), firstBlock.textStart),
      after: projection.text.slice(lastBlock.textEnd, Math.min(projection.text.length, lastBlock.textEnd + 800)),
    },
  };
}

export function RichTextEditor({ initialContent, onChange, onFocus, documentId, analysisEnabled, readabilityTarget, visibleCategories, onAnalysis, onFindingClick, replacementRequest, blockReplacementRequest, onReplacementResult, onBlockReplacementResult, onAiAction, onMakeSkimmable, onSkimmableSelectionChange, onSelectionChange, grammarEnabled = false, grammarConfigured = null, grammarDialect = 'us', onGrammarRequest, onGrammarFindings }: RichTextEditorProps) {
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const lastAcceptedRequestRef = useRef(0);
  const analysisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grammarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const grammarAbortRef = useRef<AbortController | null>(null);
  const grammarProjectionRef = useRef<ReturnType<typeof projectDocument> | null>(null);
  const grammarDirtyBlocksRef = useRef<Set<number>>(new Set());
  const grammarFindingsRef = useRef<MappedFinding[]>([]);
  const latestAnalysisRef = useRef<{ generation: number; result: AnalysisResult; mappedFindings: MappedFinding[] } | null>(null);
  const visibleCategoriesRef = useRef(visibleCategories);
  const onAnalysisRef = useRef(onAnalysis);
  const onReplacementResultRef = useRef(onReplacementResult);
  const onBlockReplacementResultRef = useRef(onBlockReplacementResult);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onAiActionRef = useRef(onAiAction);
  const onMakeSkimmableRef = useRef(onMakeSkimmable);
  const onSkimmableSelectionChangeRef = useRef(onSkimmableSelectionChange);
  const onGrammarRequestRef = useRef(onGrammarRequest);
  const onGrammarFindingsRef = useRef(onGrammarFindings);
  // eslint-disable-next-line no-unused-vars
  const grammarChangeRef = useRef<((currentEditor: NonNullable<typeof editor>) => void) | null>(null);
  // eslint-disable-next-line no-unused-vars
  const scheduleGrammarRef = useRef<((currentEditor: NonNullable<typeof editor>, immediate?: boolean) => void) | null>(null);
  const [grammarStatus, setGrammarStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => { visibleCategoriesRef.current = visibleCategories; }, [visibleCategories]);
  useEffect(() => { onAnalysisRef.current = onAnalysis; }, [onAnalysis]);
  useEffect(() => { onReplacementResultRef.current = onReplacementResult; }, [onReplacementResult]);
  useEffect(() => { onBlockReplacementResultRef.current = onBlockReplacementResult; }, [onBlockReplacementResult]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { onAiActionRef.current = onAiAction; }, [onAiAction]);
  useEffect(() => { onMakeSkimmableRef.current = onMakeSkimmable; }, [onMakeSkimmable]);
  useEffect(() => { onSkimmableSelectionChangeRef.current = onSkimmableSelectionChange; }, [onSkimmableSelectionChange]);
  useEffect(() => { onGrammarRequestRef.current = onGrammarRequest; }, [onGrammarRequest]);
  useEffect(() => { onGrammarFindingsRef.current = onGrammarFindings; }, [onGrammarFindings]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      AnalysisExtension.configure({ onFindingClick }),
    ],
    content: initialContent as JSONContent,
    editorProps: {
      attributes: {
        class: 'tiptap-content',
        'aria-label': 'Document editor',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
      generationRef.current += 1;
      latestAnalysisRef.current = latestAnalysisRef.current ? { ...latestAnalysisRef.current, result: { ...latestAnalysisRef.current.result, findings: [] }, mappedFindings: [] } : null;
      if (analysisEnabled) scheduleAnalysis(currentEditor);
      grammarChangeRef.current?.(currentEditor);
    },
    onFocus,
  });

  const [selection, setSelection] = useState<SourceSnapshot | null>(null);
  const [skimmableSelection, setSkimmableSelection] = useState<SkimmableSourceSnapshot | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ top: number; left: number } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = selectionSnapshot(editor, documentId, generationRef.current);
      const nextSkimmable = skimmableSelectionSnapshot(editor, documentId, generationRef.current);
      setSelection(next);
      setSkimmableSelection(nextSkimmable);
      onSelectionChangeRef.current?.(next);
      onSkimmableSelectionChangeRef.current?.(nextSkimmable);
      const positionSnapshot = next ?? nextSkimmable;
      if (!positionSnapshot) { setSelectionPosition(null); return; }
      const start = editor.view.coordsAtPos(positionSnapshot.from);
      const end = editor.view.coordsAtPos(positionSnapshot.to);
      const surface = editor.view.dom.closest('.writing-surface') as HTMLElement | null;
      const surfaceRect = surface?.getBoundingClientRect();
      const top = start.bottom - (surfaceRect?.top ?? 0) + (surface?.scrollTop ?? 0) + 8;
      const left = ((start.left + end.right) / 2) - (surfaceRect?.left ?? 0) + (surface?.scrollLeft ?? 0);
      setSelectionPosition({ top: Math.max(8, top), left: Math.max(16, left) });
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
  }, [editor, documentId]);

  const runAnalysis = useCallback((currentEditor: NonNullable<typeof editor>) => {
    if (!workerRef.current) return;
    const projection = projectDocument(currentEditor.state.doc);
    const generation = generationRef.current;
    if (projection.text.length > 300_000) {
      const thresholds = TARGETS[readabilityTarget];
      const result: AnalysisResult = { statistics: calculateStatistics(projection), readability: { grade: null, target: readabilityTarget, hardThreshold: thresholds.hard, veryHardThreshold: thresholds.veryHard }, findings: [], textHash: fnv1a(projection.text) };
      latestAnalysisRef.current = { generation, result, mappedFindings: [] };
      currentEditor.view.dispatch(currentEditor.state.tr.setMeta(analysisPluginKey, { type: 'replace', findings: [], visibleCategories: visibleCategoriesRef.current, generation } satisfies AnalysisMeta));
      onAnalysisRef.current?.(result, []);
      return;
    }
    const requestId = ++requestIdRef.current;
    const request = { type: 'analyze' as const, requestId, documentId, editorGeneration: generation, projection: { text: projection.text, blocks: projection.blocks.map(({ index, nodeType, textStart, textEnd, isEmpty }) => ({ index, nodeType, textStart, textEnd, isEmpty })) }, settings: { readabilityTarget } };
    workerRef.current.postMessage(request);
  }, [documentId, readabilityTarget]);

  const scheduleAnalysis = useCallback((currentEditor: NonNullable<typeof editor>, immediate = false) => {
    if (!analysisEnabled) return;
    if (analysisTimerRef.current) clearTimeout(analysisTimerRef.current);
    const length = currentEditor.state.doc.textContent.length;
    const delay = immediate ? (length > 100_000 ? 2000 : 0) : (length > 100_000 ? 2000 : 250);
    analysisTimerRef.current = setTimeout(() => runAnalysis(currentEditor), delay);
  }, [analysisEnabled, runAnalysis]);

  const grammarSources = useCallback((currentEditor: NonNullable<typeof editor>, blockIndexes: number[]): GrammarCheckSnapshot => {
    const projection = projectDocument(currentEditor.state.doc);
    const sources = projection.blocks.filter((block) => blockIndexes.includes(block.index) && !block.isEmpty).map((block): GrammarSource => ({ sourceId: `${documentId}:block:${block.index}`, text: projection.text.slice(block.textStart, block.textEnd), textHash: fnv1a(projection.text.slice(block.textStart, block.textEnd)), projectionStart: block.textStart, blockIndex: block.index })).filter((source) => source.text.length <= GRAMMAR_CONFIG.maxSourceChars).reduce<GrammarSource[]>((selected, source) => {
      const total = selected.reduce((sum, item) => sum + item.text.length, 0);
      return total + source.text.length <= GRAMMAR_CONFIG.maxTotalChars ? [...selected, source] : selected;
    }, []).slice(0, GRAMMAR_CONFIG.maxSources);
    return { requestId: crypto.randomUUID(), documentId, editorGeneration: generationRef.current, dialect: grammarDialect, sources, projection };
  }, [documentId, grammarDialect]);

  const publishGrammarFindings = useCallback((currentEditor: NonNullable<typeof editor>, findings: MappedFinding[], blockIndexes: number[]) => {
    currentEditor.view.dispatch(currentEditor.state.tr.setMeta(analysisPluginKey, { type: 'grammar-replace', findings, blockIndexes, visibleCategories: visibleCategoriesRef.current, generation: generationRef.current } satisfies AnalysisMeta));
    const pluginState = analysisPluginKey.getState(currentEditor.state);
    const active = pluginState?.findings.filter((finding) => (finding.category === 'grammar' || finding.category === 'spelling' || finding.category === 'punctuation') && !finding.isStale) ?? findings;
    grammarFindingsRef.current = active;
    onGrammarFindingsRef.current?.(active);
    setGrammarStatus('idle');
  }, []);

  const scheduleGrammar = useCallback((currentEditor: NonNullable<typeof editor>, immediate = false) => {
    if (!grammarEnabled || grammarConfigured !== true || !onGrammarRequestRef.current || grammarDirtyBlocksRef.current.size === 0) return;
    if (grammarTimerRef.current) clearTimeout(grammarTimerRef.current);
    grammarTimerRef.current = setTimeout(() => {
      const blockIndexes = [...grammarDirtyBlocksRef.current];
      grammarDirtyBlocksRef.current.clear();
      const snapshot = grammarSources(currentEditor, blockIndexes);
      const checkedBlocks = new Set(snapshot.sources.map((source) => source.blockIndex));
      blockIndexes.filter((blockIndex) => !checkedBlocks.has(blockIndex)).forEach((blockIndex) => grammarDirtyBlocksRef.current.add(blockIndex));
      if (!snapshot.sources.length) return;
      grammarAbortRef.current?.abort();
      const controller = new AbortController();
      grammarAbortRef.current = controller;
      setGrammarStatus('loading');
      const requestGrammar = onGrammarRequestRef.current;
      if (!requestGrammar) return;
      void requestGrammar(snapshot, controller.signal).then((response) => {
        if (controller.signal.aborted || generationRef.current !== snapshot.editorGeneration) return;
        const findings = reconcileGrammarResponse(response, snapshot);
        publishGrammarFindings(currentEditor, findings, blockIndexes);
        if (grammarDirtyBlocksRef.current.size) scheduleGrammarRef.current?.(currentEditor);
      }).catch(() => { if (!controller.signal.aborted) { setGrammarStatus('error'); } });
    }, immediate ? 1500 : 1500);
  }, [grammarConfigured, grammarEnabled, grammarSources, publishGrammarFindings]);

  useEffect(() => { scheduleGrammarRef.current = scheduleGrammar; }, [scheduleGrammar]);

  useEffect(() => {
    grammarChangeRef.current = (currentEditor) => {
      const projection = projectDocument(currentEditor.state.doc);
      const previous = grammarProjectionRef.current;
      const dirty = new Set<number>();
      projection.blocks.forEach((block) => {
        const currentText = projection.text.slice(block.textStart, block.textEnd);
        const previousBlock = previous?.blocks.find((candidate) => candidate.index === block.index);
        const previousText = previous ? previous.text.slice(previousBlock?.textStart ?? -1, previousBlock?.textEnd ?? -1) : null;
        if (!previous || currentText !== previousText) dirty.add(block.index);
      });
      if (previous && previous.blocks.length !== projection.blocks.length) previous.blocks.forEach((block) => dirty.add(block.index));
      grammarProjectionRef.current = projection;
      if (dirty.size) {
        grammarAbortRef.current?.abort();
        dirty.forEach((index) => grammarDirtyBlocksRef.current.add(index));
        currentEditor.view.dispatch(currentEditor.state.tr.setMeta(analysisPluginKey, { type: 'grammar-invalidate', blockIndexes: [...dirty] } satisfies AnalysisMeta));
        const pluginState = analysisPluginKey.getState(currentEditor.state);
        grammarFindingsRef.current = pluginState?.findings.filter((finding) => (finding.category === 'grammar' || finding.category === 'spelling' || finding.category === 'punctuation') && !finding.isStale) ?? [];
        onGrammarFindingsRef.current?.(grammarFindingsRef.current);
        scheduleGrammar(currentEditor);
      }
    };
    return () => { grammarChangeRef.current = null; };
  }, [scheduleGrammar]);

  useEffect(() => {
    if (!editor) return;
    const worker = new Worker(new URL('../../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    generationRef.current = 0;
    worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const response = event.data;
      const projection = projectDocument(editor.state.doc);
      if (!isFreshAnalysisResponse(response, { documentId, editorGeneration: generationRef.current, lastAcceptedRequestId: lastAcceptedRequestRef.current, textHash: fnv1a(projection.text) })) return;
      lastAcceptedRequestRef.current = response.requestId;
      const mappedFindings = response.findings.flatMap((finding) => {
        const mapped = mapTextRange(projection, finding.textStart, finding.textEnd);
        return mapped ? [{ ...finding, ...mapped, editorGeneration: response.editorGeneration, isStale: false }] : [];
      });
      const result = { statistics: response.statistics, readability: response.readability, findings: response.findings, textHash: response.textHash };
      latestAnalysisRef.current = { generation: response.editorGeneration, result, mappedFindings };
      editor.view.dispatch(editor.state.tr.setMeta(analysisPluginKey, { type: 'replace', findings: mappedFindings, visibleCategories: visibleCategoriesRef.current, generation: response.editorGeneration } satisfies AnalysisMeta));
      onAnalysisRef.current?.(result, mappedFindings);
    };
    if (analysisEnabled) scheduleAnalysis(editor, true);
    if (analysisEnabled && grammarEnabled && grammarConfigured === true) {
      grammarProjectionRef.current = projectDocument(editor.state.doc);
      grammarProjectionRef.current.blocks.forEach((block) => grammarDirtyBlocksRef.current.add(block.index));
      scheduleGrammar(editor, true);
    }
    return () => {
      if (analysisTimerRef.current) clearTimeout(analysisTimerRef.current);
      if (grammarTimerRef.current) clearTimeout(grammarTimerRef.current);
      grammarAbortRef.current?.abort();
      worker.terminate();
      workerRef.current = null;
    };
  // The worker lifetime follows the editor/document lifetime; other values are read by the scheduling callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, documentId, analysisEnabled, grammarEnabled, grammarConfigured, scheduleGrammar]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(analysisPluginKey, analysisEnabled ? { type: 'visibility', visibleCategories } satisfies AnalysisMeta : { type: 'clear' } satisfies AnalysisMeta));
    if (analysisEnabled) {
      const cached = latestAnalysisRef.current;
      if (cached?.generation === generationRef.current) editor.view.dispatch(editor.state.tr.setMeta(analysisPluginKey, { type: 'replace', findings: cached.mappedFindings, visibleCategories, generation: cached.generation } satisfies AnalysisMeta));
      else scheduleAnalysis(editor, true);
    }
  }, [analysisEnabled, visibleCategories, editor, scheduleAnalysis]);

  useEffect(() => {
    if (editor && analysisEnabled) scheduleAnalysis(editor, true);
  }, [readabilityTarget, editor, analysisEnabled, scheduleAnalysis]);

  useEffect(() => {
    if (!editor || !replacementRequest) return;
    const range = 'finding' in replacementRequest ? { from: replacementRequest.finding.pmFrom, to: replacementRequest.finding.pmTo, expectedText: replacementRequest.finding.excerpt, editorGeneration: replacementRequest.finding.editorGeneration } : replacementRequest;
    const result = replaceEditorRange({ editor, from: range.from, to: range.to, expectedText: range.expectedText, replacement: replacementRequest.replacement, documentId, currentDocumentId: documentId, editorGeneration: range.editorGeneration, currentGeneration: generationRef.current });
    onReplacementResultRef.current?.(result);
  }, [editor, replacementRequest, documentId]);

  useEffect(() => {
    if (!editor || !blockReplacementRequest) return;
    const result = replaceEditorBlocks({ editor, ...blockReplacementRequest });
    onBlockReplacementResultRef.current?.(result);
  }, [editor, blockReplacementRequest, documentId]);

  if (!editor) return <div className="editor-loading" role="status">Opening document…</div>;

  return (
    <div className="editor-frame">
      <EditorToolbar editor={editor} />
      {analysisEnabled && grammarConfigured === false ? <div className="grammar-status" role="status">AI grammar is unavailable. Add your OpenAI API key in Settings.</div> : grammarStatus === 'loading' ? <div className="grammar-status" role="status">Checking grammar…</div> : grammarStatus === 'error' ? <div className="grammar-status" role="status">AI grammar could not complete. Your local analysis is still available.</div> : null}
      {selection || skimmableSelection ? <div className="selection-ai-toolbar" role="toolbar" aria-label="AI writing actions" style={selectionPosition ? { top: selectionPosition.top, left: selectionPosition.left } : undefined}>
        {selection ? <>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAiActionRef.current?.(selection, 'simplify')}>Simplify</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAiActionRef.current?.(selection, 'polish')}>Polish</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAiActionRef.current?.(selection, 'rephrase')}>Rephrase</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAiActionRef.current?.(selection, 'synonyms')}>Synonyms</button>
        </> : null}
        {skimmableSelection ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onMakeSkimmableRef.current?.(skimmableSelection)}>Make Skimmable</button> : null}
        {selection ? <div className="selection-ai-more"><button type="button" aria-expanded={moreOpen} onMouseDown={(event) => event.preventDefault()} onClick={() => setMoreOpen((value) => !value)}>More</button>{moreOpen ? <div className="selection-ai-menu">
          {([['shorten', 'Shorten'], ['add_detail', 'Add Detail'], ['more_confident', 'More Confident'], ['more_friendly', 'More Friendly'], ['more_casual', 'More Casual'], ['more_formal', 'More Formal'], ['more_persuasive', 'More Persuasive']] as const).map(([action, label]) => <button type="button" key={action} onMouseDown={(event) => event.preventDefault()} onClick={() => { setMoreOpen(false); onAiActionRef.current?.(selection, action); }}>{label}</button>)}
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setMoreOpen(false); onAiActionRef.current?.(selection, 'custom'); }}>Ask AI to change this…</button>
        </div> : null}</div> : null}
      </div> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
