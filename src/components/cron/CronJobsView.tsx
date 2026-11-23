import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  CronJobItem,
  CronJobSource,
  CronRunRecord,
  ServerPublicConfig,
} from '@shared/types';
import { api } from '@/api/client';
import { wsClient } from '@/api/wsClient';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { formatTimeAgo } from '@/utils/format';
import { CronJobModal } from './CronJobModal';

function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${m}m ${rem}s`;
}

function getJobEffectiveStatus(
  job: CronJobItem,
  liveRunStartedAt?: number,
): 'running' | 'failed' | 'success' | 'paused' | 'untracked' | 'scheduled' {
  if (job.activeRun || liveRunStartedAt) return 'running';
  if (!job.enabled) return 'paused';
  if (job.lastRun?.status === 'failed') return 'failed';
  if (job.lastRun?.status === 'success') return 'success';
  if (!job.tracked) return 'untracked';
  return 'scheduled';
}

export const CronJobsView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { connectServer, confirmDanger, pushToast, jumpToLogSource } = useApp();

  const [jobs, setJobs] = useState<CronJobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | CronJobSource>(
    'all',
  );
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJobItem | null>(null);

  // Live manual run state
  const [runningJobs, setRunningJobs] = useState<
    Record<string, { runId: string; startedAt: number; output: string }>
  >({});
  const [selectedRun, setSelectedRun] = useState<CronRunRecord | null>(null);
  const [runLogContent, setRunLogContent] = useState('');
  const [loadingRunLog, setLoadingRunLog] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const loadJobs = useCallback(async () => {
    if (server.connectionStatus !== 'connected') return;
    setLoading(true);
    try {
      const res = await api.listCrons(server.id);
      setJobs(res.jobs);
      setSelectedJobId((prev) =>
        prev && res.jobs.some((j) => j.id === prev)
          ? prev
          : res.jobs[0]?.id || null,
      );
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Failed to load cron jobs',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [server.id, server.connectionStatus, pushToast]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Tick every 1s whenever any job is running so elapsed timer updates live
  const hasRunning =
    Object.keys(runningJobs).length > 0 || jobs.some((j) => j.activeRun);

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  // Listen for live manual debug run WS messages
  useEffect(() => {
    return wsClient.subscribe((msg) => {
      if (msg.type === 'cron:output') {
        setRunningJobs((prev) => {
          const entry = Object.entries(prev).find(
            ([, v]) => v.runId === msg.runId,
          );
          if (!entry) return prev;
          const [jobId, info] = entry;
          return {
            ...prev,
            [jobId]: { ...info, output: info.output + msg.chunk },
          };
        });
      } else if (msg.type === 'cron:done') {
        const rec = msg.record;
        setRunningJobs((prev) => {
          const next = { ...prev };
          delete next[rec.jobId];
          return next;
        });
        setJobs((prev) =>
          prev.map((j) =>
            j.id === rec.jobId
              ? {
                  ...j,
                  activeRun: undefined,
                  lastRun: rec,
                  recentRuns: [rec, ...j.recentRuns].slice(0, 20),
                }
              : j,
          ),
        );
        setSelectedRun(rec);
        setRunLogContent(rec.outputPreview || '');
        pushToast({
          variant: rec.status === 'success' ? 'success' : 'error',
          title: `Cron "${rec.jobName}" ${rec.status}`,
          message: `Exit ${rec.exitCode ?? '?'} in ${formatDurationMs(rec.durationMs)}`,
        });
      }
    });
  }, [pushToast]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (sourceFilter !== 'all' && j.source !== sourceFilter) return false;
      const eff = getJobEffectiveStatus(j, runningJobs[j.id]?.startedAt);
      if (statusFilter !== 'all' && eff !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        j.name.toLowerCase().includes(q) ||
        j.command.toLowerCase().includes(q) ||
        j.schedule.toLowerCase().includes(q)
      );
    });
  }, [jobs, sourceFilter, statusFilter, search, runningJobs]);

  const selectedJob = useMemo(
    () =>
      jobs.find((j) => j.id === selectedJobId) || filteredJobs[0] || null,
    [jobs, selectedJobId, filteredJobs],
  );

  useEffect(() => {
    if (!selectedJob) {
      setSelectedRun(null);
      setRunLogContent('');
      return;
    }
    const firstRun = selectedJob.recentRuns[0] || null;
    setSelectedRun(firstRun);
    if (firstRun?.logFile) {
      setLoadingRunLog(true);
      api
        .readCronRunLog(server.id, firstRun.logFile)
        .then((res) => setRunLogContent(res.content))
        .catch(() => setRunLogContent(firstRun.outputPreview || ''))
        .finally(() => setLoadingRunLog(false));
    } else {
      setRunLogContent(firstRun?.outputPreview || '');
    }
  }, [selectedJob?.id, server.id]);

  const handleInspectRun = async (run: CronRunRecord) => {
    setSelectedRun(run);
    if (run.logFile) {
      setLoadingRunLog(true);
      try {
        const res = await api.readCronRunLog(server.id, run.logFile);
        setRunLogContent(res.content);
      } catch {
        setRunLogContent(run.outputPreview || '');
      } finally {
        setLoadingRunLog(false);
      }
    } else {
      setRunLogContent(run.outputPreview || '');
    }
  };

  const handleRunNow = (job: CronJobItem) => {
    const runId = `cron-dbg-${Date.now()}`;
    setRunningJobs((prev) => ({
      ...prev,
      [job.id]: { runId, startedAt: Date.now(), output: '' },
    }));
    wsClient.send({
      type: 'cron:run',
      runId,
      serverId: server.id,
      jobId: job.id,
    });
  };

  const handleCancelRun = (jobId: string) => {
    const info = runningJobs[jobId];
    if (!info) return;
    wsClient.send({ type: 'cron:cancel', runId: info.runId });
  };

  const handleToggleEnabled = async (job: CronJobItem) => {
    try {
      const res = await api.toggleCronEnabled(
        server.id,
        job.id,
        !job.enabled,
      );
      setJobs(res.jobs);
      pushToast({
        variant: 'info',
        title: !job.enabled ? `Resumed ${job.name}` : `Paused ${job.name}`,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Toggle failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleToggleTracking = async (job: CronJobItem) => {
    try {
      const res = await api.toggleCronTracking(
        server.id,
        job.id,
        !job.tracked,
      );
      setJobs(res.jobs);
      pushToast({
        variant: 'success',
        title: !job.tracked
          ? `Enabled precise tracking for ${job.name}`
          : `Disabled tracking for ${job.name}`,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Tracking toggle failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDelete = async (job: CronJobItem) => {
    const ok = await confirmDanger({
      title: `Delete Cron "${job.name}"`,
      description: `Remove cron job "${job.name}" (${job.schedule}) from ${server.name}?`,
      environment: server.environment,
      requireExactMatch:
        server.environment === 'production' ? job.name : undefined,
      confirmLabel: t.fleet.delete,
    });
    if (!ok) return;
    try {
      const res = await api.deleteCron(server.id, job.id);
      setJobs(res.jobs);
      pushToast({ variant: 'info', title: `Deleted ${job.name}` });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (server.connectionStatus !== 'connected') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <Clock className="h-8 w-8 text-zinc-400" />
        <p className="mt-3 text-xs text-zinc-500">
          {t.overview.disconnectedHint}
        </p>
        <button
          onClick={() => void connectServer(server.id)}
          className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          {t.fleet.connect}
        </button>
      </div>
    );
  }

  const totalCount = jobs.length;
  const runningCount = jobs.filter(
    (j) => j.activeRun || runningJobs[j.id],
  ).length;
  const failedCount = jobs.filter((j) => j.lastRun?.status === 'failed').length;
  const successCount = jobs.filter(
    (j) => j.lastRun?.status === 'success',
  ).length;
  const trackedCount = jobs.filter((j) => j.tracked).length;

  const activeLive = selectedJob ? runningJobs[selectedJob.id] : undefined;
  const activeElapsed = activeLive
    ? nowTick - activeLive.startedAt
    : selectedJob?.activeRun
      ? nowTick - selectedJob.activeRun.startedAt
      : null;

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-4 p-4 sm:p-6 lg:h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {t.crons.title}
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">{t.crons.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadJobs()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            <span>{t.crons.refresh}</span>
          </button>
          <button
            onClick={() => {
              setEditingJob(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t.crons.newJob}</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="text-[11px] text-zinc-500">{t.crons.totalJobs}</div>
          <div className="mt-0.5 font-mono text-lg font-bold">{totalCount}</div>
        </div>
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5">
          <div className="text-[11px] text-sky-600 dark:text-sky-300">
            {t.crons.runningNow}
          </div>
          <div className="mt-0.5 font-mono text-lg font-bold text-sky-500">
            {runningCount}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5">
          <div className="text-[11px] text-emerald-600 dark:text-emerald-300">
            {t.crons.lastSuccess}
          </div>
          <div className="mt-0.5 font-mono text-lg font-bold text-emerald-500">
            {successCount}
          </div>
        </div>
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5">
          <div className="text-[11px] text-rose-600 dark:text-rose-300">
            {t.crons.lastFailed}
          </div>
          <div className="mt-0.5 font-mono text-lg font-bold text-rose-500">
            {failedCount}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="text-[11px] text-zinc-500">
            {t.crons.trackedCount}
          </div>
          <div className="mt-0.5 font-mono text-lg font-bold">
            {trackedCount}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.crons.searchPlaceholder}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pe-3 ps-9 text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) =>
            setSourceFilter(e.target.value as 'all' | CronJobSource)
          }
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="all">{t.crons.allSources}</option>
          <option value="user-crontab">{t.crons.userCrontab}</option>
          <option value="system-cron">{t.crons.systemCron}</option>
          <option value="systemd-timer">{t.crons.systemdTimer}</option>
          <option value="pm2-cron">{t.crons.pm2Cron}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="all">{t.crons.allStatuses}</option>
          <option value="running">{t.crons.running}</option>
          <option value="failed">{t.crons.failed}</option>
          <option value="success">{t.crons.success}</option>
          <option value="untracked">{t.crons.untracked}</option>
          <option value="scheduled">{t.crons.scheduled}</option>
          <option value="paused">{t.crons.paused}</option>
        </select>
      </div>

      {/* Master-Detail Split */}
      <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-12">
        {/* Left Jobs List */}
        <div className="max-h-72 space-y-2 overflow-y-auto pe-1 lg:col-span-5 lg:max-h-none">
          {filteredJobs.map((job) => {
            const eff = getJobEffectiveStatus(
              job,
              runningJobs[job.id]?.startedAt,
            );
            const active = selectedJob?.id === job.id;
            const statusStyle =
              eff === 'running'
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-500'
                : eff === 'failed'
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-500'
                  : eff === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
                    : eff === 'paused' || eff === 'scheduled'
                      ? 'border-zinc-500/40 bg-zinc-500/15 text-zinc-400'
                      : 'border-amber-500/40 bg-amber-500/15 text-amber-500';

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className={`cursor-pointer rounded-2xl border p-3.5 transition ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/5 shadow-sm dark:bg-zinc-900'
                    : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800/90 dark:bg-zinc-900/60 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        dir="ltr"
                        className="truncate font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100"
                      >
                        {job.name}
                      </span>
                      <span
                        dir="ltr"
                        className="rounded bg-zinc-500/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                      >
                        {job.source}
                      </span>
                    </div>
                    <div
                      dir="ltr"
                      className="mt-1 font-mono text-[11px] text-emerald-600 dark:text-emerald-400"
                    >
                      {job.schedule}{' '}
                      <span className="font-sans text-zinc-500">
                        • {job.scheduleHuman}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle}`}
                  >
                    {eff === 'running' && (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    )}
                    {t.crons[eff]}
                  </span>
                </div>

                {/* Health Sparkline + Last Run Meta */}
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div dir="ltr" className="flex items-center gap-1">
                    {job.recentRuns.slice(0, 8).map((r) => (
                      <span
                        key={r.runId}
                        title={`${r.status} • ${formatDurationMs(r.durationMs)}`}
                        className={`h-3 w-1.5 rounded-sm ${
                          r.status === 'success'
                            ? 'bg-emerald-500'
                            : r.status === 'failed'
                              ? 'bg-rose-500'
                              : 'bg-zinc-500'
                        }`}
                      />
                    ))}
                    {job.recentRuns.length === 0 && (
                      <span className="text-[10px] text-zinc-500">
                        No tracked history
                      </span>
                    )}
                  </div>
                  <span
                    dir="ltr"
                    className="font-mono text-[10px] text-zinc-500"
                  >
                    {job.lastRun
                      ? `${formatTimeAgo(job.lastRun.startedAt)} • ${formatDurationMs(job.lastRun.durationMs)}`
                      : job.nextRuns[0]
                        ? `Next ${new Date(job.nextRuns[0]).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}`
                        : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Debugger Panel */}
        <div className="flex min-h-[420px] flex-col overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80 lg:col-span-7">
          {!selectedJob ? (
            <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
              Select a cron job to inspect runs and debug execution.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Top Action Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2
                      dir="ltr"
                      className="font-mono text-base font-bold text-zinc-900 dark:text-zinc-100"
                    >
                      {selectedJob.name}
                    </h2>
                    <span
                      dir="ltr"
                      className="rounded bg-zinc-500/15 px-2 py-0.5 font-mono text-[10px] text-zinc-500"
                    >
                      {selectedJob.sourceFile}
                    </span>
                  </div>
                  <p dir="ltr" className="mt-1 font-mono text-[11px] text-zinc-500">
                    {selectedJob.schedule} ({selectedJob.scheduleHuman})
                    {selectedJob.user ? ` • user=${selectedJob.user}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {activeLive ? (
                    <button
                      onClick={() => handleCancelRun(selectedJob.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-500"
                    >
                      <Square className="h-3.5 w-3.5" />
                      <span>
                        {t.crons.cancelRun} ({formatDurationMs(activeElapsed)})
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRunNow(selectedJob)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{t.crons.runNow}</span>
                    </button>
                  )}

                  {selectedJob.editable && (
                    <>
                      <button
                        onClick={() => void handleToggleTracking(selectedJob)}
                        className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 font-medium ${
                          selectedJob.tracked
                            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-500'
                            : 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {selectedJob.tracked ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {selectedJob.tracked
                            ? t.crons.disableTracking
                            : t.crons.enableTracking}
                        </span>
                      </button>
                      <button
                        onClick={() => void handleToggleEnabled(selectedJob)}
                        className="inline-flex items-center gap-1 rounded-xl border border-zinc-300 px-2.5 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {selectedJob.enabled ? (
                          <>
                            <Pause className="h-3.5 w-3.5 text-amber-500" />
                            <span>{t.crons.pause}</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 text-emerald-500" />
                            <span>{t.crons.resume}</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setEditingJob(selectedJob);
                          setShowModal(true);
                        }}
                        className="rounded-xl border border-zinc-300 p-1.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => void handleDelete(selectedJob)}
                        className="rounded-xl border border-zinc-300 p-1.5 text-zinc-500 hover:border-rose-500/40 hover:text-rose-500 dark:border-zinc-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Advisory Banners */}
              {!selectedJob.editable && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                  {t.crons.readOnlyHint}
                </div>
              )}
              {selectedJob.editable && !selectedJob.tracked && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <span className="flex-1">{t.crons.untrackedHint}</span>
                  <button
                    onClick={() => void handleToggleTracking(selectedJob)}
                    className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 font-semibold text-zinc-950 hover:bg-amber-400"
                  >
                    {t.crons.enableTracking}
                  </button>
                </div>
              )}

              {/* Command + Next Runs */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center gap-1 font-semibold text-zinc-600 dark:text-zinc-400">
                    <Terminal className="h-3.5 w-3.5" />
                    <span>{t.crons.command}</span>
                  </div>
                  <pre
                    dir="ltr"
                    className="overflow-x-auto rounded-xl bg-zinc-950 p-2.5 font-mono text-[11px] text-emerald-300"
                  >
                    {selectedJob.command}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1 font-semibold text-zinc-600 dark:text-zinc-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{t.crons.nextRuns}</span>
                  </div>
                  <div
                    dir="ltr"
                    className="space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                  >
                    {selectedJob.nextRuns.length === 0
                      ? '—'
                      : selectedJob.nextRuns.map((ts, i) => (
                          <div key={i}>{new Date(ts).toLocaleString()}</div>
                        ))}
                  </div>
                </div>
              </div>

              {/* Live Debug Output (while running) */}
              {activeLive && (
                <div className="rounded-xl border border-sky-500/40 bg-zinc-950 p-3">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-sky-400">
                    <span className="flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 animate-pulse" />
                      Live Debug Execution...
                    </span>
                    <span dir="ltr" className="font-mono">
                      {formatDurationMs(activeElapsed)}
                    </span>
                  </div>
                  <pre
                    dir="ltr"
                    className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-200"
                  >
                    {activeLive.output || 'Starting...'}
                  </pre>
                </div>
              )}

              {/* Execution History Table */}
              <div>
                <h3 className="mb-2 font-semibold text-zinc-800 dark:text-zinc-200">
                  {t.crons.executionHistory} ({selectedJob.recentRuns.length})
                </h3>
                {selectedJob.recentRuns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-300 py-6 text-center text-zinc-500 dark:border-zinc-800">
                    {t.crons.noRuns}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-start text-[11px]">
                      <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                        <tr>
                          <th className="px-3 py-2 text-start">
                            {t.crons.status}
                          </th>
                          <th className="px-3 py-2 text-start">
                            {t.crons.startedAt}
                          </th>
                          <th className="px-3 py-2 text-start">
                            {t.crons.endedAt}
                          </th>
                          <th className="px-3 py-2 text-start">
                            {t.crons.duration}
                          </th>
                          <th className="px-3 py-2 text-start">
                            {t.crons.exitCode}
                          </th>
                          <th className="px-3 py-2 text-start">
                            {t.crons.trigger}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {selectedJob.recentRuns.map((run) => {
                          const isSel = selectedRun?.runId === run.runId;
                          return (
                            <tr
                              key={run.runId}
                              onClick={() => void handleInspectRun(run)}
                              className={`cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-950/60 ${
                                isSel ? 'bg-emerald-500/10' : ''
                              }`}
                            >
                              <td className="whitespace-nowrap px-3 py-2">
                                {run.status === 'success' ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    SUCCESS
                                  </span>
                                ) : run.status === 'failed' ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-rose-500">
                                    <XCircle className="h-3.5 w-3.5" />
                                    FAILED
                                  </span>
                                ) : (
                                  <span className="text-amber-500">
                                    START ONLY
                                  </span>
                                )}
                              </td>
                              <td
                                dir="ltr"
                                className="whitespace-nowrap px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300"
                              >
                                {new Date(run.startedAt).toLocaleString()}
                              </td>
                              <td
                                dir="ltr"
                                className="whitespace-nowrap px-3 py-2 font-mono text-zinc-500"
                              >
                                {run.finishedAt
                                  ? new Date(run.finishedAt).toLocaleTimeString(
                                      [],
                                      { hour12: false },
                                    )
                                  : '—'}
                              </td>
                              <td
                                dir="ltr"
                                className="whitespace-nowrap px-3 py-2 font-mono"
                              >
                                {formatDurationMs(run.durationMs)}
                              </td>
                              <td
                                dir="ltr"
                                className="whitespace-nowrap px-3 py-2 font-mono"
                              >
                                {run.exitCode !== null ? (
                                  <span
                                    className={`rounded px-1.5 py-0.5 ${
                                      run.exitCode === 0
                                        ? 'bg-emerald-500/15 text-emerald-500'
                                        : 'bg-rose-500/15 text-rose-500'
                                    }`}
                                  >
                                    {run.exitCode}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td
                                dir="ltr"
                                className="whitespace-nowrap px-3 py-2 font-mono text-zinc-500"
                              >
                                {run.trigger}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Selected Run Output Viewer */}
              {selectedRun && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
                    <span className="text-[11px] font-semibold text-zinc-300">
                      {t.crons.runOutput} ({selectedRun.runId})
                    </span>
                    {selectedRun.logFile && (
                      <button
                        onClick={() =>
                          jumpToLogSource(server.id, {
                            sourceType: 'cron',
                            target: selectedRun.logFile!,
                            label: `${selectedJob.name} (${selectedRun.status})`,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-zinc-700"
                      >
                        <ScrollText className="h-3 w-3" />
                        <span>{t.crons.openInLogs}</span>
                      </button>
                    )}
                  </div>
                  {loadingRunLog ? (
                    <div className="py-6 text-center text-zinc-500">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <pre
                      dir="ltr"
                      className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-200"
                    >
                      {runLogContent || '(no output captured)'}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CronJobModal
        open={showModal}
        server={server}
        editingJob={editingJob}
        onSaved={(updated) => setJobs(updated)}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
};
