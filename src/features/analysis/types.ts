export const FINDING_CATEGORIES = ['hard_sentence', 'very_hard_sentence', 'adverb', 'qualifier', 'passive_voice', 'complex_word', 'grammar', 'spelling', 'punctuation'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type FindingSeverity = 'info' | 'warning' | 'critical';
export type ReadabilityTarget = 'accessible' | 'default' | 'technical';

export type ProjectionSegment = {
  kind: 'text' | 'hard_break' | 'block_separator';
  textStart: number;
  textEnd: number;
  pmFrom: number | null;
  pmTo: number | null;
  blockIndex: number;
};

export type ProjectionBlock = {
  index: number;
  nodeType: 'paragraph' | 'heading' | 'blockquote_paragraph' | 'list_item_paragraph';
  textStart: number;
  textEnd: number;
  pmContentFrom: number;
  pmContentTo: number;
  isEmpty: boolean;
};

export type Projection = { text: string; segments: ProjectionSegment[]; blocks: ProjectionBlock[] };
export type TextRange = { textStart: number; textEnd: number };
export type Suggestion = { label: string; replacement: string; kind: 'local' | 'ai' };
export type TextFinding = TextRange & {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  excerpt: string;
  message: string;
  explanation: string;
  confidence?: 'low' | 'medium' | 'high';
  suggestions?: Suggestion[];
  metadata: Record<string, string | number | boolean | string[]>;
};
export type MappedFinding = TextFinding & { pmFrom: number; pmTo: number; editorGeneration: number; isStale: boolean };
export type AnalysisStatistics = { characters: number; letters: number; words: number; sentences: number; paragraphs: number; readingMinutes: number };
export type SentenceSpan = TextRange & { text: string; words: Token[] };
export type Token = TextRange & { text: string; isWordLike: boolean };
export type ReadabilityResult = { grade: number | null; target: ReadabilityTarget; hardThreshold: number; veryHardThreshold: number };
export type AnalysisResult = { statistics: AnalysisStatistics; readability: ReadabilityResult; findings: TextFinding[]; textHash: string };

export type AnalyzeRequest = {
  type: 'analyze';
  requestId: number;
  documentId: string;
  editorGeneration: number;
  projection: { text: string; blocks: Array<Pick<ProjectionBlock, 'index' | 'nodeType' | 'textStart' | 'textEnd' | 'isEmpty'>> };
  settings: { readabilityTarget: ReadabilityTarget };
};
export type AnalyzeResponse = AnalysisResult & { type: 'result'; requestId: number; documentId: string; editorGeneration: number };
