import React, { useState } from 'react';
import {
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  Pencil,
  Plug,
  Plus,
  Search,
  Server as ServerIcon,
  Sparkles,
  Trash2,
  Unplug,
} from 'lucide-react';
import { EnvironmentTag, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { ConnectionDot, EnvBadge } from '../common/Badges';
import { ImportSshConfigModal } from './ImportSshConfigModal';
import { ServerModal } from './ServerModal';

export const FleetOverview: React.FC = () => {
  const { t } = useI18n();
  const {
    servers,
    telemetry,
    openServerTab,
    connectServer,
    disconnectServer,
    launchDemoServer,
    refreshServers,
    confirmDanger,
    pushToast,
  } = useApp();

  const [search, setSearch] = useState('');
  const [envFilter, setEnvFilter] = useState<'all' | EnvironmentTag>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerPublicConfig | null>(
    null,
  );
  const [showImportModal, setShowImportModal] = useState(false);

  const hasDemo = servers.some((s) => s.isDemo);

  const filtered = servers.filter((s) => {
    if (envFilter !== 'all' && s.environment !== envFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (srv: ServerPublicConfig) => {
    const ok = await confirmDanger({
      title: `Delete "${srv.name}"`,
      description: `Remove server "${srv.name}" (${srv.host}) from your encrypted vault?`,
      environment: srv.environment,
      requireExactMatch: srv.environment === 'production' ? srv.name : undefined,
      confirmLabel: t.fleet.delete,
    });
    if (!ok) return;
    await api.deleteServer(srv.id);
    await refreshServers();
    pushToast({ variant: 'info', title: `Removed ${srv.name}` });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t.fleet.title}
          </h1>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {t.fleet.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hasDemo && (
            <button
              onClick={() => void launchDemoServer()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-2 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-500/20 dark:text-indigo-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t.fleet.launchDemo}</span>
            </button>
          )}
          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t.fleet.importSsh}</span>
          </button>
          <button
            onClick={() => {
              setEditingServer(null);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t.fleet.addServer}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.fleet.searchPlaceholder}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pe-3 ps-9 text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'production', 'staging', 'development'] as const).map(
            (env) => (
              <button
                key={env}
                onClick={() => setEnvFilter(env)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  envFilter === env
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'
                }`}
              >
                {t.env[env]}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Server Grid or Empty State */}
      {filtered.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-10 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
            <ServerIcon className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t.fleet.emptyTitle}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t.fleet.emptyDesc}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {!hasDemo && (
              <button
                onClick={() => void launchDemoServer()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{t.fleet.launchDemo}</span>
              </button>
            )}
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.fleet.addServer}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((srv) => {
            const snap = telemetry[srv.id];
            const procs = snap?.processes || [];
            const onlineCount = procs.filter((p) => p.status === 'online').length;
            const erroredCount = procs.filter(
              (p) => p.status === 'errored',
            ).length;
            const isConnected = srv.connectionStatus === 'connected';

            return (
              <div
                key={srv.id}
                className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 dark:border-zinc-800/90 dark:bg-zinc-900/80 dark:hover:border-zinc-700"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ConnectionDot status={srv.connectionStatus} />
                        <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {srv.name}
                        </h3>
                      </div>
                      <p
                        dir="ltr"
                        className="mt-1 truncate font-mono text-[11px] text-zinc-500"
                      >
                        {srv.username}@{srv.host}:{srv.port}
                      </p>
                    </div>
                    <EnvBadge env={srv.environment} />
                  </div>

                  {/* Mini Telemetry Bar */}
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50 p-2.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950/70">
                    <div>
                      <span className="flex items-center gap-1 text-zinc-500">
                        <Cpu className="h-3 w-3" /> CPU
                      </span>
                      <span
                        dir="ltr"
                        className="mt-0.5 block font-mono font-semibold text-zinc-900 dark:text-zinc-100"
                      >
                        {snap?.host ? `${snap.host.cpuPercent}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="flex items-center gap-1 text-zinc-500">
                        <HardDrive className="h-3 w-3" /> RAM
                      </span>
                      <span
                        dir="ltr"
                        className="mt-0.5 block font-mono font-semibold text-zinc-900 dark:text-zinc-100"
                      >
                        {snap?.host ? `${snap.host.memPercent}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">PM2</span>
                      <span
                        dir="ltr"
                        className="mt-0.5 block font-mono font-semibold"
                      >
                        {isConnected ? (
                          <>
                            <span className="text-emerald-500">
                              {onlineCount}
                            </span>
                            {erroredCount > 0 && (
                              <span className="text-rose-500">
                                /{erroredCount} err
                              </span>
                            )}
                            <span className="text-zinc-500">
                              /{procs.length}
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {srv.lastError && srv.connectionStatus === 'error' && (
                    <p
                      dir="ltr"
                      className="mt-2 truncate rounded-lg bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-500"
                      title={srv.lastError}
                    >
                      {srv.lastError}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/80">
                  <div className="flex items-center gap-1.5">
                    {isConnected ? (
                      <button
                        onClick={() => void disconnectServer(srv.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <Unplug className="h-3 w-3" />
                        <span>{t.fleet.disconnect}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => void connectServer(srv.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300"
                      >
                        <Plug className="h-3 w-3" />
                        <span>{t.fleet.connect}</span>
                      </button>
                    )}

                    <button
                      onClick={() => openServerTab(srv.id, 'processes')}
                      className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{t.fleet.openWorkspace}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingServer(srv);
                        setShowAddModal(true);
                      }}
                      title={t.fleet.edit}
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void handleDelete(srv)}
                      title={t.fleet.delete}
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ServerModal
        open={showAddModal}
        editingServer={editingServer}
        onClose={() => setShowAddModal(false)}
      />
      <ImportSshConfigModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
      />
    </div>
  );
};
