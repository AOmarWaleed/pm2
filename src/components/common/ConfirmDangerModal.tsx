import React, { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';

export const ConfirmDangerModal: React.FC = () => {
  const { pendingConfirm } = useApp();
  const { t } = useI18n();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setTyped('');
  }, [pendingConfirm]);

  if (!pendingConfirm) return null;

  const { req, resolve } = pendingConfirm;
  const needsExact =
    req.environment === 'production' && Boolean(req.requireExactMatch);
  const canProceed =
    !needsExact || typed.trim() === req.requireExactMatch?.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {req.title || t.confirm.title}
            </h3>
          </div>
          <button
            onClick={() => resolve(false)}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {req.description}
        </p>

        {needsExact && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
            <p className="text-xs font-medium text-rose-600 dark:text-rose-300">
              {t.confirm.prodWarning}
            </p>
            <p
              dir="ltr"
              className="mt-1.5 inline-block rounded bg-zinc-950/70 px-2 py-0.5 font-mono text-xs font-semibold text-rose-300"
            >
              {req.requireExactMatch}
            </p>
            <input
              dir="ltr"
              type="text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t.confirm.typeToConfirm}
              className="mt-2.5 w-full rounded-lg border border-rose-500/40 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-rose-500 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={() => resolve(false)}
            className="rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t.confirm.cancel}
          </button>
          <button
            disabled={!canProceed}
            onClick={() => resolve(true)}
            className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {req.confirmLabel || t.confirm.proceed}
          </button>
        </div>
      </div>
    </div>
  );
};
