import React, { useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  FolderOpen,
  ScrollText,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Pm2Process, ServerPublicConfig } from '@shared/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { formatBytes, formatUptimeSince } from '@/utils/format';
import { ProcessStatusBadge } from '../common/Badges';

interface ProcessInspectorDrawerProps {
  process: Pm2Process | null;
  server: ServerPublicConfig;
  onClose: () => void;
}

const SECRET_KEY_PATTERN = /(secret|token|password|passwd|key|auth|credential|dsn|private)/i;

export const ProcessInspectorDrawer: React.FC<ProcessInspectorDrawerProps> = ({
  process,
  server,
  onClose,
}) => {
  const { t } = useI18n();
  const { telemetry, jumpToLogs, jumpToTerminal, jumpToFiles } = useApp();
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [envSearch, setEnvSearch] = useState('');

  const history = useMemo(() => {
    if (!process) return [];
    const points = telemetry[server.id]?.processHistory?.[process.name] || [];
    return points.map((pt) => ({
      time: new Date(pt.timestamp).toLocaleTimeString([], {
        hour12: false,
        minute: '2-digit',
        second: '2-digit',
      }),
      cpu: pt.cpu,
      memMb: Math.round(pt.memory / (1024 * 1024)),
    }));
  }, [process, server.id, telemetry]);

  if (!process) return null;

  const envEntries = Object.entries(process.env || {})
    .filter(([k, v]) => {
      if (!envSearch.trim()) return true;
      const q = envSearch.toLowerCase();
      return k.toLowerCase().includes(q) || v.toLowerCase().includes(q);
    })
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-2xl flex-col border-s border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                dir="ltr"
                className="rounded bg-zinc-500/15 px-1.5 py-0.5 font-mono text-xs text-zinc-500"
              >
                #{process.pm_id}
              </span>
              <h2
                dir="ltr"
                className="truncate font-mono text-base font-bold text-zinc-900 dark:text-zinc-100"
              >
                {process.name}
              </h2>
              <ProcessStatusBadge status={process.status} />
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {t.pm2.inspector.title} • {server.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                onClose();
                jumpToLogs(server.id, process.name);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <ScrollText className="h-3.5 w-3.5 text-emerald-500" />
              <span>{t.pm2.actions.logs}</span>
            </button>
            {process.cwd && (
              <>
                <button
                  onClick={() => {
                    onClose();
                    jumpToTerminal(server.id, process.cwd);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <Terminal className="h-3.5 w-3.5 text-sky-500" />
                  <span>{t.pm2.inspector.openTerminalCwd}</span>
                </button>
                <button
                  onClick={() => {
                    onClose();
                    jumpToFiles(server.id, process.cwd);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                  <span>{t.pm2.inspector.openFilesCwd}</span>
                </button>
              </>
            )}
          </div>

          {/* Live Monitor Chart */}
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                {t.pm2.inspector.liveMonitor}
              </h3>
              <div dir="ltr" className="flex gap-3 font-mono text-[11px]">
                <span className="text-emerald-500">
                  CPU {process.cpu.toFixed(1)}%
                </span>
                <span className="text-sky-500">
                  RAM {formatBytes(process.memory)}
                </span>
              </div>
            </div>
            <div dir="ltr" className="mt-3 h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(113,113,122,0.18)"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: '#71717a' }}
                  />
                  <YAxis
                    yAxisId="cpu"
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: '#10b981' }}
                    unit="%"
                  />
                  <YAxis
                    yAxisId="mem"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#0ea5e9' }}
                    unit="MB"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#27272a',
                      borderRadius: '0.75rem',
                      fontSize: '11px',
                      color: '#f4f4f5',
                    }}
                  />
                  <Area
                    yAxisId="cpu"
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke="#10b981"
                    fill="#10b98133"
                  />
                  <Area
                    yAxisId="mem"
                    type="monotone"
                    dataKey="memMb"
                    name="RAM (MB)"
                    stroke="#0ea5e9"
                    fill="#0ea5e933"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Runtime Metadata */}
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <h3 className="mb-3 font-semibold text-zinc-800 dark:text-zinc-200">
              {t.pm2.inspector.details}
            </h3>
            <div
              dir="ltr"
              className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]"
            >
              <div>
                <span className="text-zinc-500">PID: </span>
                <span>{process.pid || '—'}</span>
              </div>
              <div>
                <span className="text-zinc-500">Mode: </span>
                <span>
                  {process.execMode} ({process.instances}x)
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Uptime: </span>
                <span>{formatUptimeSince(process.uptime)}</span>
              </div>
              <div>
                <span className="text-zinc-500">Restarts: </span>
                <span>
                  {process.restarts} (unstable: {process.unstableRestarts})
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Interpreter: </span>
                <span>
                  {process.interpreter}{' '}
                  {process.nodeVersion ? `(${process.nodeVersion})` : ''}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Watch: </span>
                <span>{process.watching ? 'enabled' : 'disabled'}</span>
              </div>
              <div className="col-span-2 truncate">
                <span className="text-zinc-500">Script: </span>
                <span>{process.script || '—'}</span>
              </div>
              <div className="col-span-2 truncate">
                <span className="text-zinc-500">CWD: </span>
                <span>{process.cwd || '—'}</span>
              </div>
              <div className="col-span-2 truncate">
                <span className="text-zinc-500">Out Log: </span>
                <span>{process.outLogPath || '—'}</span>
              </div>
              <div className="col-span-2 truncate">
                <span className="text-zinc-500">Err Log: </span>
                <span>{process.errLogPath || '—'}</span>
              </div>
            </div>
          </div>

          {/* Environment Variables */}
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                {t.pm2.inspector.envVars} ({envEntries.length})
              </h3>
              <button
                onClick={() => setRevealSecrets((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {revealSecrets ? (
                  <>
                    <EyeOff className="h-3 w-3" />
                    <span>{t.pm2.inspector.hideSecrets}</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3 w-3" />
                    <span>{t.pm2.inspector.revealSecrets}</span>
                  </>
                )}
              </button>
            </div>

            <div className="relative mt-2.5">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={envSearch}
                onChange={(e) => setEnvSearch(e.target.value)}
                placeholder={t.pm2.inspector.searchEnv}
                className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pe-3 ps-8 text-xs outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>

            <div
              dir="ltr"
              className="mt-3 max-h-64 divide-y divide-zinc-200 overflow-y-auto rounded-xl border border-zinc-200 bg-white font-mono text-[11px] dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {envEntries.map(([k, v]) => {
                const isSensitive = SECRET_KEY_PATTERN.test(k);
                const displayVal =
                  isSensitive && !revealSecrets ? '••••••••••••' : v;
                return (
                  <div
                    key={k}
                    className="flex items-start justify-between gap-3 px-3 py-2"
                  >
                    <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">
                      {k}
                    </span>
                    <span className="break-all text-end text-zinc-700 dark:text-zinc-300">
                      {displayVal}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
