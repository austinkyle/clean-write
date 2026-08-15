import { NextResponse } from 'next/server';

import { getDatabase } from '@/lib/db/client';
import { duplicateDocument } from '@/server/documents/service';
import { errorResponse } from '@/server/http/errors';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(duplicateDocument(getDatabase().db, id), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
