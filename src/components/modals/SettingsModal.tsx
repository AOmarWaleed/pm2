import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Settings, Shield, X } from 'lucide-react';
import { AiProvider } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

export const SettingsModal: React.FC = () => {
  const { t } = useI18n();
  const {
    showSettingsModal,
    setShowSettingsModal,
    aiConfig,
    refreshAiConfig,
    autoLockMinutes,
    refreshVaultStatus,
    pushToast,
  } = useApp();

  const [tab, setTab] = useState<'ai' | 'vault'>('ai');

  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [testingAi, setTestingAi] = useState(false);

  const [lockMins, setLockMins] = useState(autoLockMinutes);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    if (!showSettingsModal) return;
    if (aiConfig) {
      setProvider(aiConfig.provider);
      setModel(aiConfig.model);
      setBaseUrl(aiConfig.baseUrl || '');
      setApiKey('');
    }
    setLockMins(autoLockMinutes);
  }, [showSettingsModal, aiConfig, autoLockMinutes]);

  if (!showSettingsModal) return null;

  const handleSaveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateAiConfig({
        provider,
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      await refreshAiConfig();
      setApiKey('');
      pushToast({ variant: 'success', title: 'AI settings saved' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Failed to save AI settings',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    try {
      await api.testAiConnection({
        provider,
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      pushToast({ variant: 'success', title: 'AI provider reachable!' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'AI test failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingAi(false);
    }
  };

  const handleUpdateAutoLock = async () => {
    try {
      await api.updateVaultSettings(lockMins);
      await refreshVaultStatus();
      pushToast({ variant: 'success', title: 'Auto-lock updated' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.changeVaultPassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      pushToast({ variant: 'success', title: 'Master password updated' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Password change failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t.settings.title}
            </h2>
          </div>
          <button
            onClick={() => setShowSettingsModal(false)}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
          <button
            onClick={() => setTab('ai')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === 'ai'
                ? 'bg-emerald-500/15 text-emerald-500'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>{t.settings.aiTab}</span>
          </button>
          <button
            onClick={() => setTab('vault')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === 'vault'
                ? 'bg-emerald-500/15 text-emerald-500'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>{t.settings.vaultTab}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {tab === 'ai' ? (
            <form onSubmit={handleSaveAi} className="space-y-3.5">
              <div>
                <label className="mb-1 block font-medium">
                  {t.settings.provider}
                </label>
                <select
                  value={provider}
                  onChange={(e) => {
                    const next = e.target.value as AiProvider;
                    setProvider(next);
                    if (next === 'gemini') {
                      setModel('gemini-2.5-flash');
                      setBaseUrl('');
                    } else if (next === 'openai') {
                      setModel('gpt-4o-mini');
                      setBaseUrl('');
                    } else {
                      setModel('llama3.1');
                      setBaseUrl('http://127.0.0.1:11434/v1');
                    }
                  }}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">
                    OpenAI-Compatible (OpenRouter / Groq / Ollama)
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium">
                  {t.settings.model}
                </label>
                <input
                  dir="ltr"
                  required
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">
                  {t.settings.apiKey}
                </label>
                <input
                  dir="ltr"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    aiConfig?.hasApiKey
                      ? t.serverModal.secretSavedHint
                      : 'sk-... / AIza...'
                  }
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">
                  {t.settings.baseUrl}
                </label>
                <input
                  dir="ltr"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1 or http://127.0.0.1:11434/v1"
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={testingAi}
                  onClick={() => void handleTestAi()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 font-medium dark:border-zinc-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span>{t.settings.testAi}</span>
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500"
                >
                  {t.settings.saveAi}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <label className="block font-medium">
                  {t.settings.autoLock}
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    dir="ltr"
                    type="number"
                    min={0}
                    max={1440}
                    value={lockMins}
                    onChange={(e) => setLockMins(Number(e.target.value))}
                    className="w-28 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <button
                    onClick={() => void handleUpdateAutoLock()}
                    className="rounded-lg bg-zinc-900 px-3.5 py-1.5 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {t.settings.saveAutoLock}
                  </button>
                </div>
              </div>

              <form
                onSubmit={handleChangePw}
                className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <KeyRound className="h-4 w-4 text-emerald-500" />
                  <span>{t.settings.changePassword}</span>
                </div>
                <input
                  dir="ltr"
                  type="password"
                  required
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder={t.settings.currentPw}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                />
                <input
                  dir="ltr"
                  type="password"
                  required
                  minLength={6}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder={t.settings.newPw}
                  className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500"
                >
                  {t.settings.updatePw}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
