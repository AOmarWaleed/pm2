import React, { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { Pm2Process, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

interface ScaleModalProps {
  process: Pm2Process | null;
  server: ServerPublicConfig;
  onClose: () => void;
}

export const ScaleModal: React.FC<ScaleModalProps> = ({
  process,
  server,
  onClose,
}) => {
  const { t } = useI18n();
  const { pushToast } = useApp();
  const [instances, setInstances] = useState(
    String(process?.instances || 2),
  );
  const [submitting, setSubmitting] = useState(false);

  if (!process) return null;

  const handleScale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const val =
        instances.trim() === 'max'
          ? 'max'
          : Math.max(1, Number.parseInt(instances, 10) || 1);
      const res = await api.pm2Scale(server.id, process.name, val);
      pushToast({
        variant: 'success',
        title: `Scaled ${process.name}`,
        message: res.output,
      });
      onClose();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Scale failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t.pm2.scaleModal.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p dir="ltr" className="mt-2 font-mono text-xs text-zinc-500">
          Target process: <strong className="text-zinc-200">{process.name}</strong>
        </p>

        <form onSubmit={handleScale} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.pm2.scaleModal.instances}
            </label>
            <input
              dir="ltr"
              required
              autoFocus
              value={instances}
              onChange={(e) => setInstances(e.target.value)}
              placeholder="2 or max"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              {t.serverModal.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {t.pm2.scaleModal.apply}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
