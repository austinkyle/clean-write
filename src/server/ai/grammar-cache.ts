import type { GrammarResponse } from '@/features/ai/types';

type Entry = { value: GrammarResponse; expiresAt: number };
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 50;
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<GrammarResponse>>();

export function getGrammarCache(key: string) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) { if (entry) cache.delete(key); return null; }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function setGrammarCache(key: string, value: GrammarResponse) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

export function getGrammarInFlight(key: string) { return inFlight.get(key); }
export function setGrammarInFlight(key: string, value: Promise<GrammarResponse>) { inFlight.set(key, value); }
export function clearGrammarInFlight(key: string) { inFlight.delete(key); }
export function clearGrammarCache() { cache.clear(); inFlight.clear(); }
