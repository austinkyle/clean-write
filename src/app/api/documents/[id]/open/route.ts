import { NextResponse } from 'next/server';

import { getDatabase } from '@/lib/db/client';
import { getDocument, setLastOpenedDocument } from '@/server/documents/service';
import { errorResponse } from '@/server/http/errors';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = getDatabase().db;
    setLastOpenedDocument(db, id);
    return NextResponse.json(getDocument(db, id));
  } catch (error) {
    return errorResponse(error);
  }
}
