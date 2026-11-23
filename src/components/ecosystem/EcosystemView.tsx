import React, { useState } from 'react';
import { Download, FileCode2, Play, RefreshCw } from 'lucide-react';
import { ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

const STARTER_ECOSYSTEM = `module.exports = {
  apps: [
    {
      name: 'web-api',
      script: './dist/index.js',
      cwd: '/home/deploy/app',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
`;

export const EcosystemView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { pushToast } = useApp();
  const [filePath, setFilePath] = useState(
    `${server.defaultCwd || '/home/deploy/app'}/ecosystem.config.js`,
  );
  const [content, setContent] = useState(STARTER_ECOSYSTEM);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastOutput, setLastOutput] = useState('');

  const handleLoad = async () => {
    setLoading(true);
    try {
      const res = await api.readFile(server.id, filePath);
      setContent(res.content);
      pushToast({ variant: 'success', title: 'Loaded ecosystem config' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Could not read file',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (action: 'startOrReload' | 'start') => {
    setApplying(true);
    setLastOutput('');
    try {
      const res = await api.pm2ApplyEcosystem(server.id, {
        filePath,
        content,
        action,
      });
      setLastOutput(res.output);
      pushToast({
        variant: 'success',
        title: `Ecosystem ${action} succeeded`,
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Ecosystem apply failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-5 w-5 text-emerald-500" />
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {t.ecosystem.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setContent(STARTER_ECOSYSTEM)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {t.ecosystem.insertTemplate}
          </button>
          <button
            disabled={applying}
            onClick={() => void handleApply('start')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <Play className="h-3.5 w-3.5 text-sky-500" />
            <span>{t.ecosystem.saveAndStart}</span>
          </button>
          <button
            disabled={applying}
            onClick={() => void handleApply('startOrReload')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t.ecosystem.saveAndReload}</span>
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          dir="ltr"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="/home/deploy/app/ecosystem.config.js"
          className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          disabled={loading}
          onClick={() => void handleLoad()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <Download className="h-3.5 w-3.5" />
          <span>{t.ecosystem.loadFile}</span>
        </button>
      </div>

      <textarea
        dir="ltr"
        spellCheck={false}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="mt-3 min-h-[320px] flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-emerald-100 outline-none focus:border-emerald-500"
      />

      {lastOutput && (
        <pre
          dir="ltr"
          className="mt-3 max-h-36 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300"
        >
          {lastOutput}
        </pre>
      )}
    </div>
  );
};
