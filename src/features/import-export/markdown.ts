import type { DocumentContent, TiptapNode } from '@/features/documents/content';
import { parseDocumentContent } from '@/features/documents/content';

function inlineMarkdown(value: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let rest = value;
  const pattern = /(!?\[[^\]]+\]\([^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/u;
  while (rest) {
    const match = rest.match(pattern);
    if (!match || match.index === undefined) { nodes.push({ type: 'text', text: rest }); break; }
    if (match.index > 0) nodes.push({ type: 'text', text: rest.slice(0, match.index) });
    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/u);
    if (link) nodes.push({ type: 'text', text: link[1], marks: [{ type: 'link', attrs: { href: link[2], target: null, rel: null, class: null } }] });
    else if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) nodes.push({ type: 'text', text: token.slice(2, -2), marks: [{ type: 'bold' }] });
    else nodes.push({ type: 'text', text: token.slice(1, -1), marks: [{ type: 'italic' }] });
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
}

function paragraph(lines: string[]): TiptapNode {
  const content: TiptapNode[] = [];
  lines.forEach((line, index) => { if (index) content.push({ type: 'hardBreak' }); content.push(...inlineMarkdown(line)); });
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

export function markdownToDocumentContent(markdown: string): DocumentContent {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: TiptapNode[] = [];
  let paragraphLines: string[] = [];
  const flush = () => { if (paragraphLines.length) { blocks.push(paragraph(paragraphLines)); paragraphLines = []; } };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) { flush(); blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineMarkdown(heading[2]) }); continue; }
    if (/^>\s?/u.test(line)) { flush(); const quoteLines: string[] = []; while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) { quoteLines.push((lines[index] ?? '').replace(/^>\s?/u, '')); index += 1; } index -= 1; blocks.push({ type: 'blockquote', content: [paragraph(quoteLines)] }); continue; }
    if (/^(?:[-+*])\s+/u.test(line) || /^\d+[.)]\s+/u.test(line)) {
      flush(); const ordered = /^\d+[.)]\s+/u.test(line); const items: TiptapNode[] = []; while (index < lines.length) { const current = lines[index] ?? ''; const match = ordered ? current.match(/^\d+[.)]\s+(.+)$/u) : current.match(/^(?:[-+*])\s+(.+)$/u); if (!match) break; items.push({ type: 'listItem', content: [paragraph([match[1]])] }); index += 1; } index -= 1; blocks.push({ type: ordered ? 'orderedList' : 'bulletList', ...(ordered ? { attrs: { start: 1 } } : {}), content: items }); continue;
    }
    if (/^```/u.test(line)) { flush(); while (index + 1 < lines.length && !/^```/u.test(lines[index + 1] ?? '')) index += 1; continue; }
    paragraphLines.push(line);
  }
  flush();
  return parseDocumentContent({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });
}
