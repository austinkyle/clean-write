import { NextResponse } from 'next/server';
import { OpenAIProvider } from '@/server/ai/openai-provider';
export const runtime = 'nodejs';
export function GET() { return NextResponse.json({ configured: new OpenAIProvider().isConfigured() }); }
