import type { AnalysisStatistics, Projection } from './types';
import { segmentProjectionBlocks, tokenize } from './segmentation';

export function calculateStatistics(projection: Projection): AnalysisStatistics {
  const words = tokenize(projection.text).length;
  const sentences = segmentProjectionBlocks(projection.text, projection.blocks).length;
  const paragraphs = projection.blocks.filter((block) => !block.isEmpty && (block.nodeType === 'paragraph' || block.nodeType === 'list_item_paragraph')).length;
  const letters = Array.from(projection.text.matchAll(/\p{L}/gu)).length;
  return { characters: Array.from(projection.text).length, letters, words, sentences, paragraphs, readingMinutes: words === 0 ? 0 : Math.ceil(words / 200) };
}
