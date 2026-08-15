'use client';

import type { RewriteAlternative, ToolbarAction } from '@/features/ai/types';

export type RewriteReview = {
  original: string;
  alternatives: RewriteAlternative[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  stale: boolean;
  originalGrade?: number | null;
  suggestedGrade?: number | null;
  action?: ToolbarAction;
  customInstruction?: string;
  customPrompt?: boolean;
};

// eslint-disable-next-line no-unused-vars
export function RewriteReviewDialog({ review, onPrevious, onNext, onRegenerate, onUse, onUseAlternative, onCustomSubmit, onCancel }: { review: RewriteReview; onPrevious: () => void; onNext: () => void; onRegenerate: () => void; onUse: () => void; onUseAlternative?: (index: number) => void; onCustomSubmit?: (instruction: string) => void; onCancel: () => void }) {
  const alternative = review.alternatives[review.activeIndex];
  return <div className="ai-dialog-backdrop" role="presentation">
    <section className="ai-review-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-review-title">
      <div className="ai-dialog-header"><div><p className="eyebrow">AI SUGGESTION</p><h2 id="ai-review-title">Review the change</h2></div><button className="ai-dialog-close" type="button" aria-label="Cancel AI suggestion" onClick={onCancel}>×</button></div>
      {review.customPrompt ? <form className="ai-custom-form" onSubmit={(event) => { event.preventDefault(); const instruction = new FormData(event.currentTarget).get('instruction'); if (typeof instruction === 'string' && instruction.trim()) onCustomSubmit?.(instruction.trim()); }}><label htmlFor="custom-ai-instruction">Ask AI to change this</label><input id="custom-ai-instruction" name="instruction" autoFocus maxLength={500} placeholder="e.g. remove the jargon" /><div className="ai-review-controls"><button type="button" onClick={onCancel}>Cancel</button><span className="ai-controls-spacer" /><button className="primary-button" type="submit">Generate</button></div></form> : review.loading ? <div className="ai-review-loading" role="status">Thinking through your wording…<button type="button" onClick={onCancel}>Cancel</button></div> : review.error ? <div className="ai-review-error" role="alert"><p>{review.error}</p><button className="primary-button" type="button" onClick={onRegenerate}>Try again</button></div> : review.stale ? <div className="ai-review-error" role="alert"><p>The document changed while this suggestion was being generated. Generate a new suggestion.</p><button className="primary-button" type="button" onClick={onRegenerate}>Generate new suggestion</button></div> : review.action === 'synonyms' ? <div className="ai-synonym-options"><div className="eyebrow">CONTEXTUAL OPTIONS</div><p>Choose a replacement that fits this sentence.</p><div className="ai-synonym-list">{review.alternatives.map((item, index) => <button type="button" key={item.id} onClick={() => onUseAlternative?.(index)}>{item.text}</button>)}</div><button type="button" onClick={onCancel}>Cancel</button></div> : alternative ? <>
        <div className="ai-review-columns"><div><div className="eyebrow">ORIGINAL</div><p className="ai-review-text">{review.original}</p>{review.originalGrade !== undefined ? <span className="ai-grade">Grade {review.originalGrade === null ? '—' : review.originalGrade.toFixed(1)}</span> : null}</div><div><div className="eyebrow">SUGGESTION</div><p className="ai-review-text">{alternative.text}</p>{review.suggestedGrade !== undefined ? <span className="ai-grade">Grade {review.suggestedGrade === null ? '—' : review.suggestedGrade.toFixed(1)}</span> : null}</div></div>
        {alternative.rationale ? <p className="ai-rationale">{alternative.rationale}</p> : null}
        <div className="ai-review-controls"><button type="button" onClick={onPrevious} disabled={review.alternatives.length < 2}>Previous</button><span>{review.activeIndex + 1} / {review.alternatives.length}</span><button type="button" onClick={onNext} disabled={review.alternatives.length < 2}>Next</button><span className="ai-controls-spacer" /><button type="button" onClick={onRegenerate}>Regenerate</button><button className="primary-button" type="button" onClick={onUse}>Use Suggestion</button></div>
      </> : null}
    </section>
  </div>;
}
