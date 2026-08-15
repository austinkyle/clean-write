'use client';
/* eslint-disable no-unused-vars */

import type { AnalysisResult, FindingCategory, MappedFinding, ReadabilityTarget } from '@/features/analysis/types';
import type { RewriteAction } from '@/features/ai/types';

type TargetChange = (...args: [ReadabilityTarget]) => void;
type CategoryToggle = (...args: [FindingCategory]) => void;

const rows: Array<{ category: FindingCategory; label: string; swatch: string }> = [
  { category: 'hard_sentence', label: 'Hard sentences', swatch: 'hard' },
  { category: 'very_hard_sentence', label: 'Very hard sentences', swatch: 'very-hard' },
  { category: 'adverb', label: 'Adverbs', swatch: 'style' },
  { category: 'qualifier', label: 'Qualifiers', swatch: 'style' },
  { category: 'passive_voice', label: 'Possible passive voice', swatch: 'style' },
  { category: 'complex_word', label: 'Complex words', swatch: 'complex' },
];

const correctnessRows: Array<{ category: FindingCategory; label: string; swatch: string }> = [
  { category: 'grammar', label: 'Grammar', swatch: 'grammar' },
  { category: 'spelling', label: 'Spelling', swatch: 'spelling' },
  { category: 'punctuation', label: 'Punctuation', swatch: 'punctuation' },
];

export function AnalysisPanel({ result, visibleCategories, target, onTargetChange, onToggle, selectedFinding, onReplace, onAiAction }: { result: AnalysisResult | null; visibleCategories: FindingCategory[]; target: ReadabilityTarget; onTargetChange: TargetChange; onToggle: CategoryToggle; selectedFinding: MappedFinding | null; onReplace?: (...args: [string]) => void; onAiAction?: (...args: [RewriteAction]) => void }) {
  const count = (category: FindingCategory) => result ? result.findings.filter((finding) => finding.category === category).length : '—';
  return <div className="analysis-panel-content">
    <div className="panel-heading-row"><div><div className="eyebrow">READABILITY</div><h2>{result?.readability.grade === null || !result ? '—' : `Grade ${result.readability.grade.toFixed(1)}`}</h2></div><select className="target-select" aria-label="Readability target" value={target} onChange={(event) => onTargetChange(event.target.value as ReadabilityTarget)}><option value="accessible">Accessible</option><option value="default">Default</option><option value="technical">Technical</option></select></div>
    <p className="analysis-caveat">Local heuristic estimate · Target: {target[0].toUpperCase() + target.slice(1)}</p>
    <section className="analysis-section"><div className="eyebrow">DOCUMENT</div><div className="stats-grid"><span>Words<strong>{result?.statistics.words ?? '—'}</strong></span><span>Sentences<strong>{result?.statistics.sentences ?? '—'}</strong></span><span>Paragraphs<strong>{result?.statistics.paragraphs ?? '—'}</strong></span><span>Letters<strong>{result?.statistics.letters ?? '—'}</strong></span><span>Characters<strong>{result?.statistics.characters ?? '—'}</strong></span><span>Reading time<strong>{result ? (result.statistics.readingMinutes === 0 ? '0 min' : result.statistics.readingMinutes === 1 ? 'Under 1 min' : `${result.statistics.readingMinutes} min`) : '—'}</strong></span></div></section>
    <section className="analysis-section"><div className="eyebrow">STYLE</div><div className="analysis-rows">{rows.map((row) => <button className={`analysis-row ${visibleCategories.includes(row.category) ? 'is-visible' : 'is-muted'}`} type="button" key={row.category} aria-pressed={visibleCategories.includes(row.category)} onClick={() => onToggle(row.category)}><span className={`analysis-swatch ${row.swatch}`} aria-hidden="true" /><span>{row.label}</span><strong>{count(row.category)}</strong></button>)}</div></section>
    <section className="analysis-section"><div className="eyebrow">CORRECTNESS</div><div className="analysis-rows">{correctnessRows.map((row) => <button className={`analysis-row ${visibleCategories.includes(row.category) ? 'is-visible' : 'is-muted'}`} type="button" key={row.category} aria-pressed={visibleCategories.includes(row.category)} onClick={() => onToggle(row.category)}><span className={`analysis-swatch ${row.swatch}`} aria-hidden="true" /><span>{row.label}</span><strong>{count(row.category)}</strong></button>)}</div></section>
    {selectedFinding ? <section className="finding-detail" aria-live="polite"><div className="eyebrow">{selectedFinding.category.replaceAll('_', ' ').toUpperCase()}</div><p className="finding-excerpt">“{selectedFinding.excerpt}”</p><p>{selectedFinding.explanation}</p>{selectedFinding.category === 'hard_sentence' || selectedFinding.category === 'very_hard_sentence' ? <button className="ai-finding-action" type="button" onClick={() => onAiAction?.('hard_sentence_simplify')}>Simplify with AI</button> : null}{selectedFinding.category === 'passive_voice' ? <button className="ai-finding-action" type="button" onClick={() => onAiAction?.('passive_rewrite')}>Rewrite active with AI</button> : null}{selectedFinding.category === 'adverb' ? <button className="ai-finding-action" type="button" onClick={() => onAiAction?.('adverb_rewrite')}>Improve with AI</button> : null}{selectedFinding.suggestions?.length ? <div className="finding-suggestions">Try: {selectedFinding.suggestions.map((suggestion) => <button type="button" key={suggestion.replacement} onClick={() => onReplace?.(suggestion.replacement)}>{suggestion.label}</button>)}</div> : null}</section> : null}
  </div>;
}
