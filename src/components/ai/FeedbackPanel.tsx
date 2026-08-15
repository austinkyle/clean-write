'use client';

import type { FeedbackResponse } from '@/features/ai/types';

export type FeedbackPanelState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' | 'stale'; result: FeedbackResponse };

export function FeedbackPanel({ state, textLength, aiConfigured, onGenerate, onCancel }: { state: FeedbackPanelState; textLength: number; aiConfigured: boolean | null; onGenerate: () => void; onCancel: () => void }) {
  if (aiConfigured === false) return <div className="feedback-panel-content"><div className="feedback-icon" aria-hidden="true">✧</div><div className="eyebrow">FEEDBACK</div><h2>AI feedback is unavailable.</h2><p>Add your OpenAI API key in Settings to request document feedback.</p></div>;
  if (aiConfigured === null) return <div className="feedback-panel-content" role="status"><div className="eyebrow">FEEDBACK</div><h2>Checking AI configuration…</h2></div>;
  if (textLength === 0) return <div className="feedback-panel-content"><div className="feedback-icon" aria-hidden="true">✧</div><div className="eyebrow">FEEDBACK</div><h2>Get AI feedback on this document.</h2><p>Add some writing first, then request a structured editorial read.</p><button className="primary-button" type="button" disabled>Get Feedback</button></div>;
  if (textLength > 30_000) return <div className="feedback-panel-content"><div className="eyebrow">FEEDBACK</div><h2>This document is too long.</h2><p>Full-document Feedback is limited to 30,000 characters. Try a shorter version.</p></div>;
  if (state.status === 'loading') return <div className="feedback-panel-content" role="status"><div className="eyebrow">FEEDBACK</div><h2>Generating Feedback…</h2><p>Terra is reading the current document. Your writing remains unchanged.</p><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button></div>;
  if (state.status === 'error') return <div className="feedback-panel-content"><div className="eyebrow">FEEDBACK</div><h2>Feedback could not be generated.</h2><p>{state.message}</p><button className="primary-button" type="button" onClick={onGenerate}>Try again</button></div>;
  if (state.status === 'empty') return <div className="feedback-panel-content"><div className="feedback-icon" aria-hidden="true">✧</div><div className="eyebrow">FEEDBACK</div><h2>Understand the draft before you revise.</h2><p>Get a concise read on what works and what to fix first.</p><button className="primary-button" type="button" onClick={onGenerate}>Get Feedback</button></div>;

  const { result } = state;
  return <div className="feedback-panel-content">
    <div className="feedback-heading"><div><div className="eyebrow">FEEDBACK</div><h2>How this draft is doing</h2></div><button className="secondary-button" type="button" onClick={onGenerate}>Regenerate</button></div>
    {state.status === 'stale' ? <div className="feedback-stale" role="status">This Feedback is out of date because the document changed. <button type="button" onClick={onGenerate}>Refresh</button></div> : null}
    <section className="feedback-section feedback-summary"><div className="eyebrow">OVERALL</div><p>{result.overallSummary}</p></section>
    <section className="feedback-section"><div className="eyebrow">TOP IMPROVEMENTS</div><div className="feedback-improvements">{[...result.priorityImprovements].sort((a, b) => a.rank - b.rank).map((item) => <article className="feedback-card" key={`${item.rank}-${item.title}`}><div className="feedback-rank">{item.rank}</div><div><strong>{item.title}</strong><span className="feedback-category">{item.category}</span><p>{item.detail}</p><p className="feedback-recommendation">{item.recommendation}</p></div></article>)}</div></section>
    <section className="feedback-section"><div className="eyebrow">STRENGTHS</div><div className="feedback-list">{result.strengths.map((item) => <article key={item.title}><strong>{item.title}</strong><p>{item.detail}</p></article>)}</div></section>
    <section className="feedback-section"><div className="eyebrow">BY CATEGORY</div><div className="feedback-list">{result.areas.map((item) => <article key={item.category}><strong>{item.category}</strong><p>{item.assessment}</p></article>)}</div></section>
  </div>;
}
