import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDatabase } from '@/lib/db/client';
import { deleteDocument, getDocument, renameDocument, updateDocumentContent } from '@/server/documents/service';
import { errorResponse } from '@/server/http/errors';

const UpdateDocumentSchema = z.object({
  title: z.string().optional(),
  content: z.unknown().optional(),
  revision: z.number().int().nonnegative().optional(),
}).strict().refine((value) => value.title !== undefined || value.content !== undefined, 'No document changes provided');

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getDocument(getDatabase().db, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = UpdateDocumentSchema.parse(await request.json());
    const db = getDatabase().db;
    let document = getDocument(db, id);
    if (body.content !== undefined) document = updateDocumentContent(db, id, body.content, body.revision);
    if (body.title !== undefined) document = renameDocument(db, id, body.title);
    return NextResponse.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    deleteDocument(getDatabase().db, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
