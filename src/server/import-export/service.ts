import mammoth from 'mammoth';

import { parseDocumentContent, type DocumentContent } from '@/features/documents/content';
import { htmlToDocumentContent } from '@/features/import-export/html';
import { markdownToDocumentContent } from '@/features/import-export/markdown';
import { assertImportSize, extensionForFilename, MAX_IMPORT_BYTES, type ExportFormat } from '@/features/import-export/types';
import { documentToDocx, documentToHtml, documentToMarkdown, documentToText } from '@/features/import-export/formats';

export type ImportInput = { filename: string; bytes: Uint8Array; contentType?: string };

function decodeText(bytes: Uint8Array) { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }

function assertSignature(extension: string, bytes: Uint8Array) {
  if (extension === 'docx' && new TextDecoder('ascii').decode(bytes.slice(0, 2)) !== 'PK') throw new Error("We couldn't read this Word document.");
  if (extension === 'txt' || extension === 'md' || extension === 'markdown') return;
  if (extension === 'html' || extension === 'htm') {
    const text = decodeText(bytes).trim();
    if (!text) throw new Error("We couldn't read this HTML document.");
  }
}

export async function importContent(input: ImportInput): Promise<DocumentContent> {
  assertImportSize(input.bytes.byteLength);
  if (input.bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('This file is too large to import (maximum 10 MB).');
  const extension = extensionForFilename(input.filename);
  if (!['docx', 'md', 'markdown', 'html', 'htm', 'txt'].includes(extension)) throw new Error("That file isn't a supported format.");
  assertSignature(extension, input.bytes);
  if (extension === 'txt') return parseDocumentContent({ type: 'doc', content: decodeText(input.bytes).replace(/\r\n?/gu, '\n').split(/\n{2,}/u).map((paragraph) => ({ type: 'paragraph', ...(paragraph ? { content: [{ type: 'text', text: paragraph.replace(/\n/gu, ' ') }] } : {}) })) });
  if (extension === 'md' || extension === 'markdown') return markdownToDocumentContent(decodeText(input.bytes));
  if (extension === 'html' || extension === 'htm') return htmlToDocumentContent(decodeText(input.bytes));
  try {
    const docxBuffer = Buffer.from(input.bytes);
    const converted = await mammoth.convertToHtml({ buffer: docxBuffer });
    return htmlToDocumentContent(converted.value);
  } catch {
    throw new Error("We couldn't read this Word document.");
  }
}

export async function exportContent(content: unknown, format: ExportFormat): Promise<{ body: string | Buffer; contentType: string }> {
  const canonical = parseDocumentContent(content);
  if (format === 'html') return { body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CleanWrite document</title></head><body>${documentToHtml(canonical)}</body></html>`, contentType: 'text/html; charset=utf-8' };
  if (format === 'md') return { body: documentToMarkdown(canonical), contentType: 'text/markdown; charset=utf-8' };
  if (format === 'txt') return { body: documentToText(canonical), contentType: 'text/plain; charset=utf-8' };
  return { body: await documentToDocx(canonical), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}
