import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatBytesPerSec(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatDurationSeconds(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0s';
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatUptimeSince(timestampMs: number): string {
  if (!timestampMs || timestampMs <= 0) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  return formatDurationSeconds(diffSec);
}

export function formatTimeAgo(timestampMs: number): string {
  if (!timestampMs) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export interface AnsiSegment {
  text: string;
  className?: string;
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: 'text-zinc-500',
  31: 'text-rose-400',
  32: 'text-emerald-400',
  33: 'text-amber-400',
  34: 'text-sky-400',
  35: 'text-fuchsia-400',
  36: 'text-cyan-400',
  37: 'text-zinc-200',
  90: 'text-zinc-500',
  91: 'text-rose-300',
  92: 'text-emerald-300',
  93: 'text-amber-300',
  94: 'text-sky-300',
  95: 'text-fuchsia-300',
  96: 'text-cyan-300',
};

export function parseAnsiSegments(input: string): AnsiSegment[] {
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]*)m/g;
  const segments: AnsiSegment[] = [];
  let lastIdx = 0;
  let currentClass = '';

  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIdx) {
      segments.push({
        text: input.slice(lastIdx, match.index),
        className: currentClass || undefined,
      });
    }
    const codes = match[1]
      .split(';')
      .filter(Boolean)
      .map((n) => Number.parseInt(n, 10));
    if (codes.length === 0 || codes.includes(0)) {
      currentClass = '';
    } else {
      const classes: string[] = [];
      for (const c of codes) {
        if (c === 1) classes.push('font-semibold');
        if (ANSI_COLOR_MAP[c]) classes.push(ANSI_COLOR_MAP[c]);
      }
      if (classes.length > 0) currentClass = classes.join(' ');
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < input.length) {
    segments.push({
      text: input.slice(lastIdx),
      className: currentClass || undefined,
    });
  }

  return segments.length > 0 ? segments : [{ text: input }];
}

export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}
