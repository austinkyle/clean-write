import { z } from 'zod';
import { DIALECTS } from './dialect';
import { FEEDBACK_CATEGORIES, REWRITE_ACTION_IDS } from './types';

const Primitive = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
const SourceSchema = z.object({ from: z.number().int().min(1), to: z.number().int().gt(1), text: z.string().min(1).max(8000), textHash: z.string().min(1).max(64) }).strict();
const ContextSchema = z.object({ before: z.string().max(800), after: z.string().max(800) }).strict();
const BaseRequest = z.object({ requestId: z.string().uuid(), documentId: z.string().uuid(), editorGeneration: z.number().int().nonnegative(), source: SourceSchema, context: ContextSchema.optional(), dialect: z.enum(DIALECTS), readabilityTarget: z.enum(['accessible', 'default', 'technical']).optional(), targetGrade: z.number().finite().min(0).max(100).optional() }).strict();
export const RewriteRequestSchema = BaseRequest.extend({ action: z.enum(REWRITE_ACTION_IDS), customInstruction: z.string().trim().min(1).max(500).optional(), finding: z.object({ category: z.string().max(64), message: z.string().max(300), metadata: z.record(z.string(), Primitive).optional() }).strict().optional() }).strict().superRefine((value, ctx) => {
  if (value.action === 'custom' && !value.customInstruction) ctx.addIssue({ code: 'custom', path: ['customInstruction'], message: 'Custom instruction is required.' });
  if (value.action !== 'custom' && value.customInstruction) ctx.addIssue({ code: 'custom', path: ['customInstruction'], message: 'Custom instruction is only valid for custom action.' });
  if (value.source.to <= value.source.from) ctx.addIssue({ code: 'custom', path: ['source', 'to'], message: 'Invalid range.' });
});
export const SynonymRequestSchema = BaseRequest.extend({ action: z.literal('synonyms') }).strict();
export const RewriteAlternativeSchema = z.object({ id: z.string().min(1).max(64), text: z.string().min(1).max(8000), rationale: z.string().max(300).nullable() }).strict();
export const RewriteResponseSchema = z.object({ alternatives: z.array(RewriteAlternativeSchema).min(1).max(3) }).strict();
export const SynonymResponseSchema = z.object({ suggestions: z.array(z.object({ text: z.string().min(1).max(128), note: z.string().max(200).nullable() }).strict()).min(1).max(8) }).strict();
export const GrammarSourceSchema = z.object({ sourceId: z.string().min(1).max(128), text: z.string().min(1).max(6000), textHash: z.string().min(1).max(64), projectionStart: z.number().int().nonnegative(), blockIndex: z.number().int().nonnegative() }).strict();
export const GrammarRequestSchema = z.object({ requestId: z.string().uuid(), documentId: z.string().uuid(), editorGeneration: z.number().int().nonnegative(), dialect: z.enum(DIALECTS), sources: z.array(GrammarSourceSchema).min(1).max(100) }).strict().superRefine((value, ctx) => {
  if (value.sources.reduce((total, source) => total + source.text.length, 0) > 20_000) ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Grammar input is too large.' });
});
export const GrammarIssueSchema = z.object({ sourceId: z.string().min(1).max(128), start: z.number().int().min(0), end: z.number().int().min(0), original: z.string().max(1000), category: z.enum(['grammar', 'spelling', 'punctuation']), subtype: z.string().min(1).max(64), explanation: z.string().min(1).max(400), replacement: z.string().max(2000), confidence: z.enum(['low', 'medium', 'high']) }).strict();
export const GrammarResponseSchema = z.object({ issues: z.array(GrammarIssueSchema).max(100) }).strict();
export const FeedbackMetricsSchema = z.object({ readabilityGrade: z.number().finite().min(0).max(100).optional(), targetGrade: z.number().finite().min(0).max(100).optional(), words: z.number().int().nonnegative().max(1_000_000), sentences: z.number().int().nonnegative().max(100_000) }).strict();
export const FeedbackRequestSchema = z.object({ requestId: z.string().uuid(), documentId: z.string().uuid(), editorGeneration: z.number().int().nonnegative(), text: z.string().min(1).max(30_000), textHash: z.string().min(1).max(64), title: z.string().max(200).optional(), dialect: z.enum(DIALECTS), metrics: FeedbackMetricsSchema.optional() }).strict();
export const FeedbackStrengthSchema = z.object({ title: z.string().min(1).max(120), detail: z.string().min(1).max(400) }).strict();
export const FeedbackImprovementSchema = z.object({ rank: z.number().int().min(1).max(5), category: z.enum(FEEDBACK_CATEGORIES), title: z.string().min(1).max(120), detail: z.string().min(1).max(400), recommendation: z.string().min(1).max(400) }).strict();
export const FeedbackAreaSchema = z.object({ category: z.enum(FEEDBACK_CATEGORIES), assessment: z.string().min(1).max(400) }).strict();
export const FeedbackResponseSchema = z.object({ overallSummary: z.string().min(1).max(1000), strengths: z.array(FeedbackStrengthSchema).min(1).max(3), priorityImprovements: z.array(FeedbackImprovementSchema).min(1).max(5), areas: z.array(FeedbackAreaSchema).min(1).max(8) }).strict().superRefine((value, ctx) => {
  const ranks = value.priorityImprovements.map((item) => item.rank);
  if (new Set(ranks).size !== ranks.length) ctx.addIssue({ code: 'custom', path: ['priorityImprovements'], message: 'Priority ranks must be unique.' });
  const categories = value.areas.map((item) => item.category);
  if (new Set(categories).size !== categories.length) ctx.addIssue({ code: 'custom', path: ['areas'], message: 'Feedback categories must be unique.' });
});
export type RewriteResponseInput = z.infer<typeof RewriteResponseSchema>;

