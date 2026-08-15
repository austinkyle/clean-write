import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/client';
import { createDocument } from '@/server/documents/service';
import { importContent } from '@/server/import-export/service';
import { deriveImportedTitle } from '@/features/import-export/types';
import { errorResponse } from '@/server/http/errors';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Choose a file to import.');
    const content = await importContent({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
    return NextResponse.json(createDocument(getDatabase().db, { title: deriveImportedTitle(file.name), content }), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
