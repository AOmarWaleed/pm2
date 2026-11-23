import React, { useState } from 'react';
import {
  Check,
  Eraser,
  Eye,
  Layers,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { Pm2Action, Pm2Process, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { formatBytes, formatUptimeSince } from '@/utils/format';
import { ProcessStatusBadge } from '../common/Badges';
import { ProcessInspectorDrawer } from './ProcessInspectorDrawer';
import { ScaleModal } from './ScaleModal';
import { StartAppModal } from './StartAppModal';

export const Pm2ProcessTable: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const {
    telemetry,
    connectServer,
    confirmDanger,
    pushToast,
    jumpToLogs,
  } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedNames, setSelectedNames] = useState<Record<string, boolean>>(
    {},
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [inspectTarget, setInspectTarget] = useState<string | null>(null);
  const [scaleTarget, setScaleTarget] = useState<Pm2Process | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);

  const snap = telemetry[server.id];
  const processes = snap?.processes || [];
  const isConnected = server.connectionStatus === 'connected';

  const filtered = processes.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.script.toLowerCase().includes(q) ||
      p.cwd.toLowerCase().includes(q)
    );
  });

  const selectedList = filtered
    .filter((p) => selectedNames[p.name])
    .map((p) => p.name);

  const inspectedProcess =
    processes.find((p) => p.name === inspectTarget) || null;

  const runAction = async (target: string, action: Pm2Action) => {
    const isDestructive =
      action === 'delete' ||
      action === 'flush' ||
      (action === 'stop' && server.environment === 'production');

    if (isDestructive) {
      const ok = await confirmDanger({
        title: `PM2 ${action.toUpperCase()} "${target}"`,
        description: `Execute "pm2 ${action} ${target}" on ${server.name} (${server.environment})?`,
        environment: server.environment,
        requireExactMatch:
          server.environment === 'production' && action === 'delete'
            ? target
            : undefined,
        confirmLabel: `Run ${action}`,
      });
      if (!ok) return;
    }

    setBusyKey(`${target}:${action}`);
    try {
      const res = await api.pm2Action(server.id, { target, action });
      pushToast({
        variant: 'success',
        title: `pm2 ${action} ${target}`,
        message: res.output,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: `PM2 ${action} failed`,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const runBulkAction = async (action: Pm2Action) => {
    if (selectedList.length === 0) return;
    if (action === 'delete' || action === 'stop' || action === 'flush') {
      const ok = await confirmDanger({
        title: `Bulk PM2 ${action}`,
        description: `Run "${action}" on ${selectedList.length} processes (${selectedList.join(', ')}) on ${server.name}?`,
        environment: server.environment,
        requireExactMatch:
          server.environment === 'production' && action === 'delete'
            ? server.name
            : undefined,
      });
      if (!ok) return;
    }

    setBusyKey(`bulk:${action}`);
    try {
      await api.pm2Action(server.id, { targets: selectedList, action });
      pushToast({
        variant: 'success',
        title: `Bulk ${action} applied to ${selectedList.length} apps`,
      });
      setSelectedNames({});
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Bulk action failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveDump = async () => {
    setBusyKey('save');
    try {
      const res = await api.pm2Save(server.id);
      pushToast({
        variant: 'success',
        title: 'pm2 save completed',
        message: res.output,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'pm2 save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleResurrect = async () => {
    setBusyKey('resurrect');
    try {
      const res = await api.pm2Resurrect(server.id);
      pushToast({
        variant: 'success',
        title: 'pm2 resurrect completed',
        message: res.output,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'pm2 resurrect failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyKey(null);
    }
  };

  const toggleAll = () => {
    if (selectedList.length === filtered.length) {
      setSelectedNames({});
    } else {
      const next: Record<string, boolean> = {};
      for (const p of filtered) next[p.name] = true;
      setSelectedNames(next);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      {/* Toolbar */}
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {t.pm2.title}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={!isConnected || busyKey !== null}
            onClick={() => void runAction('all', 'reload')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <RefreshCw className="h-3.5 w-3.5 text-emerald-500" />
            <span>{t.pm2.reloadAll}</span>
          </button>
          <button
            disabled={!isConnected || busyKey !== null}
            onClick={() => void handleSaveDump()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <Save className="h-3.5 w-3.5 text-sky-500" />
            <span>{t.pm2.saveDump}</span>
          </button>
          <button
            disabled={!isConnected || busyKey !== null}
            onClick={() => void handleResurrect()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
            <span>{t.pm2.resurrectDump}</span>
          </button>
          <button
            disabled={!isConnected}
            onClick={() => setShowStartModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t.pm2.startApp}</span>
          </button>
        </div>
      </div>

      {/* Filters & Bulk Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.pm2.searchPlaceholder}
              className="w-full rounded-xl border border-zinc-200 bg-white py-2 pe-3 ps-9 text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="all">{t.pm2.allStatuses}</option>
            <option value="online">{t.status.online}</option>
            <option value="errored">{t.status.errored}</option>
            <option value="stopped">{t.status.stopped}</option>
          </select>
        </div>

        {selectedList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs">
            <span className="font-semibold text-emerald-600 dark:text-emerald-300">
              {selectedList.length} {t.pm2.bulkSelected}
            </span>
            <button
              onClick={() => void runBulkAction('reload')}
              className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-800 shadow-xs dark:bg-zinc-900 dark:text-zinc-200"
            >
              Reload
            </button>
            <button
              onClick={() => void runBulkAction('restart')}
              className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-800 shadow-xs dark:bg-zinc-900 dark:text-zinc-200"
            >
              Restart
            </button>
            <button
              onClick={() => void runBulkAction('stop')}
              className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-amber-600 shadow-xs dark:bg-zinc-900 dark:text-amber-300"
            >
              Stop
            </button>
            <button
              onClick={() => void runBulkAction('delete')}
              className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {!isConnected && processes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/70 p-10 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs text-zinc-500">{t.overview.disconnectedHint}</p>
          <button
            onClick={() => void connectServer(server.id)}
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            {t.fleet.connect}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800/90 dark:bg-zinc-900/80">
          <table className="w-full text-start text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/60">
              <tr className="whitespace-nowrap">
                <th className="w-8 px-2.5 py-2.5">
                  <button
                    onClick={toggleAll}
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      filtered.length > 0 &&
                      selectedList.length === filtered.length
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-zinc-400 dark:border-zinc-600'
                    }`}
                  >
                    {filtered.length > 0 &&
                      selectedList.length === filtered.length && (
                        <Check className="h-3 w-3" />
                      )}
                  </button>
                </th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.id}</th>
                <th className="px-2.5 py-2.5 text-start">{t.pm2.cols.name}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.status}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.mode}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.pid}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.cpu}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.memory}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.uptime}</th>
                <th className="px-2 py-2.5 text-start">{t.pm2.cols.restarts}</th>
                <th className="px-2.5 py-2.5 text-end">{t.pm2.cols.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {filtered.map((p) => {
                const isSelected = Boolean(selectedNames[p.name]);
                return (
                  <tr
                    key={`${p.pm_id}-${p.name}`}
                    className="transition hover:bg-zinc-50/90 dark:hover:bg-zinc-950/50"
                  >
                    <td className="px-2.5 py-2.5">
                      <button
                        onClick={() =>
                          setSelectedNames((prev) => ({
                            ...prev,
                            [p.name]: !prev[p.name],
                          }))
                        }
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-zinc-400 dark:border-zinc-600'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </button>
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono text-zinc-500">
                      {p.pm_id}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <button
                        onClick={() => setInspectTarget(p.name)}
                        dir="ltr"
                        className="whitespace-nowrap text-start font-mono font-semibold text-zinc-900 hover:text-emerald-500 dark:text-zinc-100"
                      >
                        {p.name}
                      </button>
                      <div
                        dir="ltr"
                        className="max-w-[155px] truncate font-mono text-[10px] text-zinc-500"
                      >
                        {p.script}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5">
                      <ProcessStatusBadge status={p.status} />
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono text-[11px]">
                      <span className="inline-block whitespace-nowrap rounded bg-zinc-500/10 px-1.5 py-0.5 text-zinc-600 dark:text-zinc-300">
                        {p.execMode.replace('_mode', '')} ({p.instances})
                      </span>
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono text-zinc-500">
                      {p.pid || '—'}
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono">
                      <span
                        className={
                          p.cpu > 80 ? 'font-semibold text-rose-500' : ''
                        }
                      >
                        {p.cpu.toFixed(1)}%
                      </span>
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono">
                      {formatBytes(p.memory)}
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono text-zinc-500">
                      {formatUptimeSince(p.uptime)}
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-2 py-2.5 font-mono">
                      <span
                        className={
                          p.restarts > 5 ? 'text-amber-500' : 'text-zinc-500'
                        }
                      >
                        {p.restarts}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {p.status === 'online' ? (
                          <>
                            <button
                              onClick={() => void runAction(p.name, 'reload')}
                              title={t.pm2.actions.reload}
                              className="rounded-lg p-1 text-emerald-500 hover:bg-emerald-500/10"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => void runAction(p.name, 'restart')}
                              title={t.pm2.actions.restart}
                              className="rounded-lg p-1 text-sky-500 hover:bg-sky-500/10"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => void runAction(p.name, 'stop')}
                              title={t.pm2.actions.stop}
                              className="rounded-lg p-1 text-amber-500 hover:bg-amber-500/10"
                            >
                              <Square className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => void runAction(p.name, 'start')}
                            title={t.pm2.actions.start}
                            className="rounded-lg p-1 text-emerald-500 hover:bg-emerald-500/10"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setScaleTarget(p)}
                          title={t.pm2.actions.scale}
                          className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Layers className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => jumpToLogs(server.id, p.name)}
                          title={t.pm2.actions.logs}
                          className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setInspectTarget(p.name)}
                          title={t.pm2.actions.inspect}
                          className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void runAction(p.name, 'flush')}
                          title={t.pm2.actions.flush}
                          className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Eraser className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void runAction(p.name, 'delete')}
                          title={t.pm2.actions.delete}
                          className="rounded-lg p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProcessInspectorDrawer
        process={inspectedProcess}
        server={server}
        onClose={() => setInspectTarget(null)}
      />
      <ScaleModal
        process={scaleTarget}
        server={server}
        onClose={() => setScaleTarget(null)}
      />
      <StartAppModal
        open={showStartModal}
        server={server}
        onClose={() => setShowStartModal(false)}
      />
    </div>
  );
};
