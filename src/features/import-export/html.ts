import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';
import { isTag } from 'domutils';
import type { Element, Node as HtmlNode, Text } from 'domhandler';

import { parseDocumentContent, type DocumentContent, type TiptapMark, type TiptapNode } from '@/features/documents/content';

const ALLOWED_TAGS = ['p', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'a', 'blockquote', 'ul', 'ol', 'li', 'br'];
const ALLOWED_ATTRIBUTES = { a: ['href', 'target', 'rel'] };

export function sanitizeImportedHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
  });
}

type InlineContext = { marks: TiptapMark[] };

function textNode(data: string, context: InlineContext): TiptapNode | null {
  if (!data) return null;
  return { type: 'text', text: data, ...(context.marks.length ? { marks: context.marks } : {}) };
}

function inlineChildren(nodes: HtmlNode[] | undefined, context: InlineContext = { marks: [] }): TiptapNode[] {
  const result: TiptapNode[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      const parsed = textNode((node as Text).data, context);
      if (parsed) result.push(parsed);
      continue;
    }
    if (!isTag(node)) continue;
    const element = node as Element;
    if (element.name === 'br') { result.push({ type: 'hardBreak' }); continue; }
    const marks = [...context.marks];
    if (element.name === 'strong' || element.name === 'b') marks.push({ type: 'bold' });
    if (element.name === 'em' || element.name === 'i') marks.push({ type: 'italic' });
    if (element.name === 'a' && typeof element.attribs.href === 'string') marks.push({ type: 'link', attrs: { href: element.attribs.href, target: element.attribs.target ?? null, rel: element.attribs.rel ?? null, class: null } });
    result.push(...inlineChildren(element.children, { marks }));
  }
  return result;
}

function paragraphFromElement(element: Element, type: 'paragraph' | 'heading' = 'paragraph'): TiptapNode {
  const content = inlineChildren(element.children);
  return { type, ...(type === 'heading' ? { attrs: { level: Number(element.name.slice(1)) } } : {}), ...(content.length ? { content } : {}) };
}

function blocksFromNodes(nodes: HtmlNode[]): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  for (const node of nodes) {
    if (!isTag(node)) {
      if (node.type === 'text' && (node as Text).data.trim()) blocks.push({ type: 'paragraph', content: [{ type: 'text', text: (node as Text).data.trim() }] });
      continue;
    }
    const element = node as Element;
    if (element.name === 'p') blocks.push(paragraphFromElement(element));
    else if (/^h[1-3]$/u.test(element.name)) blocks.push(paragraphFromElement(element, 'heading'));
    else if (element.name === 'blockquote') blocks.push({ type: 'blockquote', content: blocksFromNodes(element.children) });
    else if (element.name === 'ul' || element.name === 'ol') {
      const items = element.children.filter((child): child is Element => isTag(child) && child.name === 'li').map((item) => ({ type: 'listItem' as const, content: [paragraphFromElement(item)] }));
      if (items.length) blocks.push({ type: element.name === 'ul' ? 'bulletList' : 'orderedList', ...(element.name === 'ol' ? { attrs: { start: 1 } } : {}), content: items });
    } else if (element.name === 'li') blocks.push(paragraphFromElement(element));
    else blocks.push(...blocksFromNodes(element.children));
  }
  return blocks;
}

export function htmlToDocumentContent(input: string): DocumentContent {
  const sanitized = sanitizeImportedHtml(input);
  const document = parseDocument(sanitized);
  const body = document.children.find((node) => isTag(node) && node.name === 'body') as Element | undefined;
  const blocks = blocksFromNodes(body?.children ?? document.children);
  return parseDocumentContent({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });
}
