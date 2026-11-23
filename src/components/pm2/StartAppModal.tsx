import React, { useState } from 'react';
import { Play, X } from 'lucide-react';
import { ServerPublicConfig, StartNewAppInput } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

interface StartAppModalProps {
  open: boolean;
  server: ServerPublicConfig;
  onClose: () => void;
}

export const StartAppModal: React.FC<StartAppModalProps> = ({
  open,
  server,
  onClose,
}) => {
  const { t } = useI18n();
  const { pushToast } = useApp();

  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [cwd, setCwd] = useState(server.defaultCwd || '/home/deploy/app');
  const [execMode, setExecMode] = useState<'fork' | 'cluster'>('fork');
  const [instances, setInstances] = useState('2');
  const [interpreter, setInterpreter] = useState('node');
  const [args, setArgs] = useState('');
  const [maxMemoryRestart, setMaxMemoryRestart] = useState('512M');
  const [watch, setWatch] = useState(false);
  const [envText, setEnvText] = useState('NODE_ENV=production');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const env: Record<string, string> = {};
    for (const line of envText.split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k) env[k] = v;
      }
    }

    const payload: StartNewAppInput = {
      name: name.trim(),
      script: script.trim(),
      cwd: cwd.trim() || undefined,
      execMode,
      instances:
        execMode === 'cluster'
          ? instances.trim() === 'max'
            ? 'max'
            : Number.parseInt(instances, 10) || 2
          : 1,
      interpreter: interpreter.trim() || undefined,
      args: args.trim() || undefined,
      maxMemoryRestart: maxMemoryRestart.trim() || undefined,
      watch,
      env,
    };

    try {
      const res = await api.pm2StartApp(server.id, payload);
      pushToast({
        variant: 'success',
        title: `Started ${name}`,
        message: res.output,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start app');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t.pm2.startModal.title}
          </h3>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.pm2.startModal.name}
              </label>
              <input
                dir="ltr"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="payments-api"
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.pm2.startModal.script}
              </label>
              <input
                dir="ltr"
                required
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="dist/server.js"
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              {t.pm2.startModal.cwd}
            </label>
            <input
              dir="ltr"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.pm2.startModal.execMode}
              </label>
              <select
                value={execMode}
                onChange={(e) =>
                  setExecMode(e.target.value as 'fork' | 'cluster')
                }
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="fork">{t.pm2.startModal.fork}</option>
                <option value="cluster">{t.pm2.startModal.cluster}</option>
              </select>
            </div>
            {execMode === 'cluster' && (
              <div>
                <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                  {t.pm2.startModal.instances}
                </label>
                <input
                  dir="ltr"
                  value={instances}
                  onChange={(e) => setInstances(e.target.value)}
                  placeholder="max or 2"
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.pm2.startModal.interpreter}
              </label>
              <input
                dir="ltr"
                value={interpreter}
                onChange={(e) => setInterpreter(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.pm2.startModal.maxMem}
              </label>
              <input
                dir="ltr"
                value={maxMemoryRestart}
                onChange={(e) => setMaxMemoryRestart(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                {t.pm2.startModal.args}
              </label>
              <input
                dir="ltr"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--port 4000"
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={watch}
              onChange={(e) => setWatch(e.target.checked)}
              className="rounded border-zinc-400"
            />
            <span>{t.pm2.startModal.watch}</span>
          </label>

          <div>
            <label className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              {t.pm2.startModal.envJson}
            </label>
            <textarea
              dir="ltr"
              rows={3}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
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
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{t.pm2.startModal.launch}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
