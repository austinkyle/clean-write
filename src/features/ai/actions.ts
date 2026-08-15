import type { RewriteAction } from './types';

export type ActionConfig = {
  id: RewriteAction;
  model: 'gpt-5.6-luna' | 'gpt-5.6-terra';
  reasoningEffort: 'none' | 'low' | 'medium';
  maxOutputTokens: number;
  maxSourceChars: number;
  maxContextChars: number;
  maxCandidates: number;
  promptKey: string;
};

export const REWRITE_ACTIONS: readonly RewriteAction[] = ['simplify', 'polish', 'rephrase', 'shorten', 'add_detail', 'more_confident', 'more_friendly', 'more_casual', 'more_formal', 'more_persuasive', 'custom', 'hard_sentence_simplify', 'passive_rewrite', 'adverb_rewrite'];

const LUNA: Omit<ActionConfig, 'id' | 'promptKey'> = { model: 'gpt-5.6-luna', reasoningEffort: 'low', maxOutputTokens: 900, maxSourceChars: 8000, maxContextChars: 1600, maxCandidates: 2 };
const CONFIG: Record<RewriteAction, ActionConfig> = {
  simplify: { ...LUNA, id: 'simplify', promptKey: 'simplify' },
  polish: { ...LUNA, id: 'polish', promptKey: 'polish' },
  rephrase: { ...LUNA, id: 'rephrase', promptKey: 'rephrase', maxCandidates: 3 },
  shorten: { ...LUNA, id: 'shorten', promptKey: 'shorten' },
  add_detail: { ...LUNA, id: 'add_detail', promptKey: 'add_detail', maxOutputTokens: 1600 },
  more_confident: { ...LUNA, id: 'more_confident', promptKey: 'tone_confident' },
  more_friendly: { ...LUNA, id: 'more_friendly', promptKey: 'tone_friendly' },
  more_casual: { ...LUNA, id: 'more_casual', promptKey: 'tone_casual' },
  more_formal: { ...LUNA, id: 'more_formal', promptKey: 'tone_formal' },
  more_persuasive: { ...LUNA, id: 'more_persuasive', promptKey: 'tone_persuasive' },
  custom: { ...LUNA, id: 'custom', promptKey: 'custom', model: 'gpt-5.6-terra', reasoningEffort: 'low' },
  hard_sentence_simplify: { ...LUNA, id: 'hard_sentence_simplify', promptKey: 'simplify' },
  passive_rewrite: { ...LUNA, id: 'passive_rewrite', promptKey: 'passive_rewrite' },
  adverb_rewrite: { ...LUNA, id: 'adverb_rewrite', promptKey: 'adverb_rewrite' },
};

export function getActionConfig(action: RewriteAction): ActionConfig { return CONFIG[action]; }

export const SYNONYM_CONFIG = { model: 'gpt-5.6-luna' as const, reasoningEffort: 'none' as const, maxOutputTokens: 300, maxSourceChars: 128, maxContextChars: 2000, maxCandidates: 8, promptKey: 'synonyms' };
export const GRAMMAR_CONFIG = { model: 'gpt-5.6-luna' as const, reasoningEffort: 'low' as const, maxOutputTokens: 1800, maxSourceChars: 6000, maxTotalChars: 20_000, maxSources: 100, promptKey: 'grammar-v1' };
export const FEEDBACK_CONFIG = { model: 'gpt-5.6-terra' as const, reasoningEffort: 'medium' as const, maxOutputTokens: 3000, maxSourceChars: 30_000, promptKey: 'feedback-v1' };
export const SKIMMABLE_CONFIG = { model: 'gpt-5.6-terra' as const, reasoningEffort: 'low' as const, maxOutputTokens: 1600, maxSourceChars: 8_000, maxContextChars: 800, promptKey: 'make-skimmable-v1' };
