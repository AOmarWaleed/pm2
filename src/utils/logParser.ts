import { stripAnsi } from './format';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'unknown';

export interface ParsedLogEntry {
  id: number;
  raw: string;
  clean: string;
  source: 'stdout' | 'stderr' | 'system';
  timestamp: number;
  level: LogLevel;
  fields: Record<string, string>;
  jsonPayload: Record<string, unknown> | null;
  dedupeKey: string;
}

export interface LogHistogramBucket {
  bucketIdx: number;
  label: string;
  startTs: number;
  endTs: number;
  error: number;
  warn: number;
  info: number;
  debug: number;
  total: number;
}

function normalizeLevel(val: unknown, cleanText: string, source: string): LogLevel {
  const str = typeof val === 'string' ? val.toLowerCase() : '';
  if (
    str === 'error' ||
    str === 'err' ||
    str === 'fatal' ||
    str === 'crit' ||
    str === 'critical'
  ) {
    return 'error';
  }
  if (str === 'warn' || str === 'warning') return 'warn';
  if (str === 'info' || str === 'notice') return 'info';
  if (str === 'debug' || str === 'trace') return 'debug';

  const lower = cleanText.toLowerCase();
  if (
    /\b(error|err|fatal|exception|unhandled|etimedout|econnrefused|panic|crit)\b/.test(
      lower,
    ) ||
    /\[error\]/i.test(cleanText) ||
    /\b5\d{2}\b/.test(cleanText)
  ) {
    return 'error';
  }
  if (/\b(warn|warning|deprecated|retry|timeout|slow)\b/.test(lower) || /\[warn\]/i.test(cleanText)) {
    return 'warn';
  }
  if (/\b(debug|trace)\b/.test(lower)) {
    return 'debug';
  }
  if (source === 'stderr') return 'warn';
  if (/\b(info|started|listening|connected|200|201|202|ok)\b/.test(lower)) {
    return 'info';
  }
  return 'unknown';
}

function extractTimestamp(clean: string, jsonObj: Record<string, unknown> | null, fallback: number): number {
  if (jsonObj) {
    const candidate = jsonObj.timestamp || jsonObj.ts || jsonObj.time || jsonObj['@timestamp'];
    if (typeof candidate === 'number') {
      return candidate > 1e12 ? candidate : candidate * 1000;
    }
    if (typeof candidate === 'string') {
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }

  const isoMatch = clean.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0]);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return fallback;
}

function extractKeyValues(clean: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const kvRegex = /(?:^|\s)([A-Za-z_][A-Za-z0-9_.-]{0,30})=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = kvRegex.exec(clean)) !== null) {
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    fields[key] = val;
  }
  return fields;
}

export function parseLogEntry(
  id: number,
  raw: string,
  source: 'stdout' | 'stderr' | 'system',
  fallbackTs: number,
): ParsedLogEntry {
  const clean = stripAnsi(raw);
  let jsonPayload: Record<string, unknown> | null = null;
  const trimmed = clean.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        jsonPayload = parsed as Record<string, unknown>;
      }
    } catch {
      // not valid JSON
    }
  }

  const fields: Record<string, string> = jsonPayload
    ? {}
    : extractKeyValues(clean);

  if (jsonPayload) {
    for (const [k, v] of Object.entries(jsonPayload)) {
      if (v === null || v === undefined) continue;
      fields[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }

  const timestamp = extractTimestamp(clean, jsonPayload, fallbackTs);
  const level = normalizeLevel(
    jsonPayload?.level ?? fields.level,
    clean,
    source,
  );

  // Dedupe signature replaces timestamps, hex/req IDs, and volatile numbers
  const dedupeKey = clean
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<TS>')
    .replace(/\breq_[A-Za-z0-9]+/g, 'req_<ID>')
    .replace(/\breq=[A-Za-z0-9]+/g, 'req=<ID>')
    .replace(/\b\d+ms\b/g, '<MS>');

  return {
    id,
    raw,
    clean,
    source,
    timestamp,
    level,
    fields,
    jsonPayload,
    dedupeKey,
  };
}

export function buildLogHistogram(
  entries: ParsedLogEntry[],
  bucketCount = 30,
): LogHistogramBucket[] {
  if (entries.length === 0) return [];

  let minTs = entries[0].timestamp;
  let maxTs = entries[0].timestamp;
  for (const e of entries) {
    if (e.timestamp < minTs) minTs = e.timestamp;
    if (e.timestamp > maxTs) maxTs = e.timestamp;
  }

  const span = Math.max(60_000, maxTs - minTs);
  const step = Math.ceil(span / bucketCount);
  const buckets: LogHistogramBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const startTs = minTs + i * step;
    const endTs = startTs + step;
    buckets.push({
      bucketIdx: i,
      label: new Date(startTs).toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      startTs,
      endTs,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      total: 0,
    });
  }

  for (const e of entries) {
    const idx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((e.timestamp - minTs) / step)),
    );
    const b = buckets[idx];
    b.total += 1;
    if (e.level === 'error') b.error += 1;
    else if (e.level === 'warn') b.warn += 1;
    else if (e.level === 'debug') b.debug += 1;
    else b.info += 1;
  }

  return buckets;
}
