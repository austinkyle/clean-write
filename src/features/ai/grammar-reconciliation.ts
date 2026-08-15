import type { MappedFinding, Projection, TextFinding } from '@/features/analysis/types';
import { fnv1a } from '@/features/analysis/normalize';
import { mapTextOffset, mapTextRange } from '@/features/analysis/projection';
import { GrammarResponseSchema } from './schemas';
import type { GrammarRequest, GrammarResponse } from './types';

export function reconcileGrammarResponse(response: GrammarResponse, snapshot: GrammarRequest & { projection: Projection }): MappedFinding[] {
  const parsed = GrammarResponseSchema.safeParse(response);
  if (!parsed.success) return [];
  const sources = new Map(snapshot.sources.map((source) => [source.sourceId, source]));
  return parsed.data.issues.flatMap((issue) => {
    const source = sources.get(issue.sourceId);
    if (!source || source.projectionStart < 0 || source.projectionStart + source.text.length > snapshot.projection.text.length || snapshot.projection.text.slice(source.projectionStart, source.projectionStart + source.text.length) !== source.text || issue.end < issue.start || issue.end > source.text.length || source.text.slice(issue.start, issue.end) !== issue.original) return [];
    const splitsSurrogate = (offset: number) => offset > 0 && offset < source.text.length && source.text.charCodeAt(offset - 1) >= 0xd800 && source.text.charCodeAt(offset - 1) <= 0xdbff && source.text.charCodeAt(offset) >= 0xdc00 && source.text.charCodeAt(offset) <= 0xdfff;
    if (splitsSurrogate(issue.start) || splitsSurrogate(issue.end)) return [];
    if (issue.end > issue.start && issue.replacement === issue.original) return [];
    const globalStart = source.projectionStart + issue.start;
    const globalEnd = source.projectionStart + issue.end;
    const mapped = issue.start === issue.end ? mapTextOffset(snapshot.projection, globalStart) : mapTextRange(snapshot.projection, globalStart, globalEnd);
    if (!mapped) return [];
    const finding: TextFinding = {
      id: fnv1a('grammar-v1:' + snapshot.documentId + ':' + snapshot.editorGeneration + ':' + issue.sourceId + ':' + issue.start + ':' + issue.end + ':' + issue.category),
      category: issue.category,
      severity: 'warning',
      textStart: globalStart,
      textEnd: globalEnd,
      excerpt: issue.original,
      message: issue.subtype,
      explanation: issue.explanation,
      confidence: issue.confidence,
      suggestions: [{ label: issue.replacement || 'Remove', replacement: issue.replacement, kind: 'ai' }],
      metadata: { sourceId: issue.sourceId, blockIndex: source.blockIndex, subtype: issue.subtype, grammarRequestId: snapshot.requestId },
    };
    return [{ ...finding, pmFrom: mapped.pmFrom, pmTo: mapped.pmTo, editorGeneration: snapshot.editorGeneration, isStale: false } satisfies MappedFinding];
  });
}
