import React, { useState } from 'react';
import {
  Activity,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

export const VaultLockScreen: React.FC = () => {
  const { vaultState, onVaultAuthenticated, theme, toggleTheme } = useApp();
  const { t, lang, toggleLang } = useI18n();
  const isSetup = vaultState === 'uninitialized';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isSetup) {
      if (password.length < 6) {
        setError(t.vault.minLength);
        return;
      }
      if (password !== confirm) {
        setError(t.vault.passwordMismatch);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (isSetup) {
        await api.setupVault(password);
      } else {
        await api.unlockVault(password);
      }
      await onVaultAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 dark:bg-zinc-950">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={toggleLang}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{lang === 'en' ? 'العربية' : 'English'}</span>
        </button>
        <button
          onClick={toggleTheme}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-7 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                {t.appName}
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t.appSubtitle}
              </p>
            </div>
          </div>
          <span
            dir="ltr"
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300"
          >
            <ShieldCheck className="h-3 w-3" />
            {t.vault.lockedBadge}
          </span>
        </div>

        <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Lock className="h-4 w-4 text-emerald-500" />
            <h2>{isSetup ? t.vault.setupTitle : t.vault.unlockTitle}</h2>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {isSetup ? t.vault.setupDesc : t.vault.unlockDesc}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.vault.masterPassword}
            </label>
            <div className="relative mt-1.5">
              <input
                dir="ltr"
                type={showPw ? 'text' : 'password'}
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSetup ? t.vault.minLength : '••••••••'}
                className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3.5 py-2.5 pe-10 text-sm text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 end-0 flex items-center pe-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                {showPw ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {isSetup && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {t.vault.confirmPassword}
              </label>
              <input
                dir="ltr"
                type={showPw ? 'text' : 'password'}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            <span>{isSetup ? t.vault.setupBtn : t.vault.unlockBtn}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
