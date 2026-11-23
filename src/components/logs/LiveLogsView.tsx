import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Download,
  Eraser,
  Pause,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import { ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { wsClient } from '@/api/wsClient';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { parseAnsiSegments, stripAnsi } from '@/utils/format';

interface LogLine {
  id: number;
  source: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: number;
}

export const LiveLogsView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const {
    telemetry,
    selectedLogProcessByServer,
    pushToast,
    jumpToAiDiagnoseLogs,
    confirmDanger,
  } = useApp();

  const processes = telemetry[server.id]?.processes || [];
  const [selectedProc, setSelectedProc] = useState<string>(
    selectedLogProcessByServer[server.id] || '',
  );
  const [sourceFilter, setSourceFilter] = useState<'all' | 'stdout' | 'stderr'>(
    'all',
  );
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const [lines, setLines] = useState<LogLine[]>([]);
  const seqRef = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const incoming = selectedLogProcessByServer[server.id];
    if (incoming !== undefined) {
      setSelectedProc(incoming);
    }
  }, [selectedLogProcessByServer, server.id]);

  useEffect(() => {
    if (server.connectionStatus !== 'connected') return;
    const streamId = `logs-${server.id}-${Date.now()}`;
    setLines([]);

    wsClient.send({
      type: 'logs:start',
      streamId,
      serverId: server.id,
      processName: selectedProc || undefined,
      lines: 120,
    });

    const unsub = wsClient.subscribe((msg) => {
      if (msg.type === 'logs:chunk' && msg.streamId === streamId) {
        setLines((prev) => {
          const next = [
            ...prev,
            {
              id: seqRef.current++,
              source: msg.source,
              line: msg.line,
              timestamp: msg.timestamp,
            },
          ];
          return next.length > 1500 ? next.slice(-1500) : next;
        });
      } else if (msg.type === 'logs:error' && msg.streamId === streamId) {
        setLines((prev) => [
          ...prev,
          {
            id: seqRef.current++,
            source: 'stderr',
            line: `[stream error] ${msg.message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    });

    return () => {
      unsub();
      wsClient.send({ type: 'logs:stop', streamId });
    };
  }, [server.id, server.connectionStatus, selectedProc]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (!q) return true;
      return stripAnsi(item.line).toLowerCase().includes(q);
    });
  }, [lines, sourceFilter, search]);

  useEffect(() => {
    if (follow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, follow]);

  const handleFlushRemote = async () => {
    const target = selectedProc || 'all';
    const ok = await confirmDanger({
      title: `Flush PM2 Logs (${target})`,
      description: `Clear PM2 log files on ${server.name} for "${target}"?`,
      environment: server.environment,
    });
    if (!ok) return;
    try {
      await api.pm2Action(server.id, { target, action: 'flush' });
      setLines([]);
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
    const content = filtered.map((l) => stripAnsi(l.line)).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${server.name}-${selectedProc || 'all'}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDiagnoseWithAi = () => {
    const sample = filtered
      .slice(-80)
      .map((l) => stripAnsi(l.line))
      .join('\n');
    jumpToAiDiagnoseLogs(server.id, selectedProc || 'all', sample);
  };

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {t.logs.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDiagnoseWithAi}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-500/20 disabled:opacity-40 dark:text-indigo-300"
          >
            <Bot className="h-3.5 w-3.5" />
            <span>{t.logs.diagnoseAi}</span>
          </button>
          <button
            onClick={handleDownload}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t.logs.download}</span>
          </button>
          <button
            onClick={() => void handleFlushRemote()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-500/10 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t.logs.flush}</span>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          dir="ltr"
          value={selectedProc}
          onChange={(e) => setSelectedProc(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-800 outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="">{t.logs.allProcesses}</option>
          {processes.map((p) => (
            <option key={p.name} value={p.name}>
              #{p.pm_id} {p.name} ({p.status})
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) =>
            setSourceFilter(e.target.value as 'all' | 'stdout' | 'stderr')
          }
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="all">{t.logs.allSources}</option>
          <option value="stdout">{t.logs.stdoutOnly}</option>
          <option value="stderr">{t.logs.stderrOnly}</option>
        </select>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            dir="ltr"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.logs.filterPlaceholder}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pe-3 ps-9 font-mono text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <button
          onClick={() => setFollow((f) => !f)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${
            follow
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
              : 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
          }`}
        >
          {follow ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span>{follow ? t.logs.follow : t.logs.paused}</span>
        </button>

        <button
          onClick={() => setLines([])}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <Eraser className="h-3.5 w-3.5" />
          <span>{t.logs.clear}</span>
        </button>
      </div>

      {/* Console Log Viewer */}
      <div
        ref={containerRef}
        dir="ltr"
        className="mt-3 flex-1 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-200 shadow-inner"
      >
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-500">
            {t.logs.empty}
          </div>
        ) : (
          filtered.map((item) => {
            const segments = parseAnsiSegments(item.line);
            return (
              <div
                key={item.id}
                className={`whitespace-pre-wrap break-all py-0.5 ${
                  item.source === 'stderr'
                    ? 'bg-rose-500/5 text-rose-300'
                    : item.source === 'system'
                      ? 'text-zinc-500 italic'
                      : ''
                }`}
              >
                {segments.map((seg, i) => (
                  <span key={i} className={seg.className}>
                    {seg.text}
                  </span>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
