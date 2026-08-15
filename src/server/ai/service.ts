/* eslint-disable no-unused-vars */
import { z } from 'zod';
import { FEEDBACK_CONFIG, getActionConfig, GRAMMAR_CONFIG, SKIMMABLE_CONFIG, SYNONYM_CONFIG } from '@/features/ai/actions';
import { FeedbackResponseSchema, GrammarResponseSchema, RewriteResponseSchema, SkimmableProviderResponseSchema, SynonymResponseSchema } from '@/features/ai/schemas';
import type { FeedbackRequest, FeedbackResponse, GrammarRequest, GrammarResponse, RewriteRequest, RewriteResponse, SkimmableRequest, SkimmableResponse, SynonymRequest, SynonymResponse, ProviderStructuredRequest } from '@/features/ai/types';
import { AIError, normalizeAIError } from './errors';
import { buildMakeSkimmablePrompt, buildRewritePrompt, buildSynonymPrompt } from './prompts';
import type { AIProvider } from './provider';
import { recordAIUsage } from './usage';
import { buildFeedbackPrompt, buildGrammarPrompt } from './prompts';
import { clearGrammarInFlight, getGrammarCache, getGrammarInFlight, setGrammarCache, setGrammarInFlight } from './grammar-cache';
import { normalizeSkimmableProviderResponse, validateSkimmableResponse } from '@/features/ai/skimmable';

const customMaxContext = 800;
function sourceLimits(request: RewriteRequest | SynonymRequest, maxSource: number, maxContext: number) {
  if (request.source.text.length > maxSource || (request.context?.before.length ?? 0) > maxContext || (request.context?.after.length ?? 0) > maxContext) throw new AIError('AI_INPUT_TOO_LARGE', 'That selection is too large for this AI action.');
}
function validateAlternatives(value: unknown, max: number): RewriteResponse {
  const parsed = RewriteResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.alternatives.length > max) throw new AIError('AI_INVALID_RESPONSE', 'AI returned no usable suggestion.');
  const normalized = parsed.data.alternatives.map((item) => ({ ...item, text: item.text.trim() }));
  if (normalized.some((item) => !item.text || item.text.length > 8000 || item.text.includes('```')) || new Set(normalized.map((item) => item.text)).size !== normalized.length) throw new AIError('AI_INVALID_RESPONSE', 'AI returned duplicate or unusable suggestions.');
  return { alternatives: normalized };
}
function validateSynonyms(value: unknown): SynonymResponse {
  const parsed = SynonymResponseSchema.safeParse(value);
  if (!parsed.success) throw new AIError('AI_INVALID_RESPONSE', 'AI returned no usable synonyms.');
  const suggestions = parsed.data.suggestions.map((item) => ({ ...item, text: item.text.trim() }));
  if (suggestions.some((item) => !item.text || item.text.includes('```')) || new Set(suggestions.map((item) => item.text.toLowerCase())).size !== suggestions.length) throw new AIError('AI_INVALID_RESPONSE', 'AI returned duplicate or unusable synonyms.');
  return { suggestions };
}

