import { NextResponse } from 'next/server';

import { getDatabase } from '@/lib/db/client';

export const runtime = 'nodejs';

export function GET() {
  try {
    const { sqlite } = getDatabase();
    const result = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number };

    return NextResponse.json({ status: result.ok === 1 ? 'ok' : 'degraded', app: 'ClearWrite' });
  } catch {
    return NextResponse.json({ status: 'error', app: 'ClearWrite' }, { status: 503 });
  }
}
