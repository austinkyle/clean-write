/* eslint-disable no-unused-vars */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { MappedFinding, FindingCategory } from '@/features/analysis/types';

export const analysisPluginKey = new PluginKey<AnalysisPluginState>('cleanwrite-analysis');
export type AnalysisMeta =
  | { type: 'replace'; findings: MappedFinding[]; visibleCategories: FindingCategory[]; generation: number }
  | { type: 'grammar-invalidate'; blockIndexes: number[] }
  | { type: 'grammar-replace'; findings: MappedFinding[]; blockIndexes: number[]; visibleCategories: FindingCategory[]; generation: number }
  | { type: 'visibility'; visibleCategories: FindingCategory[] }
  | { type: 'clear' };
export type AnalysisPluginState = { findings: MappedFinding[]; visibleCategories: Set<FindingCategory>; decorations: DecorationSet; stale: boolean };

const PRIORITY: Record<FindingCategory, number> = { grammar: 0, spelling: 1, punctuation: 2, complex_word: 3, passive_voice: 4, qualifier: 5, adverb: 6, very_hard_sentence: 7, hard_sentence: 8 };
const CLASS_NAMES: Record<FindingCategory, string> = { hard_sentence: 'analysis-hard-sentence', very_hard_sentence: 'analysis-very-hard-sentence', adverb: 'analysis-adverb', qualifier: 'analysis-qualifier', passive_voice: 'analysis-passive', complex_word: 'analysis-complex-word', grammar: 'analysis-grammar', spelling: 'analysis-spelling', punctuation: 'analysis-punctuation' };

function makeDecorations(doc: Parameters<typeof DecorationSet.create>[0], findings: MappedFinding[], visible: Set<FindingCategory>) {
  return DecorationSet.create(doc, findings.filter((finding) => visible.has(finding.category) && !finding.isStale).map((finding) => {
    const attrs = { findingId: finding.id, category: finding.category };
    if (finding.pmFrom === finding.pmTo) return Decoration.widget(finding.pmFrom, () => { const marker = document.createElement('span'); marker.className = CLASS_NAMES[finding.category]; marker.setAttribute('data-finding-id', finding.id); return marker; }, { side: 1, key: finding.id });
    return Decoration.inline(finding.pmFrom, finding.pmTo, { class: CLASS_NAMES[finding.category] }, attrs);
  }));
}

export type AnalysisExtensionOptions = { onFindingClick?: (...args: [MappedFinding]) => void };

export const AnalysisExtension = Extension.create<AnalysisExtensionOptions>({
  name: 'cleanwriteAnalysis',
  addOptions() { return { onFindingClick: undefined }; },
  addProseMirrorPlugins() {
    const onFindingClick = this.options.onFindingClick;
    return [new Plugin<AnalysisPluginState>({
      key: analysisPluginKey,
      state: {
        init: () => ({ findings: [], visibleCategories: new Set<FindingCategory>(['hard_sentence', 'very_hard_sentence', 'adverb', 'qualifier', 'passive_voice', 'complex_word', 'grammar', 'spelling', 'punctuation']), decorations: DecorationSet.empty, stale: false }),
        apply: (transaction, previous) => {
          const meta = transaction.getMeta(analysisPluginKey) as AnalysisMeta | undefined;
          const mappedFindings = transaction.docChanged ? previous.findings.map((finding) => ({ ...finding, pmFrom: transaction.mapping.map(finding.pmFrom, -1), pmTo: transaction.mapping.map(finding.pmTo, 1), isStale: finding.category === 'grammar' || finding.category === 'spelling' || finding.category === 'punctuation' ? false : true })) : previous.findings;
          const mappedDecorations = transaction.docChanged ? previous.decorations.map(transaction.mapping, transaction.doc) : previous.decorations;
          if (meta?.type === 'clear') return { ...previous, findings: [], decorations: DecorationSet.empty, stale: false };
          if (meta?.type === 'visibility') return { ...previous, visibleCategories: new Set(meta.visibleCategories), decorations: makeDecorations(transaction.doc, previous.findings, new Set(meta.visibleCategories)) };
          if (meta?.type === 'replace') {
            const visible = new Set(meta.visibleCategories);
            const grammar = previous.findings.filter((finding) => (finding.category === 'grammar' || finding.category === 'spelling' || finding.category === 'punctuation') && !finding.isStale);
            const findings = [...meta.findings, ...grammar];
            return { findings, visibleCategories: visible, decorations: makeDecorations(transaction.doc, findings, visible), stale: false };
          }
          if (meta?.type === 'grammar-invalidate') {
            const changed = new Set(meta.blockIndexes);
            const findings = previous.findings.map((finding) => changed.has(Number(finding.metadata.blockIndex)) ? { ...finding, isStale: true } : finding);
            return { ...previous, findings, decorations: makeDecorations(transaction.doc, findings, previous.visibleCategories) };
          }
          if (meta?.type === 'grammar-replace') {
            const visible = new Set(meta.visibleCategories);
            const changed = new Set(meta.blockIndexes);
            const existing = previous.findings.filter((finding) => !(finding.category === 'grammar' || finding.category === 'spelling' || finding.category === 'punctuation') || (!changed.has(Number(finding.metadata.blockIndex)) && !finding.isStale));
            const findings = [...existing, ...meta.findings];
            return { findings, visibleCategories: visible, decorations: makeDecorations(transaction.doc, findings, visible), stale: false };
          }
          return { ...previous, findings: mappedFindings, decorations: transaction.docChanged ? mappedDecorations : previous.decorations, stale: transaction.docChanged && previous.findings.length > 0 ? true : previous.stale };
        },
      },
      props: {
        decorations: (state) => analysisPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
        handleClick: (view, _pos, event) => {
          const pluginState = analysisPluginKey.getState(view.state);
          if (!pluginState || !onFindingClick) return false;
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!coords) return false;
          const candidates = pluginState.findings.filter((finding) => !finding.isStale && pluginState.visibleCategories.has(finding.category) && finding.pmFrom <= coords.pos && finding.pmTo >= coords.pos);
          const chosen = candidates.sort((a, b) => (a.pmTo - a.pmFrom) - (b.pmTo - b.pmFrom) || PRIORITY[a.category] - PRIORITY[b.category])[0];
          if (!chosen) return false;
          onFindingClick(chosen);
          return true;
        },
      },
    })];
  },
});
