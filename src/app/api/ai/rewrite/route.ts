import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '@/lib/db/client';
import { RewriteRequestSchema } from '@/features/ai/schemas';
import { getDialect } from '@/server/settings/service';
import { AIService } from '@/server/ai/service';
import { OpenAIProvider } from '@/server/ai/openai-provider';
import { assertLocalOrigin } from '@/server/ai/origin';
import { AIError, normalizeAIError } from '@/server/ai/errors';
import { getAIConfig } from '@/server/ai/config';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertLocalOrigin(request);
    const body = RewriteRequestSchema.parse(await request.json());
    const aiConfig = getAIConfig();
    const config = new OpenAIProvider(aiConfig.apiKey);
    if (!config.isConfigured()) throw new AIError('AI_UNAVAILABLE', 'Add your OpenAI API key to enable AI tools.');
    const result = await new AIService(config, undefined, aiConfig).rewrite({ ...body, dialect: getDialect(getDatabase().db) });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid local request origin') return NextResponse.json({ error: { code: 'INVALID_ORIGIN', message: 'Invalid local request origin' } }, { status: 403 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: 'AI_INVALID_REQUEST', message: 'That AI request is invalid.' } }, { status: 400 });
    const normalized = normalizeAIError(error);
    const status = normalized.code === 'AI_UNAVAILABLE' || normalized.code === 'AI_UNAUTHORIZED' ? 503 : normalized.code === 'AI_INPUT_TOO_LARGE' ? 413 : normalized.code === 'AI_RATE_LIMITED' ? 429 : normalized.code === 'AI_INVALID_RESPONSE' ? 502 : normalized.code === 'AI_TIMEOUT' ? 504 : normalized.code === 'AI_ABORTED' ? 499 : 503;
    return NextResponse.json({ error: { code: normalized.code, message: normalized.message } }, { status });
  }
}
