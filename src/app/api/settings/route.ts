import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '@/lib/db/client';
import { getDialect, setDialect } from '@/server/settings/service';
import { errorResponse } from '@/server/http/errors';

export const runtime = 'nodejs';
const UpdateSchema = z.object({ dialect: z.string() }).strict();

export function GET() {
  try { return NextResponse.json({ dialect: getDialect(getDatabase().db) }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { const body = UpdateSchema.parse(await request.json()); return NextResponse.json({ dialect: setDialect(getDatabase().db, body.dialect) }); }
  catch (error) { return errorResponse(error); }
}
