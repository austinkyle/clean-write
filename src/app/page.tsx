'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { JSONContent } from '@tiptap/core';

import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { FeedbackPanel, type FeedbackPanelState } from '@/components/ai/FeedbackPanel';
import { parseDocumentContent, toPlainText, type DocumentContent } from '@/features/documents/content';
import type { AnalysisResult, FindingCategory, MappedFinding, ReadabilityTarget } from '@/features/analysis/types';
import { calculateReadability } from '@/features/analysis/readability';
import { segmentBlock } from '@/features/analysis/segmentation';
import type { BlockReplacementRequest, ReplaceEditorBlocksResult, ReplaceEditorRangeResult, ReplacementRequest } from '@/features/editor/replacement';
import type { Dialect } from '@/features/ai/dialect';
import type { GrammarCheckSnapshot, GrammarResponse, RewriteAction, RewriteAlternative, SkimmableRequest, SkimmableResponse, SkimmableSourceSnapshot, SourceSnapshot, ToolbarAction } from '@/features/ai/types';
import { DIALECTS } from '@/features/ai/dialect';
import type { FeedbackRequest, FeedbackResponse } from '@/features/ai/types';
import { fnv1a } from '@/features/analysis/normalize';
import { RewriteReviewDialog, type RewriteReview } from '@/components/ai/RewriteReviewDialog';
import { MakeSkimmableReviewDialog, type MakeSkimmableReview } from '@/components/ai/MakeSkimmableReviewDialog';
import { SettingsDialog } from '@/components/ai/SettingsDialog';
import { SUPPORTED_IMPORT_EXTENSIONS, sanitizeDownloadFilename, type ExportFormat } from '@/features/import-export/types';
import { PRODUCT_NAME } from '@/lib/brand';
import { skimmableAstToCanonicalFragment } from '@/features/ai/skimmable';

type Mode = 'Write' | 'Edit' | 'Feedback';
type SaveState = 'saved' | 'saving' | 'failed';
type DocumentView = {
  id: string;
  title: string;
  content: DocumentContent;
  plainText: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

const modes: Mode[] = ['Write', 'Edit', 'Feedback'];
const ANALYSIS_CATEGORIES: FindingCategory[] = ['hard_sentence', 'very_hard_sentence', 'adverb', 'qualifier', 'passive_voice', 'complex_word', 'grammar', 'spelling', 'punctuation'];

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'Just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function storedReadabilityTarget(): ReadabilityTarget {
  if (typeof window === 'undefined') return 'default';
  const value = window.localStorage.getItem('clearwrite.readabilityTarget');
  return value === 'accessible' || value === 'default' || value === 'technical' ? value : 'default';
}

function storedVisibleCategories(): FindingCategory[] {
  if (typeof window === 'undefined') return ANALYSIS_CATEGORIES;
  try {
    const value = JSON.parse(window.localStorage.getItem('clearwrite.analysisVisibility') ?? 'null') as unknown;
    return Array.isArray(value) ? ANALYSIS_CATEGORIES.filter((category) => value.includes(category)) : ANALYSIS_CATEGORIES;
  } catch { return ANALYSIS_CATEGORIES; }
}

function localGrade(text: string, target: ReadabilityTarget) {
  if (!text.trim()) return null;
  const sentences = segmentBlock(text);
  return sentences.length ? calculateReadability(text, sentences, target).grade : null;
}

