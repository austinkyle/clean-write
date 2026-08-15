import type { Node as PMNode } from '@tiptap/pm/model';
import type { Projection, ProjectionBlock, ProjectionSegment } from './types';

function blockType(node: PMNode, context: 'root' | 'blockquote' | 'list'): ProjectionBlock['nodeType'] {
  if (node.type.name === 'heading') return 'heading';
  if (context === 'blockquote') return 'blockquote_paragraph';
  if (context === 'list') return 'list_item_paragraph';
  return 'paragraph';
}

export function projectDocument(doc: PMNode): Projection {
  const blocks: ProjectionBlock[] = [];
  const segments: ProjectionSegment[] = [];
  const parts: string[] = [];
  let textOffset = 0;

  function addBlock(node: PMNode, pmPos: number, context: 'root' | 'blockquote' | 'list') {
    const index = blocks.length;
    const start = textOffset;
    const block: ProjectionBlock = {
      index,
      nodeType: blockType(node, context),
      textStart: start,
      textEnd: start,
      pmContentFrom: pmPos + 1,
      pmContentTo: pmPos + node.content.size + 1,
      isEmpty: node.content.size === 0,
    };
    blocks.push(block);

    function addInline(child: PMNode, relativePos: number) {
      const absolute = pmPos + 1 + relativePos;
      if (child.isText) {
        const value = child.text ?? '';
        if (value) {
          parts.push(value);
          segments.push({ kind: 'text', textStart: textOffset, textEnd: textOffset + value.length, pmFrom: absolute, pmTo: absolute + value.length, blockIndex: index });
          textOffset += value.length;
        }
        return;
      }
      if (child.type.name === 'hardBreak') {
        parts.push('\n');
        segments.push({ kind: 'hard_break', textStart: textOffset, textEnd: textOffset + 1, pmFrom: absolute, pmTo: absolute + 1, blockIndex: index });
        textOffset += 1;
        return;
      }
      child.forEach((nested, offset) => addInline(nested, relativePos + offset));
    }
    node.forEach((child, offset) => addInline(child, offset));
    block.textEnd = textOffset;
  }

  function visit(node: PMNode, pmPos: number, context: 'root' | 'blockquote' | 'list') {
    if (node.isTextblock) {
      addBlock(node, pmPos, context);
      return;
    }
    let offset = 0;
    node.forEach((child) => {
      const childContext = node.type.name === 'blockquote' ? 'blockquote' : node.type.name === 'bulletList' || node.type.name === 'orderedList' ? 'list' : context;
      visit(child, pmPos + 1 + offset, childContext);
      offset += child.nodeSize;
    });
  }

  let offset = 0;
  doc.forEach((child) => { visit(child, offset, 'root'); offset += child.nodeSize; });
  const withSeparators: ProjectionSegment[] = [];
  const finalParts: string[] = [];
  const rawText = parts.join('');
  const segmentsByBlock = new Map<number, ProjectionSegment[]>();
  segments.forEach((segment) => { const existing = segmentsByBlock.get(segment.blockIndex) ?? []; existing.push(segment); segmentsByBlock.set(segment.blockIndex, existing); });
  blocks.forEach((block, index) => {
    const blockSegments = segmentsByBlock.get(index) ?? [];
    finalParts.push(rawText.slice(block.textStart, block.textEnd));
    withSeparators.push(...blockSegments.map((segment) => ({ ...segment, textStart: segment.textStart + index, textEnd: segment.textEnd + index })));
    if (index < blocks.length - 1) {
      const separatorStart = block.textEnd + index;
      finalParts.push('\n');
      withSeparators.push({ kind: 'block_separator', textStart: separatorStart, textEnd: separatorStart + 1, pmFrom: null, pmTo: null, blockIndex: index });
    }
  });
  return { text: finalParts.join(''), segments: withSeparators, blocks: blocks.map((block, index) => ({ ...block, textStart: block.textStart + index, textEnd: block.textEnd + index })) };
}

export function mapTextRange(projection: Projection, textStart: number, textEnd: number): { pmFrom: number; pmTo: number } | null {
  if (!Number.isInteger(textStart) || !Number.isInteger(textEnd) || textStart < 0 || textEnd <= textStart || textEnd > projection.text.length) return null;
  const intersected = projection.segments.filter((segment) => segment.textStart < textEnd && segment.textEnd > textStart);
  if (!intersected.length || intersected.some((segment) => segment.kind === 'block_separator' || segment.pmFrom === null || segment.pmTo === null)) return null;
  const first = intersected[0];
  const last = intersected[intersected.length - 1];
  const pmFrom = first.pmFrom! + Math.max(0, textStart - first.textStart);
  const pmTo = last.pmFrom! + Math.min(last.textEnd - last.textStart, textEnd - last.textStart);
  return pmFrom < pmTo ? { pmFrom, pmTo } : null;
}

export function mapTextOffset(projection: Projection, offset: number): { pmFrom: number; pmTo: number } | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > projection.text.length) return null;
  const segment = projection.segments.find((candidate) => candidate.kind !== 'block_separator' && candidate.pmFrom !== null && candidate.pmTo !== null && offset >= candidate.textStart && offset <= candidate.textEnd);
  if (!segment) return null;
  const pm = segment.pmFrom! + Math.min(offset - segment.textStart, segment.textEnd - segment.textStart);
  return { pmFrom: pm, pmTo: pm };
}
