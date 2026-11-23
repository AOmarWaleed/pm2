import React from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  HardDrive,
  MemoryStick,
  Plug,
  Server,
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
import { ServerPublicConfig } from '@shared/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import {
  formatBytes,
  formatBytesPerSec,
  formatDurationSeconds,
} from '@/utils/format';
import { ProcessStatusBadge } from '../common/Badges';

export const ServerOverviewView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { telemetry, connectServer } = useApp();
  const snap = telemetry[server.id];
  const host = snap?.host;
  const procs = snap?.processes || [];

  if (server.connectionStatus !== 'connected' && !host) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-200/70 text-zinc-500 dark:bg-zinc-800">
          <Server className="h-6 w-6" />
        </div>
        <p className="mt-3 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
          {t.overview.disconnectedHint}
        </p>
        <button
          onClick={() => void connectServer(server.id)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Plug className="h-3.5 w-3.5" />
          <span>{t.fleet.connect}</span>
        </button>
      </div>
    );
  }

  const chartData = (snap?.hostHistory || []).map((pt) => ({
    time: new Date(pt.timestamp).toLocaleTimeString([], {
      hour12: false,
      minute: '2-digit',
      second: '2-digit',
    }),
    cpu: pt.cpuPercent,
    mem: pt.memPercent,
    rxKb: Math.round(pt.netRxBytesPerSec / 1024),
    txKb: Math.round(pt.netTxBytesPerSec / 1024),
  }));

  const onlineCount = procs.filter((p) => p.status === 'online').length;
  const erroredCount = procs.filter((p) => p.status === 'errored').length;
  const stoppedCount = procs.filter((p) => p.status === 'stopped').length;
  const topProcs = [...procs]
    .sort((a, b) => b.memory - a.memory || b.cpu - a.cpu)
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{t.overview.cpu}</span>
            <Cpu className="h-4 w-4 text-emerald-500" />
          </div>
          <div
            dir="ltr"
            className="mt-2 font-mono text-2xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            {host ? `${host.cpuPercent}%` : '—'}
          </div>
          <div dir="ltr" className="mt-1 text-[11px] text-zinc-500">
            {host
              ? `${host.cpuCores} ${t.overview.cores} • Load ${host.loadAvg.join(' / ')}`
              : '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{t.overview.memory}</span>
            <MemoryStick className="h-4 w-4 text-sky-500" />
          </div>
          <div
            dir="ltr"
            className="mt-2 font-mono text-2xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            {host ? `${host.memPercent}%` : '—'}
          </div>
          <div dir="ltr" className="mt-1 text-[11px] text-zinc-500">
            {host
              ? `${formatBytes(host.memUsedBytes)} / ${formatBytes(host.memTotalBytes)}`
              : '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{t.overview.disk}</span>
            <HardDrive className="h-4 w-4 text-amber-500" />
          </div>
          <div
            dir="ltr"
            className="mt-2 font-mono text-2xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            {host ? `${host.diskPercent}%` : '—'}
          </div>
          <div dir="ltr" className="mt-1 text-[11px] text-zinc-500">
            {host
              ? `${formatBytes(host.diskUsedBytes)} / ${formatBytes(host.diskTotalBytes)}`
              : '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{t.overview.network}</span>
            <Activity className="h-4 w-4 text-indigo-500" />
          </div>
          <div
            dir="ltr"
            className="mt-2 flex items-center gap-3 font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100"
          >
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              {host ? formatBytesPerSec(host.netRxBytesPerSec) : '—'}
            </span>
            <span className="inline-flex items-center gap-1 text-sky-500">
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              {host ? formatBytesPerSec(host.netTxBytesPerSec) : '—'}
            </span>
          </div>
          <div dir="ltr" className="mt-2 text-[11px] text-zinc-500">
            {t.overview.uptime}:{' '}
            {host ? formatDurationSeconds(host.uptimeSeconds) : '—'}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {t.overview.cpuMemChart}
          </h3>
          <div dir="ltr" className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(113,113,122,0.18)"
                />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#71717a' }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  unit="%"
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
                  type="monotone"
                  dataKey="cpu"
                  name="CPU %"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#cpuGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="mem"
                  name="RAM %"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#memGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {t.overview.netChart}
          </h3>
          <div dir="ltr" className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(113,113,122,0.18)"
                />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 10, fill: '#71717a' }} unit=" KB/s" />
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
                  type="monotone"
                  dataKey="rxKb"
                  name="RX (KB/s)"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#rxGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="txKb"
                  name="TX (KB/s)"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#txGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* PM2 Fleet Summary + Top Processes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {t.overview.pm2Summary}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950/70">
              <div className="text-[11px] text-zinc-500">
                {t.overview.totalApps}
              </div>
              <div className="mt-1 font-mono text-xl font-bold text-zinc-900 dark:text-zinc-100">
                {procs.length}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-3">
              <div className="text-[11px] text-emerald-600 dark:text-emerald-300">
                {t.overview.onlineApps}
              </div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {onlineCount}
              </div>
            </div>
            <div className="rounded-xl bg-rose-500/10 p-3">
              <div className="text-[11px] text-rose-600 dark:text-rose-300">
                {t.overview.erroredApps}
              </div>
              <div className="mt-1 font-mono text-xl font-bold text-rose-600 dark:text-rose-400">
                {erroredCount}
              </div>
            </div>
            <div className="rounded-xl bg-zinc-500/10 p-3">
              <div className="text-[11px] text-zinc-500">
                {t.overview.stoppedApps}
              </div>
              <div className="mt-1 font-mono text-xl font-bold text-zinc-600 dark:text-zinc-300">
                {stoppedCount}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/80 lg:col-span-2">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {t.overview.topProcesses}
          </h3>
          <div className="mt-3 space-y-2">
            {topProcs.map((p) => (
              <div
                key={`${p.pm_id}-${p.name}`}
                className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-2 text-xs dark:border-zinc-800/80 dark:bg-zinc-950/60"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    dir="ltr"
                    className="font-mono font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    {p.name}
                  </span>
                  <ProcessStatusBadge status={p.status} />
                </div>
                <div
                  dir="ltr"
                  className="flex items-center gap-4 font-mono text-[11px] text-zinc-600 dark:text-zinc-400"
                >
                  <span>CPU {p.cpu.toFixed(1)}%</span>
                  <span>RAM {formatBytes(p.memory)}</span>
                  <span>↺ {p.restarts}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