const SkimmableMarkSchema = z.object({ type: z.enum(['bold', 'italic']) }).strict();
const SkimmableTextSchema = z.object({ type: z.literal('text'), text: z.string().min(1).max(2_000), marks: z.array(SkimmableMarkSchema).max(2).optional() }).strict();
const SkimmableInlineSchema = z.array(SkimmableTextSchema).min(1).max(80);
const SkimmableParagraphSchema = z.object({ type: z.literal('paragraph'), content: SkimmableInlineSchema }).strict();
const SkimmableHeadingSchema = z.object({ type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), content: SkimmableInlineSchema }).strict();
const SkimmableListItemSchema = z.object({ content: SkimmableInlineSchema }).strict();
const SkimmableBulletListSchema = z.object({ type: z.literal('bulletList'), items: z.array(SkimmableListItemSchema).min(2).max(12) }).strict();
const SkimmableOrderedListSchema = z.object({ type: z.literal('orderedList'), items: z.array(SkimmableListItemSchema).min(2).max(12) }).strict();
export const SkimmableBlockSchema = z.discriminatedUnion('type', [SkimmableParagraphSchema, SkimmableHeadingSchema, SkimmableBulletListSchema, SkimmableOrderedListSchema]);
const SkimmableProviderTextSchema = SkimmableTextSchema.extend({ marks: z.array(SkimmableMarkSchema).max(2).nullable() });
const SkimmableProviderInlineSchema = z.array(SkimmableProviderTextSchema).min(1).max(80);
const SkimmableProviderParagraphSchema = z.object({ type: z.literal('paragraph'), content: SkimmableProviderInlineSchema }).strict();
const SkimmableProviderHeadingSchema = z.object({ type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), content: SkimmableProviderInlineSchema }).strict();
const SkimmableProviderListItemSchema = z.object({ content: SkimmableProviderInlineSchema }).strict();
const SkimmableProviderBulletListSchema = z.object({ type: z.literal('bulletList'), items: z.array(SkimmableProviderListItemSchema).min(2).max(12) }).strict();
const SkimmableProviderOrderedListSchema = z.object({ type: z.literal('orderedList'), items: z.array(SkimmableProviderListItemSchema).min(2).max(12) }).strict();
const SkimmableProviderBlockSchema = z.discriminatedUnion('type', [SkimmableProviderParagraphSchema, SkimmableProviderHeadingSchema, SkimmableProviderBulletListSchema, SkimmableProviderOrderedListSchema]);
export const SkimmableProviderResponseSchema = z.object({ fragment: z.array(SkimmableProviderBlockSchema).min(1).max(30) }).strict();
const skimmableText = (content: Array<{ text: string }>) => content.map((item) => item.text).join('');
function hasSkimmableControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0 || (code >= 1 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}
export const SkimmableResponseSchema = z.object({ fragment: z.array(SkimmableBlockSchema).min(1).max(30) }).strict().superRefine((value, ctx) => {
  let totalCharacters = 0;
  let totalItems = 0;
  value.fragment.forEach((block, blockIndex) => {
    const inline = block.type === 'bulletList' || block.type === 'orderedList' ? block.items.flatMap((item) => item.content) : block.content;
    if (block.type === 'bulletList' || block.type === 'orderedList') totalItems += block.items.length;
    if (inline.length > 80) ctx.addIssue({ code: 'custom', path: ['fragment', blockIndex], message: 'Too many inline runs.' });
    inline.forEach((text, textIndex) => {
      totalCharacters += text.text.length;
      if (text.text.includes('\n') || hasSkimmableControlCharacter(text.text)) ctx.addIssue({ code: 'custom', path: ['fragment', blockIndex, 'content', textIndex], message: 'Text contains a disallowed control character.' });
      const marks = text.marks ?? [];
      if (new Set(marks.map((mark) => mark.type)).size !== marks.length || marks.some((mark, index) => index > 0 && mark.type < marks[index - 1]!.type)) ctx.addIssue({ code: 'custom', path: ['fragment', blockIndex, 'content', textIndex, 'marks'], message: 'Marks must be unique and ordered.' });
    });
    if (skimmableText(inline).trim().length === 0) ctx.addIssue({ code: 'custom', path: ['fragment', blockIndex], message: 'Block content cannot be empty.' });
    if (block.type === 'heading' && skimmableText(block.content).length > 200) ctx.addIssue({ code: 'custom', path: ['fragment', blockIndex], message: 'Heading is too long.' });
    if ((block.type === 'bulletList' || block.type === 'orderedList') && block.items.some((item) => skimmableText(item.content).trim().length === 0)) ctx.addIssue({ code: 'custom', path: ['fragment', blockIndex], message: 'List items cannot be empty.' });
  });
  if (totalItems > 40) ctx.addIssue({ code: 'custom', path: ['fragment'], message: 'Too many list items.' });
  if (totalCharacters > 12_000) ctx.addIssue({ code: 'custom', path: ['fragment'], message: 'Skimmable output is too large.' });
});
const SkimmableSourceBlockSchema = z.union([SkimmableParagraphSchema, SkimmableHeadingSchema]);
export const SkimmableRequestSchema = z.object({
  requestId: z.string().uuid(),
  documentId: z.string().uuid(),
  editorGeneration: z.number().int().nonnegative(),
  source: z.object({ fragment: z.array(SkimmableSourceBlockSchema).min(1).max(12), text: z.string().min(1).max(8_000), hash: z.string().min(1).max(64) }).strict(),
  context: z.object({ before: z.string().max(800), after: z.string().max(800) }).strict().optional(),
  dialect: z.enum(DIALECTS),
  readabilityTarget: z.enum(['accessible', 'default', 'technical']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.source.fragment.some((block) => block.type !== 'paragraph' && block.type !== 'heading')) ctx.addIssue({ code: 'custom', path: ['source', 'fragment'], message: 'Only paragraph and heading source blocks are supported.' });
});
