/* eslint-disable no-unused-vars */
import type { z } from 'zod';
import type { Dialect } from './dialect';
import type { FindingCategory, MappedFinding, Projection, ReadabilityTarget } from '@/features/analysis/types';
import type { TiptapNode } from '@/features/documents/content';

export const REWRITE_ACTION_IDS = ['simplify', 'polish', 'rephrase', 'shorten', 'add_detail', 'more_confident', 'more_friendly', 'more_casual', 'more_formal', 'more_persuasive', 'custom', 'hard_sentence_simplify', 'passive_rewrite', 'adverb_rewrite'] as const;
export type RewriteAction = (typeof REWRITE_ACTION_IDS)[number];

export type SourceSnapshot = { from: number; to: number; text: string; textHash: string; documentId?: string; editorGeneration?: number; context?: { before: string; after: string } };
export type ToolbarAction = RewriteAction | 'synonyms';
export type AIRequestBase = {
  requestId: string;
  documentId: string;
  editorGeneration: number;
  source: SourceSnapshot;
  context?: { before: string; after: string };
  dialect: Dialect;
  readabilityTarget?: ReadabilityTarget;
  targetGrade?: number;
};
export type RewriteRequest = AIRequestBase & { action: RewriteAction; customInstruction?: string; finding?: { category: string; message: string; metadata?: Record<string, string | number | boolean | string[]> } };
export type SynonymRequest = AIRequestBase & { action: 'synonyms' };
export type RewriteAlternative = { id: string; text: string; rationale: string | null };
export type RewriteResponse = { alternatives: RewriteAlternative[] };
export type SynonymResponse = { suggestions: Array<{ text: string; note: string | null }> };
export type GrammarCategory = Extract<FindingCategory, 'grammar' | 'spelling' | 'punctuation'>;
export type GrammarSource = { sourceId: string; text: string; textHash: string; projectionStart: number; blockIndex: number };
export type GrammarRequest = { requestId: string; documentId: string; editorGeneration: number; dialect: Dialect; sources: GrammarSource[] };
export type GrammarIssue = { sourceId: string; start: number; end: number; original: string; category: GrammarCategory; subtype: string; explanation: string; replacement: string; confidence: 'low' | 'medium' | 'high' };
export type GrammarResponse = { issues: GrammarIssue[] };
export type GrammarCheckSnapshot = GrammarRequest & { projection: Projection };
export type GrammarMappedFinding = { finding: MappedFinding; sourceId: string };
export const FEEDBACK_CATEGORIES = ['clarity', 'organization', 'logic', 'flow', 'tone', 'concision', 'repetition', 'consistency'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackMetrics = { readabilityGrade?: number; targetGrade?: number; words: number; sentences: number };
export type FeedbackRequest = { requestId: string; documentId: string; editorGeneration: number; text: string; textHash: string; title?: string; dialect: Dialect; metrics?: FeedbackMetrics };
export type FeedbackStrength = { title: string; detail: string };
export type FeedbackImprovement = { rank: number; category: FeedbackCategory; title: string; detail: string; recommendation: string };
export type FeedbackArea = { category: FeedbackCategory; assessment: string };
export type FeedbackResponse = { overallSummary: string; strengths: FeedbackStrength[]; priorityImprovements: FeedbackImprovement[]; areas: FeedbackArea[] };

export type SkimmableMark = { type: 'bold' } | { type: 'italic' };
export type SkimmableText = { type: 'text'; text: string; marks?: SkimmableMark[] };
export type SkimmableInline = SkimmableText[];
export type SkimmableListItem = { content: SkimmableInline };
export type SkimmableBlock =
  | { type: 'paragraph'; content: SkimmableInline }
  | { type: 'heading'; level: 1 | 2 | 3; content: SkimmableInline }
  | { type: 'bulletList' | 'orderedList'; items: SkimmableListItem[] };
export type SkimmableResponse = { fragment: SkimmableBlock[] };
export type SkimmableSourceBlock = Extract<SkimmableBlock, { type: 'paragraph' | 'heading' }>;
export type SkimmableRequest = {
  requestId: string;
  documentId: string;
  editorGeneration: number;
  source: { fragment: SkimmableSourceBlock[]; text: string; hash: string };
  context?: { before: string; after: string };
  dialect: Dialect;
  readabilityTarget?: ReadabilityTarget;
};
export type SkimmableSourceSnapshot = {
  requestId: string;
  documentId: string;
  editorGeneration: number;
  from: number;
  to: number;
  topLevelStart: number;
  topLevelEnd: number;
  expectedSourceSliceJson: ReadonlyArray<TiptapNode>;
  sourceHash: string;
  sourceText: string;
  sourceFragment: SkimmableSourceBlock[];
  context?: { before: string; after: string };
};

export type ProviderStructuredRequest<T> = {
  requestId?: string;
  action: string;
  model: string;
  reasoningEffort: 'none' | 'low' | 'medium';
  maxOutputTokens: number;
  instructions: string;
  dataPacket: string;
  schemaName: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  store: false;
};

export interface AIProvider {
  readonly id: string;
  isConfigured(): boolean;
  executeStructured<T>(request: ProviderStructuredRequest<T>): Promise<T>;
}
