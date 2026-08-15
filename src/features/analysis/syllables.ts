const EXCEPTIONS: Record<string, number> = { queue: 1, people: 2, business: 2, every: 2, different: 3, beautiful: 3, fire: 1, hour: 1, rhythm: 2, because: 2, enough: 2, world: 1 };

export function estimateSyllables(input: string): number {
  const word = input.toLowerCase().replace(/[’']/gu, '').replace(/[^a-z]/gu, '');
  if (!word) return 0;
  if (EXCEPTIONS[word] !== undefined) return EXCEPTIONS[word];
  if (word.length <= 3) return 1;
  const groups = word.match(/[aeiouy]+/g)?.length ?? 1;
  let count = groups;
  if (count > 1 && /e$/u.test(word) && !/[^aeiou]le$/u.test(word)) count -= 1;
  if (count > 1 && /(?:[^aeiou]ed|[^aeiou]es)$/u.test(word)) count -= 1;
  return Math.max(1, count);
}
