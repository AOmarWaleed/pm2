import React, { useEffect, useMemo, useState } from 'react';
import { Clock, X } from 'lucide-react';
import {
  describeCron,
  getNextCronRuns,
  validateCronExpression,
} from '@shared/cronUtils';
import { CronJobItem, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

interface CronJobModalProps {
  open: boolean;
  server: ServerPublicConfig;
  editingJob?: CronJobItem | null;
  onSaved: (jobs: CronJobItem[]) => void;
  onClose: () => void;
}

const PRESETS: Array<{ label: string; expr: string }> = [
  { label: 'Every 1m', expr: '* * * * *' },
  { label: 'Every 5m', expr: '*/5 * * * *' },
  { label: 'Every 15m', expr: '*/15 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily 02:00', expr: '0 2 * * *' },
  { label: 'Weekly Sun', expr: '0 4 * * 0' },
];

export const CronJobModal: React.FC<CronJobModalProps> = ({
  open,
  server,
  editingJob,
  onSaved,
  onClose,
}) => {
  const { t } = useI18n();
  const { pushToast } = useApp();

  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('*/5 * * * *');
  const [command, setCommand] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [tracked, setTracked] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editingJob) {
      setName(editingJob.name);
      setSchedule(editingJob.schedule);
      setCommand(editingJob.command);
      setEnabled(editingJob.enabled);
      setTracked(editingJob.tracked);
    } else {
      setName('');
      setSchedule('*/5 * * * *');
      setCommand('');
      setEnabled(true);
      setTracked(true);
    }
  }, [open, editingJob]);

  const scheduleError = useMemo(
    () => validateCronExpression(schedule),
    [schedule],
  );
  const humanDesc = useMemo(
    () => (scheduleError ? '' : describeCron(schedule)),
    [schedule, scheduleError],
  );
  const nextRuns = useMemo(
    () => (scheduleError ? [] : getNextCronRuns(schedule, 3)),
    [schedule, scheduleError],
  );

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = editingJob
        ? await api.updateCron(server.id, editingJob.id, {
            name: name.trim(),
            schedule: schedule.trim(),
            command: command.trim(),
            enabled,
            tracked,
          })
        : await api.createCron(server.id, {
            name: name.trim(),
            schedule: schedule.trim(),
            command: command.trim(),
            enabled,
            tracked,
          });
      onSaved(res.jobs);
      pushToast({
        variant: 'success',
        title: editingJob ? 'Cron job updated' : 'Cron job created',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cron job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {editingJob ? t.crons.editJob : t.crons.newJob}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4 text-xs"
        >
          <div>
            <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              {t.crons.nameLabel}
            </label>
            <input
              dir="ltr"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="db-nightly-backup"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              {t.crons.scheduleLabel}
            </label>
            <input
              dir="ltr"
              required
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="*/5 * * * *"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <div dir="ltr" className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.expr}
                  type="button"
                  onClick={() => setSchedule(p.expr)}
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[10px] text-zinc-600 hover:border-emerald-500/40 hover:text-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {scheduleError ? (
              <p className="mt-1.5 text-[11px] text-rose-500">{scheduleError}</p>
            ) : (
              <div
                dir="ltr"
                className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px]"
              >
                <div className="font-semibold text-emerald-500">
                  {humanDesc}
                </div>
                {nextRuns.length > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-zinc-500">
                    Next:{' '}
                    {nextRuns
                      .map((ts) => new Date(ts).toLocaleString())
                      .join(' • ')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              {t.crons.commandLabel}
            </label>
            <textarea
              dir="ltr"
              required
              rows={3}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="node /home/deploy/app/scripts/sync.js --prod"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
            <label className="flex cursor-pointer items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>{t.crons.enabledLabel}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={tracked}
                onChange={(e) => setTracked(e.target.checked)}
              />
              <span>{t.crons.trackedLabel}</span>
            </label>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-500">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3.5 py-2 font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              {t.serverModal.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(scheduleError)}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {t.crons.saveJob}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
