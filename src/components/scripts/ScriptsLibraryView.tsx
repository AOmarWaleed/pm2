import React, { useEffect, useState } from 'react';
import {
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { ScriptItem, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { wsClient } from '@/api/wsClient';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { formatTimeAgo } from '@/utils/format';

export const ScriptsLibraryView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { scripts, scriptHistory, refreshScripts, pushToast, confirmDanger } =
    useApp();

  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<ScriptItem | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cwd, setCwd] = useState('');
  const [command, setCommand] = useState('');
  const [tagsText, setTagsText] = useState('');

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runOutput, setRunOutput] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    return wsClient.subscribe((msg) => {
      if (msg.type === 'script:output' && msg.runId === activeRunId) {
        setRunOutput((prev) => prev + msg.chunk);
      } else if (msg.type === 'script:done' && msg.runId === activeRunId) {
        setRunning(false);
        void refreshScripts();
      }
    });
  }, [activeRunId, refreshScripts]);

  const openNew = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setCwd(server.defaultCwd || '');
    setCommand('');
    setTagsText('deploy');
    setShowEditor(true);
  };

  const openEdit = (item: ScriptItem) => {
    setEditing(item);
    setName(item.name);
    setDescription(item.description);
    setCwd(item.cwd || '');
    setCommand(item.command);
    setTagsText(item.tags.join(', '));
    setShowEditor(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.saveScript({
        id: editing?.id,
        name,
        description,
        cwd: cwd.trim() || undefined,
        command,
        tags: tagsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      await refreshScripts();
      setShowEditor(false);
      pushToast({ variant: 'success', title: 'Script saved' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDelete = async (item: ScriptItem) => {
    const ok = await confirmDanger({
      title: `Delete "${item.name}"`,
      description: 'Remove this saved script from your library?',
      environment: 'development',
    });
    if (!ok) return;
    await api.deleteScript(item.id);
    await refreshScripts();
  };

  const handleRun = async (item: ScriptItem) => {
    if (server.environment === 'production') {
      const ok = await confirmDanger({
        title: `Run "${item.name}" on Production`,
        description: `Execute "${item.command}" on ${server.name}?`,
        environment: server.environment,
      });
      if (!ok) return;
    }

    const runId = `run-${Date.now()}`;
    setActiveRunId(runId);
    setRunOutput('');
    setRunning(true);
    wsClient.send({
      type: 'script:run',
      runId,
      serverId: server.id,
      scriptId: item.id,
      name: item.name,
      command: item.command,
      cwd: item.cwd,
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-emerald-500" />
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {t.scripts.title}
          </h1>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t.scripts.newScript}</span>
        </button>
      </div>

      {/* Scripts Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {scripts.map((scr) => (
          <div
            key={scr.id}
            className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {scr.name}
                </h3>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(scr)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDelete(scr)}
                    className="rounded p-1 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {scr.description && (
                <p className="mt-1 text-xs text-zinc-500">{scr.description}</p>
              )}
              <pre
                dir="ltr"
                className="mt-3 overflow-x-auto rounded-xl bg-zinc-950 p-2.5 font-mono text-[11px] text-emerald-300"
              >
                {scr.command}
              </pre>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap gap-1">
                {scr.tags.map((tag) => (
                  <span
                    key={tag}
                    dir="ltr"
                    className="rounded bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
              <button
                disabled={running || server.connectionStatus !== 'connected'}
                onClick={() => void handleRun(scr)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{t.scripts.runNow}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Live Output */}
      {(activeRunId || runOutput) && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">
              {t.scripts.output}
            </span>
            {running && activeRunId && (
              <button
                onClick={() =>
                  wsClient.send({ type: 'script:cancel', runId: activeRunId })
                }
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                <Square className="h-3 w-3" />
                <span>{t.scripts.cancelRun}</span>
              </button>
            )}
          </div>
          <pre
            dir="ltr"
            className="mt-2 max-h-64 overflow-y-auto font-mono text-xs whitespace-pre-wrap text-zinc-200"
          >
            {runOutput || '...'}
          </pre>
        </div>
      )}

      {/* Recent Runs */}
      {scriptHistory.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {t.scripts.history}
          </h3>
          <div className="mt-3 space-y-2">
            {scriptHistory.slice(0, 8).map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded-xl border border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800"
              >
                <div>
                  <span className="font-semibold">{run.scriptName}</span>
                  <span className="ms-2 text-zinc-500">({run.serverName})</span>
                </div>
                <div dir="ltr" className="flex items-center gap-3 font-mono text-[11px]">
                  <span
                    className={
                      run.status === 'success'
                        ? 'text-emerald-500'
                        : run.status === 'failed'
                          ? 'text-rose-500'
                          : 'text-amber-500'
                    }
                  >
                    {run.status}
                  </span>
                  <span className="text-zinc-400">
                    {formatTimeAgo(run.startedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Script Modal */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t.scripts.newScript}
              </h3>
              <button
                onClick={() => setShowEditor(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium">
                  {t.scripts.name}
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium">
                  {t.scripts.description}
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium">
                    {t.scripts.cwd}
                  </label>
                  <input
                    dir="ltr"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium">
                    {t.scripts.tags}
                  </label>
                  <input
                    dir="ltr"
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-medium">
                  {t.scripts.command}
                </label>
                <textarea
                  dir="ltr"
                  required
                  rows={4}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="rounded-lg border border-zinc-300 px-3.5 py-2 dark:border-zinc-700"
                >
                  {t.serverModal.cancel}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500"
                >
                  {t.scripts.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
