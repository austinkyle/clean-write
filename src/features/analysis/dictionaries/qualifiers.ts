export const QUALIFIERS = [
  { phrase: 'a little', removable: true, confidence: 'medium' as const }, { phrase: 'a bit', removable: true, confidence: 'medium' as const }, { phrase: 'kind of', removable: true, confidence: 'medium' as const }, { phrase: 'sort of', removable: true, confidence: 'medium' as const },
  ...['actually', 'almost', 'basically', 'fairly', 'maybe', 'perhaps', 'possibly', 'quite', 'rather', 'really', 'somewhat', 'totally', 'very'].map((phrase) => ({ phrase, removable: true, confidence: 'high' as const })),
  { phrase: 'just', removable: true, confidence: 'low' as const }, { phrase: 'pretty', removable: true, confidence: 'low' as const },
] as const;