export default function HomePage() {
  const [mode, setMode] = useState<Mode>('Write');
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [titleDraft, setTitleDraft] = useState('');
  const [activePlainText, setActivePlainText] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [grammarFindings, setGrammarFindings] = useState<MappedFinding[]>([]);
  const [selectedFinding, setSelectedFinding] = useState<MappedFinding | null>(null);
  const [replacementRequest, setReplacementRequest] = useState<ReplacementRequest | null>(null);
  const [readabilityTarget, setReadabilityTarget] = useState<ReadabilityTarget>(storedReadabilityTarget);
  const [visibleCategories, setVisibleCategories] = useState<FindingCategory[]>(storedVisibleCategories);
  const [dialect, setDialect] = useState<Dialect>('us');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [review, setReview] = useState<(RewriteReview & { action: ToolbarAction; snapshot: SourceSnapshot }) | null>(null);
  const [skimmableReview, setSkimmableReview] = useState<MakeSkimmableReview | null>(null);
  const [blockReplacementRequest, setBlockReplacementRequest] = useState<BlockReplacementRequest | null>(null);
  const [feedbackState, setFeedbackState] = useState<FeedbackPanelState>({ status: 'empty' });
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [selectedAiSnapshot, setSelectedAiSnapshot] = useState<SourceSnapshot | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSequence = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const latestContent = useRef<{ id: string; content: JSONContent; revision: number } | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const feedbackAbortRef = useRef<AbortController | null>(null);
  const feedbackRequestRef = useRef<string | null>(null);
  const feedbackGenerationRef = useRef(0);
  const currentSkimmableSelectionRef = useRef<SkimmableSourceSnapshot | null>(null);

  const resetFeedback = useCallback(() => {
    feedbackAbortRef.current?.abort();
    feedbackRequestRef.current = null;
    feedbackGenerationRef.current = 0;
    setFeedbackState({ status: 'empty' });
  }, []);

  const loadDocuments = useCallback(async () => {
    const data = await readResponse<{ documents: DocumentView[]; lastOpenedId: string | null }>(await fetch('/api/documents', { cache: 'no-store' }));
    setDocuments(data.documents);
    const preferred = data.documents.find((document) => document.id === data.lastOpenedId) ?? data.documents[0] ?? null;
    if (preferred) {
      const opened = await readResponse<DocumentView>(await fetch(`/api/documents/${preferred.id}`));
      activeIdRef.current = opened.id;
      latestContent.current = { id: opened.id, content: opened.content, revision: opened.revision };
      setActiveDocument(opened);
      setTitleDraft(opened.title);
      setActivePlainText(opened.plainText);
      setAnalysis(null);
      setGrammarFindings([]);
      resetFeedback();
      setSelectedFinding(null);
      setReplacementRequest(null);
    }
  }, [resetFeedback]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadDocuments();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load documents');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadDocuments]);

  useEffect(() => {
    void Promise.all([
      fetch('/api/settings').then((response) => response.json() as Promise<{ dialect: Dialect }>).then((value) => { if (DIALECTS.includes(value.dialect)) setDialect(value.dialect); }),
      fetch('/api/ai/status').then((response) => response.json() as Promise<{ configured: boolean }>).then((value) => setAiConfigured(value.configured)),
    ]).catch(() => undefined);
  }, []);

  useEffect(() => {
    setSelectedAiSnapshot(null);
    setAiToolsOpen(false);
  }, [activeDocument?.id]);

  useEffect(() => () => { feedbackAbortRef.current?.abort(); }, []);

  const flushPendingSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = latestContent.current;
    if (!pending || pending.id !== activeIdRef.current) return;
    setSaveState('saving');
    const sequence = ++saveSequence.current;
    try {
      const saved = await readResponse<DocumentView>(await fetch(`/api/documents/${pending.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: pending.content, revision: pending.revision }),
      }));
      if (sequence === saveSequence.current && activeIdRef.current === pending.id) {
        setActiveDocument(saved);
        setActivePlainText(saved.plainText);
        setDocuments((current) => [saved, ...current.filter((document) => document.id !== saved.id)].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)));
        setSaveState('saved');
      }
    } catch {
      if (sequence === saveSequence.current && activeIdRef.current === pending.id) setSaveState('failed');
    }
  }, []);

  const scheduleSave = useCallback((id: string, content: JSONContent) => {
    const previousRevision = latestContent.current?.id === id ? latestContent.current.revision : 0;
    latestContent.current = { id, content, revision: previousRevision + 1 };
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushPendingSave(); }, 650);
  }, [flushPendingSave]);

  const switchDocument = async (id: string) => {
    if (id === activeIdRef.current) return;
    await flushPendingSave();
    aiAbortRef.current?.abort();
    resetFeedback();
    setReview(null);
    setSkimmableReview(null);
    setBlockReplacementRequest(null);
    try {
      const opened = await readResponse<DocumentView>(await fetch(`/api/documents/${id}/open`, { method: 'POST' }));
      activeIdRef.current = opened.id;
      latestContent.current = { id: opened.id, content: opened.content, revision: opened.revision };
      setActiveDocument(opened);
      setTitleDraft(opened.title);
      setActivePlainText(opened.plainText);
      setAnalysis(null);
      setGrammarFindings([]);
      setSelectedFinding(null);
      setReplacementRequest(null);
      setBlockReplacementRequest(null);
      setSaveState('saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open document');
    }
  };

  const createDocument = async () => {
    await flushPendingSave();
    aiAbortRef.current?.abort();
    resetFeedback();
    setReview(null);
    setSkimmableReview(null);
    setBlockReplacementRequest(null);
    const created = await readResponse<DocumentView>(await fetch('/api/documents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }));
    activeIdRef.current = created.id;
    latestContent.current = { id: created.id, content: created.content, revision: created.revision };
    setActiveDocument(created);
    setTitleDraft(created.title);
    setActivePlainText(created.plainText);
    setAnalysis(null);
    setGrammarFindings([]);
    resetFeedback();
    setSelectedFinding(null);
    setReplacementRequest(null);
    setBlockReplacementRequest(null);
    setDocuments((current) => [created, ...current]);
    setError(null);
  };

  const renameActive = async () => {
    if (!activeDocument || titleDraft.trim() === activeDocument.title) return;
    try {
      await flushPendingSave();
      const renamed = await readResponse<DocumentView>(await fetch(`/api/documents/${activeDocument.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: titleDraft }),
      }));
      setActiveDocument(renamed);
      setTitleDraft(renamed.title);
      setDocuments((current) => [renamed, ...current.filter((document) => document.id !== renamed.id)].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)));
    } catch (reason) {
      setTitleDraft(activeDocument.title);
      setError(reason instanceof Error ? reason.message : 'Could not rename document');
    }
  };

  const duplicateActive = async () => {
    if (!activeDocument) return;
    await flushPendingSave();
    aiAbortRef.current?.abort();
    resetFeedback();
    setReview(null);
    setSkimmableReview(null);
    setBlockReplacementRequest(null);
    const copy = await readResponse<DocumentView>(await fetch(`/api/documents/${activeDocument.id}/duplicate`, { method: 'POST' }));
    activeIdRef.current = copy.id;
    latestContent.current = { id: copy.id, content: copy.content, revision: copy.revision };
    setActiveDocument(copy);
    setTitleDraft(copy.title);
    setActivePlainText(copy.plainText);
    setAnalysis(null);
    setGrammarFindings([]);
    resetFeedback();
    setSelectedFinding(null);
    setReplacementRequest(null);
    setBlockReplacementRequest(null);
    setDocuments((current) => [copy, ...current]);
  };

  const deleteDocument = async (document: DocumentView) => {
    if (!window.confirm(`Delete “${document.title}”? This cannot be undone.`)) return;
    await flushPendingSave();
    aiAbortRef.current?.abort();
    resetFeedback();
    setReview(null);
    setSkimmableReview(null);
    setBlockReplacementRequest(null);
    await readResponse<void>(await fetch(`/api/documents/${document.id}`, { method: 'DELETE' }));
    const remaining = documents.filter((item) => item.id !== document.id);
    setDocuments(remaining);
    if (document.id === activeIdRef.current) {
      const next = remaining[0];
      activeIdRef.current = next?.id ?? null;
      latestContent.current = next ? { id: next.id, content: next.content, revision: next.revision } : null;
      setActiveDocument(next ?? null);
      setTitleDraft(next?.title ?? '');
      setActivePlainText(next?.plainText ?? '');
      setAnalysis(null);
      setGrammarFindings([]);
      resetFeedback();
      setSelectedFinding(null);
      setReplacementRequest(null);
      setBlockReplacementRequest(null);
    }
  };

  const handleAnalysis = useCallback((result: AnalysisResult) => {
    setAnalysis({ ...result, findings: [...result.findings.filter((finding) => !['grammar', 'spelling', 'punctuation'].includes(finding.category)), ...grammarFindings] });
  }, [grammarFindings]);

  const handleGrammarFindings = useCallback((findings: MappedFinding[]) => {
    setGrammarFindings(findings);
    setSelectedFinding((current) => current && findings.some((finding) => finding.id === current.id) ? current : null);
    setAnalysis((current) => current ? { ...current, findings: [...current.findings.filter((finding) => !['grammar', 'spelling', 'punctuation'].includes(finding.category)), ...findings] } : current);
  }, []);

  const handleGrammarRequest = useCallback(async (snapshot: GrammarCheckSnapshot, signal: AbortSignal): Promise<GrammarResponse> => {
    const response = await fetch('/api/ai/grammar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: snapshot.requestId, documentId: snapshot.documentId, editorGeneration: snapshot.editorGeneration, dialect: snapshot.dialect, sources: snapshot.sources }), signal });
    return readResponse<GrammarResponse>(response);
  }, []);

  const handleFeedbackCancel = useCallback(() => {
    feedbackAbortRef.current?.abort();
    feedbackRequestRef.current = null;
    setFeedbackState({ status: 'empty' });
  }, []);

  const handleFeedbackGenerate = useCallback(async () => {
    if (!activeDocument || aiConfigured !== true || !activePlainText.trim() || activePlainText.length > 30_000) return;
    feedbackAbortRef.current?.abort();
    const controller = new AbortController();
    feedbackAbortRef.current = controller;
    const requestId = crypto.randomUUID();
    const textHash = fnv1a(activePlainText);
    const editorGeneration = feedbackGenerationRef.current;
    feedbackRequestRef.current = requestId;
    const request: FeedbackRequest = { requestId, documentId: activeDocument.id, editorGeneration, text: activePlainText, textHash, title: titleDraft.trim() || undefined, dialect, metrics: { words: wordCount(activePlainText), sentences: segmentBlock(activePlainText).length, readabilityGrade: localGrade(activePlainText, readabilityTarget) ?? undefined, targetGrade: readabilityTarget === 'accessible' ? 7 : readabilityTarget === 'technical' ? 12 : 9 } };
    setFeedbackState({ status: 'loading' });
    try {
      const response = await fetch('/api/ai/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      const result = await readResponse<FeedbackResponse>(response);
      if (controller.signal.aborted || feedbackRequestRef.current !== requestId || activeIdRef.current !== activeDocument.id || feedbackGenerationRef.current !== editorGeneration) return;
      setFeedbackState({ status: 'ready', result });
    } catch (reason) {
      if (controller.signal.aborted || feedbackRequestRef.current !== requestId) return;
      setFeedbackState({ status: 'error', message: reason instanceof Error ? reason.message : 'AI is temporarily unavailable.' });
    }
  }, [activeDocument, activePlainText, aiConfigured, dialect, readabilityTarget, titleDraft]);

  const handleEditorChange = useCallback((content: JSONContent) => {
    feedbackGenerationRef.current += 1;
    feedbackAbortRef.current?.abort();
    feedbackRequestRef.current = null;
    setFeedbackState((current) => current.status === 'ready' || current.status === 'stale' ? { ...current, status: 'stale' } : current.status === 'loading' ? { status: 'empty' } : current);
    if (activeDocument) {
      setReview((current) => current ? { ...current, stale: true } : current);
      setSkimmableReview((current) => current ? { ...current, stale: true } : current);
      const plainText = toPlainText(parseDocumentContent(content));
      setActivePlainText(plainText);
      scheduleSave(activeDocument.id, content);
    }
  }, [activeDocument, scheduleSave]);

  const changeMode = useCallback((next: Mode) => {
    if (next !== 'Feedback' && feedbackState.status === 'loading') handleFeedbackCancel();
    setMode(next);
  }, [feedbackState.status, handleFeedbackCancel]);

  const handleTargetChange = useCallback((target: ReadabilityTarget) => {
    setReadabilityTarget(target);
    window.localStorage.setItem('clearwrite.readabilityTarget', target);
    setSelectedFinding(null);
  }, []);

  const handleToggle = useCallback((category: FindingCategory) => {
    setVisibleCategories((current) => {
      const next = current.includes(category) ? current.filter((item) => item !== category) : [...current, category];
      window.localStorage.setItem('clearwrite.analysisVisibility', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleFindingClick = useCallback((finding: MappedFinding) => setSelectedFinding(finding), []);
  const handleReplace = useCallback((replacement: string) => {
    if (selectedFinding) setReplacementRequest({ finding: selectedFinding, replacement });
  }, [selectedFinding]);
  const handleReplacementResult = useCallback((result: ReplaceEditorRangeResult) => {
    setReplacementRequest(null);
    if (!result.ok) {
      if (review) setReview((current) => current ? { ...current, loading: false, stale: true } : current);
      setError(result.reason === 'stale-finding' || result.reason === 'generation-mismatch' ? 'The document changed while this suggestion was being generated. Generate a new suggestion.' : 'That suggestion could not be applied.');
      return;
    }
    setReview(null);
    setSelectedFinding(null);
  }, [review]);

  const handleBlockReplacementResult = useCallback((result: ReplaceEditorBlocksResult) => {
    setBlockReplacementRequest(null);
    if (!result.ok) {
      setSkimmableReview((current) => current ? { ...current, stale: result.reason !== 'invalid-replacement', error: result.reason === 'stale-finding' || result.reason === 'generation-mismatch' || result.reason === 'invalid-range' ? 'This document changed while the suggestion was being generated. Generate a new suggestion.' : current.error } : current);
      setError(result.reason === 'stale-finding' || result.reason === 'generation-mismatch' || result.reason === 'invalid-range' ? 'This document changed while the suggestion was being generated. Generate a new suggestion.' : 'That structure could not be applied.');
      return;
    }
    setSkimmableReview(null);
    setSelectedFinding(null);
  }, []);

  const startAiAction = useCallback(async (snapshot: SourceSnapshot, action: ToolbarAction, customInstruction?: string) => {
    if (!activeDocument) return;
    if (aiConfigured === false) { setError('Add your OpenAI API key to enable AI tools.'); return; }
    const instruction = action === 'custom' ? customInstruction?.trim() : undefined;
    if (action === 'custom' && !instruction) {
      setReview({ action, snapshot: { ...snapshot, documentId: activeDocument.id }, original: snapshot.text, alternatives: [], activeIndex: 0, loading: false, error: null, stale: false, customPrompt: true });
      return;
    }
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const requestId = crypto.randomUUID();
    const base = { requestId, documentId: activeDocument.id, editorGeneration: snapshot.editorGeneration ?? 0, source: { from: snapshot.from, to: snapshot.to, text: snapshot.text, textHash: snapshot.textHash }, context: snapshot.context, dialect, readabilityTarget, targetGrade: action === 'simplify' || action === 'hard_sentence_simplify' ? localGrade(snapshot.text, readabilityTarget) ?? undefined : undefined };
    setReview({ action, snapshot: { ...snapshot, documentId: activeDocument.id }, original: snapshot.text, alternatives: [], activeIndex: 0, loading: true, error: null, stale: false, customInstruction: instruction, originalGrade: action === 'synonyms' ? undefined : localGrade(snapshot.text, readabilityTarget), suggestedGrade: undefined });
    try {
      const response = await fetch(action === 'synonyms' ? '/api/ai/synonyms' : '/api/ai/rewrite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, action, ...(instruction ? { customInstruction: instruction } : {}) }), signal: controller.signal });
      const data = await readResponse<{ alternatives?: RewriteAlternative[]; suggestions?: Array<{ text: string; note: string | null }> }>(response);
      if (controller.signal.aborted || activeIdRef.current !== activeDocument.id) return;
      const alternatives = action === 'synonyms' ? (data.suggestions ?? []).map((item, index) => ({ id: `synonym-${index}`, text: item.text, rationale: item.note })) : (data.alternatives ?? []);
      if (!alternatives.length) throw new Error('AI returned no usable suggestion.');
      setReview((current) => current ? { ...current, loading: false, alternatives, activeIndex: 0, customPrompt: false, suggestedGrade: action === 'synonyms' ? undefined : localGrade(alternatives[0]?.text ?? '', readabilityTarget) } : current);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setReview((current) => current ? { ...current, loading: false, error: reason instanceof Error ? reason.message : 'AI is temporarily unavailable.' } : current);
    }
  }, [activeDocument, aiConfigured, dialect, readabilityTarget]);

  const startMakeSkimmable = useCallback(async (snapshot: SkimmableSourceSnapshot) => {
    if (!activeDocument) return;
    if (aiConfigured === false) { setError('Add your OpenAI API key to enable AI tools.'); return; }
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const requestId = crypto.randomUUID();
    const request: SkimmableRequest = {
      requestId,
      documentId: activeDocument.id,
      editorGeneration: snapshot.editorGeneration,
      source: { fragment: snapshot.sourceFragment, text: snapshot.sourceText, hash: snapshot.sourceHash },
      context: snapshot.context,
      dialect,
      readabilityTarget,
    };
    const requestSnapshot = { ...snapshot, requestId };
    setSkimmableReview({ snapshot: requestSnapshot, result: null, loading: true, error: null, stale: false });
    try {
      const response = await fetch('/api/ai/skimmable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      const result = await readResponse<SkimmableResponse>(response);
      if (controller.signal.aborted || activeIdRef.current !== activeDocument.id) return;
      setSkimmableReview((current) => current ? { ...current, loading: false, result } : current);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setSkimmableReview((current) => current ? { ...current, loading: false, error: reason instanceof Error ? reason.message : 'AI is temporarily unavailable.' } : current);
    }
  }, [activeDocument, aiConfigured, dialect, readabilityTarget]);

  const handleAiAction = useCallback((snapshot: SourceSnapshot, action: ToolbarAction) => { void startAiAction(snapshot, action); }, [startAiAction]);
  const handleSelectionChange = useCallback((snapshot: SourceSnapshot | null) => {
    setSelectedAiSnapshot(snapshot);
  }, []);
  const runTopAiAction = useCallback((action: ToolbarAction) => {
    if (!selectedAiSnapshot) return;
    setAiToolsOpen(false);
    void startAiAction(selectedAiSnapshot, action);
  }, [selectedAiSnapshot, startAiAction]);
  const handleMakeSkimmable = useCallback((snapshot: SkimmableSourceSnapshot) => { currentSkimmableSelectionRef.current = snapshot; void startMakeSkimmable(snapshot); }, [startMakeSkimmable]);
  const handleSkimmableSelectionChange = useCallback((snapshot: SkimmableSourceSnapshot | null) => { currentSkimmableSelectionRef.current = snapshot; }, []);
  const handleFindingAi = useCallback((action: RewriteAction) => {
    if (!selectedFinding) return;
    const snapshot: SourceSnapshot = { from: selectedFinding.pmFrom, to: selectedFinding.pmTo, text: selectedFinding.excerpt, textHash: selectedFinding.id, documentId: activeIdRef.current ?? undefined, editorGeneration: selectedFinding.editorGeneration, context: { before: '', after: '' } };
    void startAiAction(snapshot, action);
  }, [selectedFinding, startAiAction]);

  const acceptReview = useCallback(() => {
    if (!review || review.loading || review.stale) return;
    const alternative = review.alternatives[review.activeIndex];
    if (!alternative) return;
    setReplacementRequest({ documentId: activeDocument?.id ?? '', editorGeneration: review.snapshot.editorGeneration ?? 0, from: review.snapshot.from, to: review.snapshot.to, expectedText: review.snapshot.text, replacement: alternative.text });
  }, [activeDocument, review]);

  const acceptSynonym = useCallback((index: number) => {
    if (!review || review.action !== 'synonyms' || review.loading || review.stale) return;
    const alternative = review.alternatives[index];
    if (!alternative) return;
    setReplacementRequest({ documentId: activeDocument?.id ?? '', editorGeneration: review.snapshot.editorGeneration ?? 0, from: review.snapshot.from, to: review.snapshot.to, expectedText: review.snapshot.text, replacement: alternative.text });
  }, [activeDocument, review]);

  const acceptSkimmable = useCallback(() => {
    if (!skimmableReview || skimmableReview.loading || skimmableReview.stale || !skimmableReview.result) return;
    try {
      setBlockReplacementRequest({ snapshot: skimmableReview.snapshot, currentDocumentId: skimmableReview.snapshot.documentId, currentGeneration: skimmableReview.snapshot.editorGeneration, replacementSliceJson: skimmableAstToCanonicalFragment(skimmableReview.result, skimmableReview.snapshot.sourceText.length) });
    } catch {
      setSkimmableReview((current) => current ? { ...current, error: 'That structure could not be validated locally.' } : current);
    }
  }, [skimmableReview]);

  const handleDialectChange = useCallback((next: Dialect) => {
    setDialect(next);
    void fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dialect: next }) });
  }, []);

  const importFile = useCallback(async (file: File) => {
    try {
      aiAbortRef.current?.abort();
      setReview(null);
      setSkimmableReview(null);
      setBlockReplacementRequest(null);
      const form = new FormData();
      form.set('file', file);
      const imported = await readResponse<DocumentView>(await fetch('/api/imports', { method: 'POST', body: form }));
      activeIdRef.current = imported.id;
      latestContent.current = { id: imported.id, content: imported.content, revision: imported.revision };
      setActiveDocument(imported);
      setTitleDraft(imported.title);
      setActivePlainText(imported.plainText);
      setDocuments((current) => [imported, ...current.filter((item) => item.id !== imported.id)]);
      setAnalysis(null);
      setGrammarFindings([]);
      resetFeedback();
      setSelectedFinding(null);
      setFileMenuOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'We could not import that file.'); }
  }, [resetFeedback]);

  const exportDocument = useCallback((format: ExportFormat) => {
    if (!activeDocument) return;
    const link = document.createElement('a');
    link.href = `/api/documents/${activeDocument.id}/export?format=${format}`;
    link.download = sanitizeDownloadFilename(activeDocument.title, format);
    link.click();
    setFileMenuOpen(false);
  }, [activeDocument]);

  if (loading) return <main className="loading-shell" role="status">Opening your workspace…</main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label={`${PRODUCT_NAME} home`}><span className="brand-mark" aria-hidden="true">cw</span><span className="brand-name">{PRODUCT_NAME}</span></div>
        <nav className="top-nav" aria-label="Application sections">
          <div className="file-menu-wrap"><button className="nav-button" type="button" aria-expanded={fileMenuOpen} onClick={() => setFileMenuOpen((open) => !open)}>File</button>{fileMenuOpen ? <div className="file-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setFileMenuOpen(false); void createDocument(); }}>New document</button><button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>Import…</button><div className="file-menu-divider" /><span className="file-menu-label">Export as</span>{(['docx', 'md', 'html', 'txt'] as ExportFormat[]).map((format) => <button type="button" role="menuitem" key={format} disabled={!activeDocument} onClick={() => exportDocument(format)}>{format === 'docx' ? 'Word (.docx)' : format === 'md' ? 'Markdown (.md)' : format === 'html' ? 'HTML (.html)' : 'Plain text (.txt)'}</button>)}<div className="file-menu-divider" /><button type="button" role="menuitem" disabled={!activeDocument} onClick={() => { if (activeDocument) void duplicateActive(); setFileMenuOpen(false); }}>Duplicate</button><button type="button" role="menuitem" disabled={!activeDocument} onClick={() => { if (activeDocument) void deleteDocument(activeDocument); setFileMenuOpen(false); }}>Delete</button></div> : null}<input ref={fileInputRef} className="file-input-hidden" type="file" accept={SUPPORTED_IMPORT_EXTENSIONS.map((extension) => `.${extension}`).join(',')} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} /></div>
          <div className="file-menu-wrap ai-tools-wrap"><button className="nav-button" type="button" aria-expanded={aiToolsOpen} onClick={() => setAiToolsOpen((open) => !open)}>AI Tools</button>{aiToolsOpen ? <div className="file-menu ai-tools-menu" role="menu" aria-label="AI tools">
            {aiConfigured === false ? <><span className="file-menu-label">AI SETUP</span><span className="ai-tools-help">Add an OpenAI API key to use writing actions.</span><button type="button" role="menuitem" onClick={() => { setAiToolsOpen(false); setSettingsOpen(true); }}>Open Settings</button></> : selectedAiSnapshot ? <>
              <span className="file-menu-label">REWRITE SELECTION</span>
              <button type="button" role="menuitem" onClick={() => runTopAiAction('simplify')}>Simplify</button>
              <button type="button" role="menuitem" onClick={() => runTopAiAction('polish')}>Polish</button>
              <button type="button" role="menuitem" onClick={() => runTopAiAction('rephrase')}>Rephrase</button>
              <button type="button" role="menuitem" onClick={() => runTopAiAction('synonyms')}>Synonyms</button>
            </> : <><span className="file-menu-label">AI WRITING</span><span className="ai-tools-help">Select text in your draft to enable AI tools.</span><button type="button" role="menuitem" onClick={() => { setAiToolsOpen(false); document.querySelector<HTMLElement>('.tiptap-content')?.focus(); }}>Go to editor</button></>}
          </div> : null}</div>
          <div className="mode-switcher" role="group" aria-label="Writing mode">
            {modes.map((item) => <button className={`mode-button ${mode === item ? 'is-active' : ''}`} key={item} type="button" aria-pressed={mode === item} onClick={() => changeMode(item)}>{item}</button>)}
          </div>
          <button className="nav-button settings-button" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><span aria-hidden="true">◌</span>Settings</button>
        </nav>
      </header>

      <div className={`workspace ${mode === 'Write' ? 'write-mode' : ''}`}>
        <aside className="document-rail" aria-label="Documents">
          <button className="new-document" type="button" onClick={() => void createDocument()}><span className="new-icon" aria-hidden="true">＋</span><span>New document</span><span className="shortcut-hint">⌘ N</span></button>
          <div className="rail-section-label">RECENT</div>
          {documents.length === 0 ? <div className="rail-empty">Your drafts will appear here.</div> : documents.map((document) => (
            <div className={`document-card ${document.id === activeDocument?.id ? 'is-selected' : ''}`} key={document.id}>
              <button className="document-open" type="button" onClick={() => void switchDocument(document.id)}><span className="document-dot" aria-hidden="true" /><span><span className="document-title">{document.title}</span><span className="document-meta">{formatUpdatedAt(document.updatedAt)}</span></span></button>
              <button className="document-menu" type="button" aria-label={`Delete ${document.title}`} title="Delete document" onClick={() => void deleteDocument(document)}>×</button>
            </div>
          ))}
          <div className="rail-footer"><span className="sync-dot" aria-hidden="true" /><span>Saved locally</span></div>
        </aside>

        {!activeDocument ? <section className="empty-document-state"><div className="quiet-orbit" aria-hidden="true">✦</div><h1>Make room for a thought.</h1><p>Create your first document and let the page stay simple.</p><button className="primary-button" type="button" onClick={() => void createDocument()}>Create document</button></section> : <section className="editor-column" aria-label="Writing workspace">
          <div className="editor-header"><div><p className="eyebrow">{mode === 'Write' ? 'A quiet place to begin' : mode === 'Edit' ? 'A closer read' : 'A wider perspective'}</p><input className="document-title-input" aria-label="Document title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void renameActive()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div><div className="document-actions"><button className="share-button" type="button" aria-label="Duplicate document" title="Duplicate document" onClick={() => void duplicateActive()}>⧉</button><button className="share-button" type="button" aria-label="Delete document" title="Delete document" onClick={() => void deleteDocument(activeDocument)}>×</button></div></div>
          <div className="writing-surface"><RichTextEditor key={activeDocument.id} documentId={activeDocument.id} initialContent={activeDocument.content} analysisEnabled={mode === 'Edit'} grammarEnabled={mode === 'Edit'} grammarConfigured={aiConfigured} grammarDialect={dialect} onGrammarRequest={handleGrammarRequest} onGrammarFindings={handleGrammarFindings} readabilityTarget={readabilityTarget} visibleCategories={visibleCategories} replacementRequest={replacementRequest} blockReplacementRequest={blockReplacementRequest} onReplacementResult={handleReplacementResult} onBlockReplacementResult={handleBlockReplacementResult} onAnalysis={handleAnalysis} onFindingClick={handleFindingClick} onAiAction={handleAiAction} onMakeSkimmable={handleMakeSkimmable} onSkimmableSelectionChange={handleSkimmableSelectionChange} onSelectionChange={handleSelectionChange} onFocus={() => setError(null)} onChange={handleEditorChange} /></div>
          <footer className="editor-footer"><span>{wordCount(activePlainText)} words</span><span>Under 1 min read</span><span className="footer-spacer" /><span className={`save-status ${saveState}`}><span className="status-dot" aria-hidden="true" />{saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Save failed' : 'Saved locally'}</span></footer>
        </section>}

        <aside className={`insight-panel ${mode === 'Write' ? 'is-quiet' : ''}`} aria-label="Writing insights" aria-hidden={mode === 'Write'}>
          {mode === 'Write' ? <div className="quiet-state"><div className="quiet-orbit" aria-hidden="true"><span>✦</span></div><h2>Room to think</h2><p>Switch to Edit when you’re ready for a closer look at your draft.</p><button className="panel-link" type="button" onClick={() => changeMode('Edit')}>Open Edit mode <span aria-hidden="true">→</span></button></div> : mode === 'Edit' ? <AnalysisPanel result={analysis} visibleCategories={visibleCategories} target={readabilityTarget} onTargetChange={handleTargetChange} onToggle={handleToggle} selectedFinding={selectedFinding} onReplace={handleReplace} onAiAction={handleFindingAi} /> : <FeedbackPanel state={feedbackState} textLength={activePlainText.length} aiConfigured={aiConfigured} onGenerate={() => void handleFeedbackGenerate()} onCancel={handleFeedbackCancel} />}
        </aside>
      </div>
      {error ? <div className="toast-error" role="alert">{error}</div> : null}
      {review ? <RewriteReviewDialog review={review} onPrevious={() => setReview((current) => current ? { ...current, activeIndex: (current.activeIndex - 1 + current.alternatives.length) % current.alternatives.length, suggestedGrade: current.action === 'synonyms' ? undefined : localGrade(current.alternatives[(current.activeIndex - 1 + current.alternatives.length) % current.alternatives.length]?.text ?? '', readabilityTarget) } : current)} onNext={() => setReview((current) => current ? { ...current, activeIndex: (current.activeIndex + 1) % current.alternatives.length, suggestedGrade: current.action === 'synonyms' ? undefined : localGrade(current.alternatives[(current.activeIndex + 1) % current.alternatives.length]?.text ?? '', readabilityTarget) } : current)} onRegenerate={() => { if (review) void startAiAction(review.snapshot, review.action, review.customInstruction); }} onUse={acceptReview} onUseAlternative={acceptSynonym} onCustomSubmit={(instruction) => { if (review) void startAiAction(review.snapshot, 'custom', instruction); }} onCancel={() => { aiAbortRef.current?.abort(); setReview(null); setReplacementRequest(null); }} /> : null}
      {skimmableReview ? <MakeSkimmableReviewDialog review={skimmableReview} onReplace={acceptSkimmable} onRegenerate={() => { const fresh = currentSkimmableSelectionRef.current; if (fresh) void startMakeSkimmable(fresh); else { setSkimmableReview(null); setError('Select complete paragraphs or headings to generate a new suggestion.'); } }} onCancel={() => { aiAbortRef.current?.abort(); setSkimmableReview(null); setBlockReplacementRequest(null); }} /> : null}
      {settingsOpen ? <SettingsDialog dialect={dialect} onChange={handleDialectChange} onClose={() => setSettingsOpen(false)} aiConfigured={aiConfigured} /> : null}
    </main>
  );
}
