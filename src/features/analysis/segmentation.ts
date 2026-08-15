import type { ProjectionBlock, SentenceSpan, Token } from './types';

const WORD_FALLBACK = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const ABBREVIATIONS = new Set(['dr.', 'mrs.', 'ms.', 'mr.', 'prof.', 'sr.', 'jr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'u.s.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.']);

export function tokenize(text: string, absoluteStart = 0): Token[] {
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'word' }) : null;
  if (segmenter) {
    return Array.from(segmenter.segment(text)).filter((part) => part.isWordLike).map((part) => ({ textStart: absoluteStart + part.index, textEnd: absoluteStart + part.index + part.segment.length, text: part.segment, isWordLike: true }));
  }
  return Array.from(text.matchAll(WORD_FALLBACK)).map((match) => ({ textStart: absoluteStart + match.index!, textEnd: absoluteStart + match.index! + match[0].length, text: match[0], isWordLike: true }));
}

function shouldMerge(previous: string, current: string, boundaryText: string) {
  const lower = previous.trim().toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  if (/\d$/.test(previous.trim()) && /^\d/.test(current.trim()) && boundaryText.includes('.')) return true;
  if (/^[A-Z]\.$/u.test(previous.trim())) return true;
  return false;
}

export function segmentBlock(text: string, absoluteStart = 0): SentenceSpan[] {
  if (!text.trim()) return [];
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
  const pieces = segmenter ? Array.from(segmenter.segment(text)).map((part) => ({ start: part.index, end: part.index + part.segment.length })) : (() => {
    const result: Array<{ start: number; end: number }> = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (!/[.!?…]/u.test(text[index] ?? '')) continue;
      let end = index + 1;
      while (/[.!?…"'”’»)\]}]/u.test(text[end] ?? '')) end += 1;
      if (/\s/u.test(text[end] ?? '') || end === text.length) { result.push({ start, end }); start = end; }
    }
    if (start < text.length) result.push({ start, end: text.length });
    return result;
  })();
  const merged: Array<{ start: number; end: number }> = [];
  for (const piece of pieces) {
    if (!merged.length) { merged.push(piece); continue; }
    const previous = merged[merged.length - 1];
    const prevText = text.slice(previous.start, previous.end);
    const currentText = text.slice(piece.start, piece.end);
    if (shouldMerge(prevText, currentText, text.slice(previous.end, piece.start))) previous.end = piece.end;
    else merged.push(piece);
  }
  return merged.map((piece) => {
    const leading = text.slice(piece.start, piece.end).search(/\S/u);
    const raw = text.slice(piece.start, piece.end);
    const trimmed = raw.trim();
    const start = piece.start + Math.max(0, leading);
    return { textStart: absoluteStart + start, textEnd: absoluteStart + start + trimmed.length, text: trimmed, words: tokenize(trimmed, absoluteStart + start) };
  }).filter((sentence) => sentence.text.length > 0);
}

export function segmentProjectionBlocks(text: string, blocks: ProjectionBlock[]): SentenceSpan[] {
  return blocks.flatMap((block) => segmentBlock(text.slice(block.textStart, block.textEnd), block.textStart));
}
