import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/client';
import { getDocument } from '@/server/documents/service';
import { exportContent } from '@/server/import-export/service';
import { sanitizeDownloadFilename, type ExportFormat } from '@/features/import-export/types';
import { errorResponse } from '@/server/http/errors';

type RouteContext = { params: Promise<{ id: string }> };
const formats = new Set<ExportFormat>(['docx', 'md', 'html', 'txt']);
export const runtime = 'nodejs';

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const format = new URL(request.url).searchParams.get('format') as ExportFormat | null;
    if (!format || !formats.has(format)) throw new Error('Choose a supported export format.');
    const document = getDocument(getDatabase().db, id);
    const exported = await exportContent(document.content, format);
    const body = typeof exported.body === 'string' ? exported.body : new Uint8Array(exported.body);
    return new NextResponse(body, { headers: { 'Content-Type': exported.contentType, 'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(document.title, format)}"`, 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
