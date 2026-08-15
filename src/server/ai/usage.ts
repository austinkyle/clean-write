type UsageRecord = {
  requestId?: string;
  action: string;
  model: string;
  startedAt: number;
  durationMs: number;
  retryCount: number;
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
};

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 500;
const records: UsageRecord[] = [];

export function recordAIUsage(record: UsageRecord) {
  const cutoff = Date.now() - RETENTION_MS;
  records.push(record);
  while (records.length > MAX_RECORDS || (records[0] && records[0].startedAt < cutoff)) records.shift();
}

export function getAIUsageSnapshot() {
  const cutoff = Date.now() - RETENTION_MS;
  while (records[0] && records[0].startedAt < cutoff) records.shift();
  return records.map((record) => ({ ...record }));
}

export function clearAIUsage() { records.length = 0; }
