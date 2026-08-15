import { NextResponse } from 'next/server';

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  const isValidation = message.startsWith('Invalid') || message.includes('supported format') || message.includes('too large') || message.includes("couldn't read") || message.startsWith('Choose a file') || message.startsWith('Choose a supported');
  const status = message === 'Document not found' ? 404 : isValidation ? 400 : 500;
  return NextResponse.json({ error: { code: status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message } }, { status });
}