export class AIService {
  constructor(private readonly provider: AIProvider, private readonly retryDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 501))), private readonly models: { rewriteModel?: string; reviewModel?: string } = {}) {}
  private async execute<T>(request: ProviderStructuredRequest<T>, attempts = 0): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await this.provider.executeStructured(request);
      recordAIUsage({ requestId: request.requestId, action: request.action, model: request.model, startedAt, durationMs: Date.now() - startedAt, retryCount: attempts });
      return result;
    }
    catch (error) {
      const normalized = normalizeAIError(error);
      if (normalized.retryable && attempts === 0) { await this.retryDelay(); return this.execute(request, 1); }
      recordAIUsage({ requestId: request.requestId, action: request.action, model: request.model, startedAt, durationMs: Date.now() - startedAt, retryCount: attempts, errorCode: normalized.code });
      throw normalized;
    }
  }
  async rewrite(request: RewriteRequest): Promise<RewriteResponse> {
    const config = getActionConfig(request.action);
    sourceLimits(request, config.maxSourceChars, customMaxContext);
    const instructions = buildRewritePrompt({ action: request.action, dialect: request.dialect, targetText: request.source.text, contextBefore: request.context?.before ?? '', contextAfter: request.context?.after ?? '', customInstruction: request.customInstruction, targetGrade: request.targetGrade, readabilityTarget: request.readabilityTarget });
    const schema = z.object({ alternatives: z.array(z.object({ id: z.string(), text: z.string(), rationale: z.string().nullable() })) });
    const output = await this.execute({ requestId: request.requestId, action: request.action, model: config.model === 'gpt-5.6-terra' ? (this.models.reviewModel ?? config.model) : (this.models.rewriteModel ?? config.model), reasoningEffort: config.reasoningEffort, maxOutputTokens: config.maxOutputTokens, instructions, dataPacket: JSON.stringify({ target: request.source.text, before: request.context?.before ?? '', after: request.context?.after ?? '', customInstruction: request.customInstruction ?? null, finding: request.finding ?? null, readabilityTarget: request.readabilityTarget ?? null, targetGrade: request.targetGrade ?? null }), schemaName: 'cleanwrite_rewrite', schema, store: false });
    return validateAlternatives(output, config.maxCandidates);
  }
  async synonyms(request: SynonymRequest): Promise<SynonymResponse> {
    sourceLimits(request, SYNONYM_CONFIG.maxSourceChars, SYNONYM_CONFIG.maxContextChars);
    const schema = z.object({ suggestions: z.array(z.object({ text: z.string(), note: z.string().nullable() })) });
    const output = await this.execute({ requestId: request.requestId, action: 'synonyms', model: this.models.rewriteModel ?? SYNONYM_CONFIG.model, reasoningEffort: SYNONYM_CONFIG.reasoningEffort, maxOutputTokens: SYNONYM_CONFIG.maxOutputTokens, instructions: buildSynonymPrompt({ dialect: request.dialect, targetText: request.source.text, contextBefore: request.context?.before ?? '', contextAfter: request.context?.after ?? '' }), dataPacket: JSON.stringify({ target: request.source.text, before: request.context?.before ?? '', after: request.context?.after ?? '' }), schemaName: 'cleanwrite_synonyms', schema, store: false });
    return validateSynonyms(output);
  }
  async grammar(request: GrammarRequest): Promise<GrammarResponse> {
    if (!request.sources.length || request.sources.some((source) => source.text.length > GRAMMAR_CONFIG.maxSourceChars) || request.sources.reduce((total, source) => total + source.text.length, 0) > GRAMMAR_CONFIG.maxTotalChars) throw new AIError('AI_INPUT_TOO_LARGE', 'That grammar check is too large. Try a shorter selection.');
    const model = this.models.rewriteModel ?? GRAMMAR_CONFIG.model;
    const key = [model, GRAMMAR_CONFIG.promptKey, request.dialect, ...request.sources.map((source) => `${source.sourceId}:${source.textHash}`).sort()].join('|');
    const cached = getGrammarCache(key);
    if (cached) return cached;
    const existing = getGrammarInFlight(key);
    if (existing) return existing;
    const schema = z.object({ issues: z.array(z.object({ sourceId: z.string(), start: z.number().int(), end: z.number().int(), original: z.string(), category: z.enum(['grammar', 'spelling', 'punctuation']), subtype: z.string(), explanation: z.string(), replacement: z.string(), confidence: z.enum(['low', 'medium', 'high']) })) });
    const pending = this.execute({ requestId: request.requestId, action: 'grammar_fix', model, reasoningEffort: GRAMMAR_CONFIG.reasoningEffort, maxOutputTokens: GRAMMAR_CONFIG.maxOutputTokens, instructions: buildGrammarPrompt(request), dataPacket: JSON.stringify({ sources: request.sources.map(({ sourceId, text }) => ({ sourceId, text })), dialect: request.dialect }), schemaName: 'cleanwrite_grammar', schema, store: false }).then((value) => {
      const parsed = GrammarResponseSchema.safeParse(value);
      if (!parsed.success) throw new AIError('AI_INVALID_RESPONSE', 'AI returned no usable grammar findings.');
      setGrammarCache(key, parsed.data);
      return parsed.data;
    });
    setGrammarInFlight(key, pending);
    try { return await pending; } finally { clearGrammarInFlight(key); }
  }
  async feedback(request: FeedbackRequest, signal?: AbortSignal): Promise<FeedbackResponse> {
    if (request.text.length > FEEDBACK_CONFIG.maxSourceChars) throw new AIError('AI_INPUT_TOO_LARGE', 'This document is too long for full-document Feedback. Try a shorter version.');
    const model = this.models.reviewModel ?? FEEDBACK_CONFIG.model;
    const output = await this.execute({ requestId: request.requestId, action: 'document_feedback', model, reasoningEffort: FEEDBACK_CONFIG.reasoningEffort, maxOutputTokens: FEEDBACK_CONFIG.maxOutputTokens, instructions: buildFeedbackPrompt(request), dataPacket: JSON.stringify({ title: request.title ?? null, text: request.text, dialect: request.dialect, metrics: request.metrics ?? null }), schemaName: 'cleanwrite_feedback', schema: FeedbackResponseSchema, signal, store: false });
    const parsed = FeedbackResponseSchema.safeParse(output);
    if (!parsed.success) throw new AIError('AI_INVALID_RESPONSE', 'AI returned no usable Feedback.');
    return parsed.data;
  }
  async makeSkimmable(request: SkimmableRequest, signal?: AbortSignal): Promise<SkimmableResponse> {
    if (request.source.text.length > SKIMMABLE_CONFIG.maxSourceChars || (request.context?.before.length ?? 0) > SKIMMABLE_CONFIG.maxContextChars || (request.context?.after.length ?? 0) > SKIMMABLE_CONFIG.maxContextChars) throw new AIError('AI_INPUT_TOO_LARGE', 'That selection is too large for Make Skimmable.');
    const schema = SkimmableProviderResponseSchema;
    const output = await this.execute({ requestId: request.requestId, action: 'make_skimmable', model: this.models.reviewModel ?? SKIMMABLE_CONFIG.model, reasoningEffort: SKIMMABLE_CONFIG.reasoningEffort, maxOutputTokens: SKIMMABLE_CONFIG.maxOutputTokens, instructions: buildMakeSkimmablePrompt(request), dataPacket: JSON.stringify({ source: request.source, context: request.context ?? { before: '', after: '' }, dialect: request.dialect, readabilityTarget: request.readabilityTarget ?? null }), schemaName: 'cleanwrite_skimmable', schema, signal, store: false });
    try {
      return validateSkimmableResponse(normalizeSkimmableProviderResponse(output), request.source.text.length);
    } catch {
      throw new AIError('AI_INVALID_RESPONSE', 'AI returned no usable skimmable structure.');
    }
  }
}
