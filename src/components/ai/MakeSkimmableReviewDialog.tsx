'use client';

import type { ReactNode } from 'react';
import type { SkimmableBlock, SkimmableInline, SkimmableResponse, SkimmableSourceSnapshot } from '@/features/ai/types';

export type MakeSkimmableReview = {
  snapshot: SkimmableSourceSnapshot;
  result: SkimmableResponse | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
};

function renderInline(content: SkimmableInline): ReactNode {
  return content.map((run, index) => {
    let value: ReactNode = run.text;
    for (const mark of [...(run.marks ?? [])].reverse()) {
      value = mark.type === 'bold' ? <strong key={`${index}-bold`}>{value}</strong> : <em key={`${index}-italic`}>{value}</em>;
    }
    return <span key={index}>{value}</span>;
  });
}

function renderBlock(block: SkimmableBlock, index: number): ReactNode {
  if (block.type === 'heading') return <h3 key={index}>{renderInline(block.content)}</h3>;
  if (block.type === 'paragraph') return <p key={index}>{renderInline(block.content)}</p>;
  const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item.content)}</li>);
  return block.type === 'orderedList' ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
}

export function MakeSkimmableReviewDialog({ review, onReplace, onRegenerate, onCancel }: { review: MakeSkimmableReview; onReplace: () => void; onRegenerate: () => void; onCancel: () => void }) {
  return <div className="ai-dialog-backdrop" role="presentation">
    <section className="ai-review-dialog skimmable-review-dialog" role="dialog" aria-modal="true" aria-labelledby="skimmable-review-title">
      <div className="ai-dialog-header"><div><p className="eyebrow">MAKE SKIMMABLE</p><h2 id="skimmable-review-title">Review the structure</h2></div><button className="ai-dialog-close" type="button" aria-label="Cancel Make Skimmable" onClick={onCancel}>×</button></div>
      {review.loading ? <div className="ai-review-loading" role="status">Building a clearer structure…<button type="button" onClick={onCancel}>Cancel</button></div> : review.error ? <div className="ai-review-error" role="alert"><p>{review.error}</p><button className="primary-button" type="button" onClick={onRegenerate}>Try again</button></div> : review.stale ? <div className="ai-review-error" role="alert"><p>This document changed while the suggestion was being generated. Generate a new suggestion.</p><button className="primary-button" type="button" onClick={onRegenerate}>Generate new suggestion</button></div> : review.result ? <>
        <div className="skimmable-review-columns">
          <div><div className="eyebrow">ORIGINAL</div><p className="ai-review-text">{review.snapshot.sourceText}</p><span className="ai-grade">{review.snapshot.topLevelEnd - review.snapshot.topLevelStart} selected blocks</span></div>
          <div><div className="eyebrow">SUGGESTED STRUCTURE</div><div className="skimmable-preview-content">{review.result.fragment.map(renderBlock)}</div></div>
        </div>
        <div className="ai-review-controls"><span className="ai-controls-spacer" /><button type="button" onClick={onRegenerate}>Regenerate</button><button className="primary-button" type="button" onClick={onReplace}>Replace {review.snapshot.topLevelEnd - review.snapshot.topLevelStart} blocks</button></div>
      </> : null}
    </section>
  </div>;
}
