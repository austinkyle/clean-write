import { describe, expect, it } from 'vitest';
import { htmlToDocumentContent, sanitizeImportedHtml } from '@/features/import-export/html';
import { markdownToDocumentContent } from '@/features/import-export/markdown';
import { deriveImportedTitle, sanitizeDownloadFilename } from '@/features/import-export/types';
import { documentToHtml, documentToMarkdown, documentToText } from '@/features/import-export/formats';
import { exportContent, importContent } from '@/server/import-export/service';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

describe('import/export formats', () => {
  it('sanitizes scripts, handlers and unsafe URLs before canonical parsing', () => {
    const sanitized = sanitizeImportedHtml('<p onclick="alert(1)">Safe</p><script>alert(2)</script><a href="javascript:alert(3)">bad</a>');
    expect(sanitized).not.toMatch(/script|onclick|javascript/iu);
    const content = htmlToDocumentContent(sanitized);
    expect(content.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Safe' }] });
    expect(content.content[1]?.content?.[0]?.text).toBe('bad');
  });

  it('imports Markdown structure into canonical Tiptap JSON', () => {
    const content = markdownToDocumentContent('# Title\n\nA **bold** and *italic* [link](https://example.com).\n\n- One\n- Two\n\n> Quote');
    expect(content.content.map((node) => node.type)).toEqual(['heading', 'paragraph', 'bulletList', 'blockquote']);
    expect(content.content[1]?.content?.[1]?.marks?.[0]?.type).toBe('bold');
  });

  it('exports user content without analysis artifacts', () => {
    const content = markdownToDocumentContent('# Title\n\nA **bold** thought.');
    const html = documentToHtml(content);
    const markdown = documentToMarkdown(content);
    const text = documentToText(content);
    expect(html).toContain('<h1>Title</h1>');
    expect(markdown).toContain('**bold**');
    expect(text).toContain('A bold thought.');
    expect(`${html}${markdown}${text}`).not.toMatch(/analysis|finding|decoration/iu);
  });

  it('exports a valid DOCX package from canonical content', async () => {
    const content = markdownToDocumentContent('# Title\n\nA **bold** thought.');
    const exported = await exportContent(content, 'docx');
    expect(Buffer.isBuffer(exported.body)).toBe(true);
    expect((exported.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('imports TXT paragraphs and derives safe filenames/titles', async () => {
    const content = await importContent({ filename: '../annual-report.txt', bytes: new TextEncoder().encode('First paragraph\r\n\r\nSecond paragraph') });
    expect(content.content).toHaveLength(2);
    expect(deriveImportedTitle('../annual-report.txt')).toBe('Annual Report');
    expect(sanitizeDownloadFilename('Bad:/ title', 'md')).toBe('Bad title.md');
  });

  it('imports a representative DOCX fixture through the approved parser', async () => {
    const fixture = new Document({ sections: [{ children: [new Paragraph({ text: 'Title', heading: HeadingLevel.HEADING_1 }), new Paragraph({ children: [new TextRun({ text: 'Bold', bold: true })] })] }] });
    const bytes = new Uint8Array(await Packer.toBuffer(fixture));
    const content = await importContent({ filename: 'fixture.docx', bytes });
    expect(content.content[0]?.type).toBe('heading');
    expect(content.content[1]?.content?.[0]?.marks?.[0]?.type).toBe('bold');
  });

  it('rejects unsupported extensions, invalid DOCX signatures and oversized files', async () => {
    await expect(importContent({ filename: 'script.exe', bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow('supported format');
    await expect(importContent({ filename: 'broken.docx', bytes: new TextEncoder().encode('not a zip') })).rejects.toThrow('Word document');
    await expect(importContent({ filename: 'large.txt', bytes: new Uint8Array(10 * 1024 * 1024 + 1) })).rejects.toThrow('too large');
  });
});
