export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_IMPORT_EXTENSIONS = ['docx', 'md', 'markdown', 'html', 'htm', 'txt'] as const;
export type ImportExtension = (typeof SUPPORTED_IMPORT_EXTENSIONS)[number];
export type ExportFormat = 'docx' | 'md' | 'html' | 'txt';

export function extensionForFilename(filename: string): string {
  const base = filename.split(/[\\/]/u).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function deriveImportedTitle(filename: string): string {
  const base = (filename.split(/[\\/]/u).pop() ?? filename).replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ').trim();
  if (!base) return 'Imported document';
  return base.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 200);
}

export function sanitizeDownloadFilename(title: string, extension: ExportFormat): string {
  const forbidden = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const safe = Array.from(title).filter((character) => character >= ' ' && !forbidden.has(character)).join('').replace(/\.+$/u, '').trim() || 'Untitled';
  return `${safe.slice(0, 180)}.${extension}`;
}

export function assertImportSize(size: number) {
  if (!Number.isFinite(size) || size < 0 || size > MAX_IMPORT_BYTES) throw new Error('This file is too large to import (maximum 10 MB).');
}
