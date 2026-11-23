import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart2,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
  WrapText,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LogSourceType, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { wsClient } from '@/api/wsClient';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { parseAnsiSegments } from '@/utils/format';
import {
  buildLogHistogram,
  LogLevel,
  ParsedLogEntry,
  parseLogEntry,
} from '@/utils/logParser';

export interface LogTabItem {
  id: string;
  label: string;
  sourceType: LogSourceType;
  target: string;
}

type TimeRangeMode = 'live' | '15m' | '1h' | '6h' | '24h';

interface FilterChip {
  id: string;
  mode: 'include' | 'exclude';
  value: string;
}

const LEVEL_STYLES: Record<
  LogLevel,
  { bar: string; badge: string; label: string }
> = {
  error: {
    bar: 'bg-rose-500',
    badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    label: 'ERR',
  },
  warn: {
    bar: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    label: 'WARN',
  },
  info: {
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    label: 'INFO',
  },
  debug: {
    bar: 'bg-indigo-500',
    badge: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    label: 'DBG',
  },
  unknown: {
    bar: 'bg-zinc-600',
    badge: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40',
    label: 'LOG',
  },
};

export const LogTabPane: React.FC<{
  server: ServerPublicConfig;
  tab: LogTabItem;
  isBookmarked: boolean;
  onToggleBookmark: (tab: LogTabItem) => void;
}> = ({ server, tab, isBookmarked, onToggleBookmark }) => {
  const { t } = useI18n();
  const { pushToast, jumpToAiDiagnoseLogs, confirmDanger } = useApp();

  const [timeRange, setTimeRange] = useState<TimeRangeMode>('live');
  const [entries, setEntries] = useState<ParsedLogEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [search, setSearch] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [chips, setChips] = useState<FilterChip[]>([]);
  const [chipDraft, setChipDraft] = useState('');
  const [levelFilter, setLevelFilter] = useState<Record<LogLevel, boolean>>({
    error: true,
    warn: true,
    info: true,
    debug: true,
    unknown: true,
  });

  const [wrapLines, setWrapLines] = useState(true);
  const [prettyJson, setPrettyJson] = useState(false);
  const [dedupe, setDedupe] = useState(false);
  const [showHistogram, setShowHistogram] = useState(true);
  const [follow, setFollow] = useState(true);

  const [bucketRange, setBucketRange] = useState<{
    startTs: number;
    endTs: number;
  } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [contextId, setContextId] = useState<number | null>(null);

  const seqRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  // Live streaming OR historical fetch
  useEffect(() => {
    if (server.connectionStatus !== 'connected') return;
    setBucketRange(null);
    setExpandedId(null);
    setContextId(null);

    if (timeRange === 'live') {
      const streamId = `glog-${tab.id}-${Date.now()}`;
      setEntries([]);

      wsClient.send({
        type: 'logs:start',
        streamId,
        serverId: server.id,
        sourceType: tab.sourceType,
        target: tab.target,
        processName: tab.sourceType === 'pm2' ? tab.target : undefined,
        lines: 150,
      });

      const unsub = wsClient.subscribe((msg) => {
        if (msg.type === 'logs:chunk' && msg.streamId === streamId) {
          const parsed = parseLogEntry(
            seqRef.current++,
            msg.line,
            msg.source,
            msg.timestamp,
          );
          setEntries((prev) => {
            const next = [...prev, parsed];
            return next.length > 2000 ? next.slice(-2000) : next;
          });
        } else if (msg.type === 'logs:error' && msg.streamId === streamId) {
          const parsed = parseLogEntry(
            seqRef.current++,
            `[stream error] ${msg.message}`,
            'stderr',
            Date.now(),
          );
          setEntries((prev) => [...prev, parsed]);
        }
      });

      return () => {
        unsub();
        wsClient.send({ type: 'logs:stop', streamId });
      };
    }

    const rangeMinMap: Record<Exclude<TimeRangeMode, 'live'>, number> = {
      '15m': 15,
      '1h': 60,
      '6h': 360,
      '24h': 1440,
    };
    const rangeMinutes = rangeMinMap[timeRange];
    setLoadingHistory(true);
    api
      .fetchLogHistory(server.id, {
        sourceType: tab.sourceType,
        target: tab.target,
        rangeMinutes,
        maxLines: 800,
      })
      .then((res) => {
        const parsed = res.lines.map((l) =>
          parseLogEntry(seqRef.current++, l.line, l.source, l.timestamp),
        );
        setEntries(parsed);
      })
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: 'Failed to load log history',
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setLoadingHistory(false));
  }, [
    server.id,
    server.connectionStatus,
    tab.id,
    tab.sourceType,
    tab.target,
    timeRange,
    pushToast,
  ]);

  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = {
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      unknown: 0,
    };
    for (const e of entries) counts[e.level] += 1;
    return counts;
  }, [entries]);

  const compiledRegex = useMemo(() => {
    if (!useRegex || !search.trim()) return null;
    try {
      return new RegExp(search.trim(), matchCase ? '' : 'i');
    } catch {
      return null;
    }
  }, [useRegex, search, matchCase]);

  const filteredWithoutBucket = useMemo(() => {
    const q = search.trim();
    const qCmp = matchCase ? q : q.toLowerCase();

    return entries.filter((item) => {
      if (!levelFilter[item.level]) return false;

      if (q) {
        if (useRegex) {
          if (compiledRegex && !compiledRegex.test(item.clean)) return false;
        } else {
          const hay = matchCase ? item.clean : item.clean.toLowerCase();
          if (!hay.includes(qCmp)) return false;
        }
      }

      for (const chip of chips) {
        const val = matchCase ? chip.value : chip.value.toLowerCase();
        const hay = matchCase ? item.clean : item.clean.toLowerCase();
        const matches = hay.includes(val);
        if (chip.mode === 'include' && !matches) return false;
        if (chip.mode === 'exclude' && matches) return false;
      }

      return true;
    });
  }, [entries, levelFilter, search, useRegex, matchCase, compiledRegex, chips]);

  const histogramData = useMemo(
    () => buildLogHistogram(filteredWithoutBucket, 28),
    [filteredWithoutBucket],
  );

  const displayRows = useMemo(() => {
    const base = bucketRange
      ? filteredWithoutBucket.filter(
          (e) =>
            e.timestamp >= bucketRange.startTs &&
            e.timestamp <= bucketRange.endTs,
        )
      : filteredWithoutBucket;

    if (!dedupe) {
      return base.map((entry) => ({ entry, repeatCount: 1 }));
    }

    const out: Array<{ entry: ParsedLogEntry; repeatCount: number }> = [];
    const seenIdx = new Map<string, number>();
    for (const entry of base) {
      const prevIdx = seenIdx.get(entry.dedupeKey);
      if (prevIdx !== undefined) {
        out[prevIdx].repeatCount += 1;
        out[prevIdx].entry = entry; // update to latest timestamp
      } else {
        seenIdx.set(entry.dedupeKey, out.length);
        out.push({ entry, repeatCount: 1 });
      }
    }
    return out;
  }, [filteredWithoutBucket, bucketRange, dedupe]);

  useEffect(() => {
    if (follow && timeRange === 'live' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [displayRows.length, follow, timeRange]);

  const addChip = (mode: 'include' | 'exclude', rawVal?: string) => {
    const value = (rawVal ?? chipDraft).trim();
    if (!value) return;
    setChips((prev) => [
      ...prev,
      { id: `${mode}-${Date.now()}-${Math.random()}`, mode, value },
    ]);
    if (!rawVal) setChipDraft('');
  };

  const handleFlushRemote = async () => {
    if (tab.sourceType !== 'pm2') return;
    const target = tab.target || 'all';
    const ok = await confirmDanger({
      title: `Flush PM2 Logs (${target})`,
      description: `Clear PM2 log files on ${server.name} for "${target}"?`,
      environment: server.environment,
    });
    if (!ok) return;
    try {
      await api.pm2Action(server.id, { target, action: 'flush' });
      setEntries([]);
      pushToast({ variant: 'success', title: 'Remote PM2 logs flushed' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Flush failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDownload = () => {
    const content = displayRows.map((r) => r.entry.clean).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${server.name}-${tab.label.replace(/[^a-zA-Z0-9._-]/g, '_')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDiagnose = () => {
    const sample = displayRows
      .slice(-80)
      .map((r) => r.entry.clean)
      .join('\n');
    jumpToAiDiagnoseLogs(server.id, tab.target || 'all', sample);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/70">
      {/* Pane Toolbar Row 1: Time Range + View Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            dir="ltr"
            className="rounded-md bg-zinc-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-700 dark:text-zinc-200"
          >
            {tab.sourceType}: {tab.target || 'all'}
          </span>

          <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950">
            {(
              [
                ['live', t.logs.liveTail],
                ['15m', t.logs.last15m],
                ['1h', t.logs.last1h],
                ['6h', t.logs.last6h],
                ['24h', t.logs.last24h],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setTimeRange(mode)}
                className={`rounded-md px-2 py-0.5 font-medium transition ${
                  timeRange === mode
                    ? 'bg-emerald-600 text-white'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => onToggleBookmark(tab)}
            title={t.logs.bookmarkTab}
            className={`rounded-lg border p-1.5 ${
              isBookmarked
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800'
            }`}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={isBookmarked ? 'currentColor' : 'none'}
            />
          </button>

          <button
            onClick={() => setShowHistogram((v) => !v)}
            title={t.logs.histogram}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${
              showHistogram
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                : 'border-zinc-200 text-zinc-500 dark:border-zinc-800'
            }`}
          >
            <BarChart2 className="h-3 w-3" />
          </button>

          <button
            onClick={() => setWrapLines((v) => !v)}
            title={t.logs.wrap}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${
              wrapLines
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                : 'border-zinc-200 text-zinc-500 dark:border-zinc-800'
            }`}
          >
            <WrapText className="h-3 w-3" />
            <span className="hidden sm:inline">{t.logs.wrap}</span>
          </button>

          <button
            onClick={() => setPrettyJson((v) => !v)}
            className={`rounded-lg border px-2 py-1 font-mono text-[10px] ${
              prettyJson
                ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400'
                : 'border-zinc-200 text-zinc-500 dark:border-zinc-800'
            }`}
          >
            JSON
          </button>

          <button
            onClick={() => setDedupe((v) => !v)}
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              dedupe
                ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400'
                : 'border-zinc-200 text-zinc-500 dark:border-zinc-800'
            }`}
          >
            {t.logs.dedupe}
          </button>

          {timeRange === 'live' && (
            <button
              onClick={() => setFollow((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${
                follow
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
                  : 'border-zinc-200 text-zinc-500 dark:border-zinc-800'
              }`}
            >
              {follow ? (
                <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              <span>{follow ? t.logs.follow : t.logs.paused}</span>
            </button>
          )}

          <button
            onClick={() => setEntries([])}
            title={t.logs.clear}
            className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownload}
            disabled={displayRows.length === 0}
            title={t.logs.download}
            className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {tab.sourceType === 'pm2' && (
            <>
              <button
                onClick={() => void handleFlushRemote()}
                title={t.logs.flush}
                className="rounded-lg border border-zinc-200 p-1.5 text-rose-500 hover:bg-rose-500/10 dark:border-zinc-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDiagnose}
                disabled={displayRows.length === 0}
                title={t.logs.diagnoseAi}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-[11px] font-semibold text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40"
              >
                <Bot className="h-3 w-3" />
                <span className="hidden md:inline">AI</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Loki Query Filters + Level Pills */}
      <div className="space-y-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search input with Regex / Case */}
          <div className="relative flex min-w-[140px] flex-1 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 dark:border-zinc-800 dark:bg-zinc-950">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              dir="ltr"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.logs.filterPlaceholder}
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs text-zinc-900 outline-none dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => setUseRegex((v) => !v)}
              title={t.logs.regex}
              className={`me-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                useRegex
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              .*
            </button>
            <button
              type="button"
              onClick={() => setMatchCase((v) => !v)}
              title={t.logs.matchCase}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                matchCase
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Aa
            </button>
          </div>

          {/* Quick |= Include / != Exclude builder */}
          <div
            dir="ltr"
            className="flex items-center rounded-xl border border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <input
              value={chipDraft}
              onChange={(e) => setChipDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChip('include');
                }
              }}
              placeholder="|= / !="
              className="w-28 bg-transparent py-1.5 font-mono text-[11px] text-zinc-900 outline-none dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => addChip('include')}
              title="Include (|=)"
              className="rounded p-1 text-emerald-500 hover:bg-emerald-500/15"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => addChip('exclude')}
              title="Exclude (!=)"
              className="rounded p-1 text-rose-500 hover:bg-rose-500/15"
            >
              <Minus className="h-3 w-3" />
            </button>
          </div>

          {/* Level Toggle Pills */}
          <div dir="ltr" className="flex flex-wrap items-center gap-1">
            {(['error', 'warn', 'info', 'debug'] as const).map((lvl) => {
              const active = levelFilter[lvl];
              const st = LEVEL_STYLES[lvl];
              return (
                <button
                  key={lvl}
                  onClick={() =>
                    setLevelFilter((p) => ({ ...p, [lvl]: !p[lvl] }))
                  }
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[10px] font-semibold transition ${
                    active
                      ? st.badge
                      : 'border-zinc-300 bg-transparent text-zinc-400 opacity-50 dark:border-zinc-800'
                  }`}
                >
                  <span>{st.label}</span>
                  <span>{levelCounts[lvl]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Include / Exclude / Time Bucket Chips */}
        {(chips.length > 0 || bucketRange) && (
          <div dir="ltr" className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                  c.mode === 'include'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                }`}
              >
                <span>
                  {c.mode === 'include' ? '|=' : '!='} &quot;{c.value}&quot;
                </span>
                <button
                  onClick={() =>
                    setChips((p) => p.filter((x) => x.id !== c.id))
                  }
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {bucketRange && (
              <button
                onClick={() => setBucketRange(null)}
                className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400"
              >
                <span>{t.logs.resetTimeZoom}</span>
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grafana Stacked Log Volume Histogram */}
      {showHistogram && histogramData.length > 0 && (
        <div
          dir="ltr"
          className="h-28 shrink-0 border-b border-zinc-200 bg-zinc-50/60 px-2 pt-2 dark:border-zinc-800 dark:bg-zinc-950/60"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={histogramData}
              onClick={(state) => {
                const payload = state?.activePayload?.[0]?.payload as
                  | { startTs: number; endTs: number }
                  | undefined;
                if (payload) {
                  setBucketRange({
                    startTs: payload.startTs,
                    endTs: payload.endTs,
                  });
                }
              }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="rgba(113,113,122,0.16)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: '#71717a' }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#71717a' }}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#27272a',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                  color: '#f4f4f5',
                }}
              />
              <Bar dataKey="error" stackId="lvl" fill="#f43f5e" name="ERR" />
              <Bar dataKey="warn" stackId="lvl" fill="#f59e0b" name="WARN" />
              <Bar dataKey="info" stackId="lvl" fill="#10b981" name="INFO" />
              <Bar dataKey="debug" stackId="lvl" fill="#6366f1" name="DBG" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Structured Expandable Log Rows */}
      <div
        ref={listRef}
        dir="ltr"
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-2 font-mono text-[11.5px] text-zinc-200"
      >
        {loadingHistory ? (
          <div className="py-12 text-center text-xs text-zinc-500">
            Loading logs...
          </div>
        ) : displayRows.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-500">
            {t.logs.empty}
          </div>
        ) : (
          displayRows.map(({ entry, repeatCount }) => {
            const st = LEVEL_STYLES[entry.level];
            const isExpanded = expandedId === entry.id;
            const showCtx = contextId === entry.id;
            const fieldEntries = Object.entries(entry.fields);

            let contextSlice: ParsedLogEntry[] = [];
            if (showCtx) {
              const fullIdx = entries.findIndex((e) => e.id === entry.id);
              if (fullIdx !== -1) {
                contextSlice = entries.slice(
                  Math.max(0, fullIdx - 5),
                  Math.min(entries.length, fullIdx + 6),
                );
              }
            }

            const renderedText =
              prettyJson && entry.jsonPayload
                ? JSON.stringify(entry.jsonPayload, null, 2)
                : entry.raw;

            return (
              <div
                key={entry.id}
                className="border-b border-zinc-900/80 last:border-b-0"
              >
                <div
                  onClick={() =>
                    setExpandedId((prev) =>
                      prev === entry.id ? null : entry.id,
                    )
                  }
                  className={`flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 transition hover:bg-zinc-900/90 ${
                    isExpanded ? 'bg-zinc-900' : ''
                  }`}
                >
                  <span
                    className={`mt-1 h-3.5 w-1 shrink-0 rounded-full ${st.bar}`}
                  />
                  <span className="mt-0.5 shrink-0 text-zinc-500">
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-zinc-500">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1 py-0 text-[9.5px] font-bold ${st.badge}`}
                  >
                    {st.label}
                  </span>
                  {repeatCount > 1 && (
                    <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 text-[10px] font-semibold text-indigo-300">
                      ×{repeatCount}
                    </span>
                  )}
                  <div
                    className={`min-w-0 flex-1 ${
                      wrapLines
                        ? 'whitespace-pre-wrap break-all'
                        : 'truncate whitespace-pre'
                    }`}
                  >
                    {prettyJson && entry.jsonPayload ? (
                      <span className="text-emerald-200">{renderedText}</span>
                    ) : (
                      parseAnsiSegments(renderedText).map((seg, idx) => (
                        <span key={idx} className={seg.className}>
                          {seg.text}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Grafana Explore Expanded Detected Fields Drawer */}
                {isExpanded && (
                  <div className="mx-4 my-1.5 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
                      <span className="font-sans text-xs font-semibold text-zinc-200">
                        {t.logs.detectedFields} ({fieldEntries.length})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextId((p) =>
                              p === entry.id ? null : entry.id,
                            );
                          }}
                          className="rounded-md border border-zinc-700 px-2 py-0.5 font-sans text-[10px] text-sky-400 hover:bg-zinc-800"
                        >
                          {showCtx ? t.logs.hideContext : t.logs.showContext}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigator.clipboard?.writeText(entry.clean);
                            pushToast({
                              variant: 'info',
                              title: 'Log line copied',
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 font-sans text-[10px] text-zinc-300 hover:bg-zinc-800"
                        >
                          <Copy className="h-2.5 w-2.5" />
                          <span>Copy</span>
                        </button>
                      </div>
                    </div>

                    {fieldEntries.length > 0 ? (
                      <div className="mt-2 divide-y divide-zinc-800/70">
                        {fieldEntries.map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between gap-3 py-1"
                          >
                            <div className="flex min-w-0 flex-1 items-baseline gap-3">
                              <span className="w-32 shrink-0 truncate font-semibold text-emerald-400">
                                {k}
                              </span>
                              <span className="break-all text-zinc-200">
                                {v}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addChip('include', v);
                                }}
                                title="Include value"
                                className="rounded p-1 text-emerald-400 hover:bg-emerald-500/15"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addChip('exclude', v);
                                }}
                                title="Exclude value"
                                className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 font-sans text-[11px] text-zinc-500">
                        Unstructured log line — raw text: {entry.clean}
                      </p>
                    )}

                    {showCtx && contextSlice.length > 0 && (
                      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                        {contextSlice.map((ctxLine) => (
                          <div
                            key={ctxLine.id}
                            className={`whitespace-pre-wrap break-all py-0.5 text-[10.5px] ${
                              ctxLine.id === entry.id
                                ? 'bg-sky-500/15 font-semibold text-sky-200'
                                : 'text-zinc-500'
                            }`}
                          >
                            {ctxLine.clean}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
