import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Loader2,
  Play,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import {
  AiCommandSuggestion,
  AiLogDiagnosis,
  CommandRiskLevel,
  ServerPublicConfig,
} from '@shared/types';
import { api } from '@/api/client';
import { wsClient } from '@/api/wsClient';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

export const AiAssistantView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t, lang } = useI18n();
  const {
    aiConfig,
    aiLogSeedByServer,
    setShowSettingsModal,
    confirmDanger,
    pushToast,
  } = useApp();

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [suggestion, setSuggestion] = useState<AiCommandSuggestion | null>(
    null,
  );
  const [editableCommand, setEditableCommand] = useState('');
  const [diagnosis, setDiagnosis] = useState<AiLogDiagnosis | null>(null);

  const [execRunId, setExecRunId] = useState<string | null>(null);
  const [execOutput, setExecOutput] = useState('');
  const [executing, setExecuting] = useState(false);

  const isConfigured =
    aiConfig &&
    (aiConfig.hasApiKey || aiConfig.provider === 'openai-compatible');

  useEffect(() => {
    return wsClient.subscribe((msg) => {
      if (msg.type === 'script:output' && msg.runId === execRunId) {
        setExecOutput((prev) => prev + msg.chunk);
      } else if (msg.type === 'script:done' && msg.runId === execRunId) {
        setExecuting(false);
      }
    });
  }, [execRunId]);

  const seed = aiLogSeedByServer[server.id];
  useEffect(() => {
    if (!seed) return;
    setDiagnosis(null);
    setSuggestion(null);
    setError('');
    setLoading(true);
    api
      .diagnoseLogsWithAi(server.id, seed.processName, seed.logs, lang)
      .then((res) => {
        setDiagnosis(res.diagnosis);
        if (res.diagnosis.suggestedCommand) {
          setSuggestion(res.diagnosis.suggestedCommand);
          setEditableCommand(res.diagnosis.suggestedCommand.command);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Diagnosis failed');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  const handleAsk = async (textOverride?: string) => {
    const query = (textOverride ?? prompt).trim();
    if (!query) return;
    setError('');
    setDiagnosis(null);
    setSuggestion(null);
    setExecOutput('');
    setLoading(true);
    try {
      const res = await api.suggestAiCommand(server.id, query, lang);
      setSuggestion(res.suggestion);
      setEditableCommand(res.suggestion.command);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query AI');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndRun = async () => {
    const cmd = editableCommand.trim();
    if (!cmd) return;
    const risk: CommandRiskLevel = suggestion?.risk || 'caution';

    if (risk === 'destructive' || server.environment === 'production') {
      const ok = await confirmDanger({
        title: 'Approve Command Execution',
        description: `Run "${cmd}" on ${server.name} (${server.environment})?`,
        environment: server.environment,
        requireExactMatch:
          risk === 'destructive' && server.environment === 'production'
            ? server.name
            : undefined,
        confirmLabel: t.ai.approveRun,
      });
      if (!ok) return;
    }

    if (server.connectionStatus !== 'connected') {
      pushToast({
        variant: 'warning',
        title: 'Server is disconnected',
        message: 'Connect via SSH first.',
      });
      return;
    }

    const runId = `ai-exec-${Date.now()}`;
    setExecRunId(runId);
    setExecOutput('');
    setExecuting(true);
    wsClient.send({
      type: 'script:run',
      runId,
      serverId: server.id,
      name: 'AI Approved Command',
      command: cmd,
      cwd: suggestion?.targetCwd || server.defaultCwd,
    });
  };

  const renderRiskBadge = (risk: CommandRiskLevel) => {
    if (risk === 'safe') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-500">
          <ShieldCheck className="h-3 w-3" />
          {t.ai.riskSafe}
        </span>
      );
    }
    if (risk === 'caution') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          {t.ai.riskCaution}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-bold text-rose-500">
        <AlertTriangle className="h-3 w-3" />
        {t.ai.riskDestructive}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-500" />
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {t.ai.title}
            </h1>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{t.ai.subtitle}</p>
        </div>
        <button
          onClick={() => setShowSettingsModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <Settings className="h-3.5 w-3.5" />
          <span>{t.ai.openSettings}</span>
        </button>
      </div>

      {!isConfigured && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
          <span>{t.ai.notConfigured}</span>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-zinc-950"
          >
            {t.ai.openSettings}
          </button>
        </div>
      )}

      {/* Prompt Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleAsk();
        }}
        className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/80"
      >
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t.ai.promptPlaceholder}
          className="w-full resize-none bg-transparent text-xs leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <div className="flex flex-wrap gap-1.5">
            {t.ai.quickPrompts.map((qp) => (
              <button
                key={qp}
                type="button"
                onClick={() => {
                  setPrompt(qp);
                  void handleAsk(qp);
                }}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600 hover:border-indigo-500/40 hover:text-indigo-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
              >
                {qp}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>{loading ? t.ai.generating : t.ai.generate}</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
          {error}
        </div>
      )}

      {/* Log Diagnosis Card */}
      {diagnosis && (
        <div className="space-y-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-5 text-xs">
          <div className="font-semibold text-indigo-500">
            Log Root-Cause Diagnosis ({diagnosis.severity.toUpperCase()})
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {diagnosis.summary}
          </p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {diagnosis.rootCause}
          </p>
          {diagnosis.steps.length > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-zinc-600 dark:text-zinc-300">
              {diagnosis.steps.map((s, idx) => (
                <li key={idx}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Approval-Gated Command Proposal */}
      {suggestion && (
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {renderRiskBadge(suggestion.risk)}
            <span className="text-[11px] text-zinc-500">
              {server.name} ({server.environment})
            </span>
          </div>

          <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            {suggestion.explanation}
          </p>

          {suggestion.warnings.length > 0 && (
            <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-600 dark:text-amber-300">
              {suggestion.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
              <Terminal className="h-3.5 w-3.5" />
              <span>{t.ai.editCommand}</span>
            </label>
            <textarea
              dir="ltr"
              rows={2}
              value={editableCommand}
              onChange={(e) => setEditableCommand(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-emerald-300 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setSuggestion(null);
                setEditableCommand('');
              }}
              className="rounded-xl border border-zinc-300 px-3.5 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              {t.ai.dismiss}
            </button>
            <button
              disabled={executing || !editableCommand.trim()}
              onClick={() => void handleApproveAndRun()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {executing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span>{t.ai.approveRun}</span>
            </button>
          </div>
        </div>
      )}

      {/* Output */}
      {execOutput && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="text-xs font-semibold text-zinc-400">
            {t.ai.executionResult}
          </div>
          <pre
            dir="ltr"
            className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-zinc-200"
          >
            {execOutput}
          </pre>
        </div>
      )}
    </div>
  );
};
