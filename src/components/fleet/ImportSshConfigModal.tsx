import React, { useEffect, useState } from 'react';
import { Check, Download, Loader2, X } from 'lucide-react';
import { EnvironmentTag, SshConfigImportCandidate } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

interface ImportSshConfigModalProps {
  open: boolean;
  onClose: () => void;
}

export const ImportSshConfigModal: React.FC<ImportSshConfigModalProps> = ({
  open,
  onClose,
}) => {
  const { t } = useI18n();
  const { refreshServers, pushToast } = useApp();
  const [candidates, setCandidates] = useState<SshConfigImportCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [envMap, setEnvMap] = useState<Record<string, EnvironmentTag>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .importSshConfig()
      .then((res) => {
        setCandidates(res.candidates);
        const sel: Record<string, boolean> = {};
        const envs: Record<string, EnvironmentTag> = {};
        for (const c of res.candidates) {
          sel[c.alias] = true;
          envs[c.alias] = c.alias.toLowerCase().includes('prod')
            ? 'production'
            : c.alias.toLowerCase().includes('stag')
              ? 'staging'
              : 'development';
        }
        setSelected(sel);
        setEnvMap(envs);
      })
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: 'Failed to parse ~/.ssh/config',
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setLoading(false));
  }, [open, pushToast]);

  if (!open) return null;

  const handleImport = async () => {
    const chosen = candidates.filter((c) => selected[c.alias]);
    if (chosen.length === 0) return;
    setImporting(true);
    try {
      for (const c of chosen) {
        await api.createServer({
          name: c.alias,
          host: c.host,
          port: c.port,
          username: c.username,
          authMethod: 'privateKey',
          privateKeyPath: c.privateKeyPath || '~/.ssh/id_rsa',
          environment: envMap[c.alias] || 'production',
          pm2Mode: 'direct',
        });
      }
      await refreshServers();
      pushToast({
        variant: 'success',
        title: `Imported ${chosen.length} server(s)`,
      });
      onClose();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Import error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t.importModal.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {t.importModal.desc}
        </p>

        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 py-8 text-center text-xs text-zinc-500 dark:border-zinc-700">
              {t.importModal.empty}
            </div>
          ) : (
            candidates.map((c) => (
              <div
                key={c.alias}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((p) => ({ ...p, [c.alias]: !p[c.alias] }))
                    }
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected[c.alias]
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-zinc-400 dark:border-zinc-600'
                    }`}
                  >
                    {selected[c.alias] && <Check className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0" dir="ltr">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {c.alias}
                    </div>
                    <div className="truncate font-mono text-[11px] text-zinc-500">
                      {c.username}@{c.host}:{c.port}{' '}
                      {c.privateKeyPath ? `• ${c.privateKeyPath}` : ''}
                    </div>
                  </div>
                </label>

                <select
                  value={envMap[c.alias] || 'production'}
                  onChange={(e) =>
                    setEnvMap((p) => ({
                      ...p,
                      [c.alias]: e.target.value as EnvironmentTag,
                    }))
                  }
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="production">{t.env.production}</option>
                  <option value="staging">{t.env.staging}</option>
                  <option value="development">{t.env.development}</option>
                </select>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            {t.importModal.close}
          </button>
          <button
            disabled={
              importing ||
              candidates.filter((c) => selected[c.alias]).length === 0
            }
            onClick={handleImport}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {t.importModal.importSelected}
          </button>
        </div>
      </div>
    </div>
  );
};
