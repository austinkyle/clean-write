import { z } from 'zod';

const ConfigSchema = z.object({ OPENAI_API_KEY: z.string().trim().min(1).optional(), OPENAI_REWRITE_MODEL: z.string().trim().min(1).optional(), OPENAI_REVIEW_MODEL: z.string().trim().min(1).optional() }).passthrough();
const ALLOWED_MODELS = new Set(['gpt-5.6-luna', 'gpt-5.6-terra']);

export function getAIConfig() {
  const parsed = ConfigSchema.parse(process.env);
  const model = (value: string | undefined, fallback: string) => value && ALLOWED_MODELS.has(value) ? value : fallback;
  return { apiKey: parsed.OPENAI_API_KEY, rewriteModel: model(parsed.OPENAI_REWRITE_MODEL, 'gpt-5.6-luna'), reviewModel: model(parsed.OPENAI_REVIEW_MODEL, 'gpt-5.6-terra') };
}
