import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDatabase } from '@/lib/db/client';
import { createDocument, getLastOpenedDocumentId, listDocuments } from '@/server/documents/service';
import { errorResponse } from '@/server/http/errors';

const CreateDocumentSchema = z.object({
  title: z.string().optional(),
  content: z.unknown().optional(),
}).strict();

export const runtime = 'nodejs';

export function GET() {
  try {
    const { db } = getDatabase();
    return NextResponse.json({ documents: listDocuments(db), lastOpenedId: getLastOpenedDocumentId(db) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = CreateDocumentSchema.parse(await request.json().catch(() => ({})));
    const { db } = getDatabase();
    return NextResponse.json(createDocument(db, body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
