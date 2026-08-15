import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx';

import type { DocumentContent, TiptapMark, TiptapNode } from '@/features/documents/content';

function escapeHtml(value: string) { return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;'); }
function escapeAttr(value: string) { return escapeHtml(value).replace(/'/gu, '&#39;'); }
function textContent(node: TiptapNode): string { return node.text ?? node.content?.map(textContent).join('') ?? ''; }
function hasMark(node: TiptapNode, type: TiptapMark['type']) { return node.marks?.some((mark) => mark.type === type) ?? false; }
function linkMark(node: TiptapNode) { return node.marks?.find((mark): mark is Extract<TiptapMark, { type: 'link' }> => mark.type === 'link'); }

function inlineHtml(nodes: TiptapNode[] = []): string {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return '<br>\n';
    if (node.type !== 'text') return inlineHtml(node.content);
    let value = escapeHtml(node.text ?? '');
    const link = linkMark(node);
    if (hasMark(node, 'bold')) value = `<strong>${value}</strong>`;
    if (hasMark(node, 'italic')) value = `<em>${value}</em>`;
    if (link) value = `<a href="${escapeAttr(link.attrs.href)}">${value}</a>`;
    return value;
  }).join('');
}

function blockHtml(node: TiptapNode): string {
  if (node.type === 'text') return inlineHtml([node]);
  if (node.type === 'paragraph') return `<p>${inlineHtml(node.content)}</p>`;
  if (node.type === 'heading') return `<h${String(node.attrs?.level ?? 1)}>${inlineHtml(node.content)}</h${String(node.attrs?.level ?? 1)}>`;
  if (node.type === 'blockquote') return `<blockquote>${node.content?.map(blockHtml).join('') ?? ''}</blockquote>`;
  if (node.type === 'bulletList') return `<ul>${node.content?.map(blockHtml).join('') ?? ''}</ul>`;
  if (node.type === 'orderedList') return `<ol>${node.content?.map(blockHtml).join('') ?? ''}</ol>`;
  if (node.type === 'listItem') return `<li>${node.content?.map(blockHtml).join('') ?? ''}</li>`;
  return '';
}

export function documentToHtml(content: DocumentContent): string {
  return content.content.map(blockHtml).join('\n');
}

function inlineMarkdown(nodes: TiptapNode[] = []): string {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return '\n';
    if (node.type !== 'text') return inlineMarkdown(node.content);
    let value = (node.text ?? '').replace(/([\\`*_{}[\]()#+.!-])/gu, '\\$1');
    const link = linkMark(node);
    if (hasMark(node, 'bold')) value = `**${value}**`;
    if (hasMark(node, 'italic')) value = `*${value}*`;
    if (link) value = `[${value}](${link.attrs.href})`;
    return value;
  }).join('');
}

function blockMarkdown(node: TiptapNode, prefix = ''): string {
  if (node.type === 'paragraph') return `${prefix}${inlineMarkdown(node.content)}`;
  if (node.type === 'heading') return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inlineMarkdown(node.content)}`;
  if (node.type === 'blockquote') return (node.content ?? []).map((child) => blockMarkdown(child, '> ')).join('\n');
  if (node.type === 'bulletList') return (node.content ?? []).map((item) => `- ${blockMarkdown(item)}`).join('\n');
  if (node.type === 'orderedList') return (node.content ?? []).map((item, index) => `${index + 1}. ${blockMarkdown(item)}`).join('\n');
  if (node.type === 'listItem') return (node.content ?? []).map((child) => blockMarkdown(child)).join('\n');
  return inlineMarkdown([node]);
}

export function documentToMarkdown(content: DocumentContent): string { return content.content.map((node) => blockMarkdown(node)).join('\n\n'); }

function blockText(node: TiptapNode, prefix = ''): string {
  if (node.type === 'paragraph' || node.type === 'heading') return `${prefix}${(node.content ?? []).map((child) => child.type === 'hardBreak' ? '\n' : textContent(child)).join('')}`;
  if (node.type === 'blockquote') return (node.content ?? []).map((child) => blockText(child, '> ')).join('\n');
  if (node.type === 'bulletList') return (node.content ?? []).map((item) => `- ${blockText(item)}`).join('\n');
  if (node.type === 'orderedList') return (node.content ?? []).map((item, index) => `${index + 1}. ${blockText(item)}`).join('\n');
  if (node.type === 'listItem') return (node.content ?? []).map((child) => blockText(child)).join('\n');
  return textContent(node);
}

export function documentToText(content: DocumentContent): string { return content.content.map((node) => blockText(node)).join('\n\n'); }

function textRuns(nodes: TiptapNode[] = []): Array<TextRun | ExternalHyperlink> {
  return nodes.flatMap((node) => {
    if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
    if (node.type !== 'text') return textRuns(node.content);
    const options = { text: node.text ?? '', bold: hasMark(node, 'bold'), italics: hasMark(node, 'italic') };
    const link = linkMark(node);
    return link ? [new ExternalHyperlink({ link: link.attrs.href, children: [new TextRun(options)] })] : [new TextRun(options)];
  });
}

function docxParagraph(node: TiptapNode, list?: 'bullet' | 'number'): Paragraph[] {
  if (node.type === 'paragraph' || node.type === 'heading') {
    const heading = node.type === 'heading' ? HeadingLevel[`HEADING_${String(node.attrs?.level ?? 1)}` as 'HEADING_1' | 'HEADING_2' | 'HEADING_3'] : undefined;
    const options = { children: textRuns(node.content), ...(heading ? { heading } : {}), ...(list === 'bullet' ? { bullet: { level: 0 } } : {}), ...(list === 'number' ? { numbering: { reference: 'clearwrite-numbered', level: 0 } } : {}) };
    return [new Paragraph(options)];
  }
  if (node.type === 'blockquote') return (node.content ?? []).flatMap((child) => child.type === 'paragraph' ? [new Paragraph({ children: textRuns(child.content), style: 'IntenseQuote' })] : docxParagraph(child));
  if (node.type === 'bulletList' || node.type === 'orderedList') return (node.content ?? []).flatMap((item) => docxParagraph(item, node.type === 'bulletList' ? 'bullet' : 'number'));
  if (node.type === 'listItem') return (node.content ?? []).flatMap((child) => docxParagraph(child, list));
  return [];
}

export async function documentToDocx(content: DocumentContent): Promise<Buffer> {
  const document = new Document({ numbering: { config: [{ reference: 'clearwrite-numbered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }] }] }, sections: [{ children: content.content.flatMap((node) => docxParagraph(node)) }] });
  return Packer.toBuffer(document);
}
