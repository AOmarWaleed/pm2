import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from 'lucide-react';
import {
  EnvironmentTag,
  Pm2ProcessStatus,
  ServerConnectionStatus,
} from '@shared/types';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { cn } from '@/utils/format';

export const EnvBadge: React.FC<{
  env: EnvironmentTag;
  compact?: boolean;
}> = ({ env, compact }) => {
  const { t } = useI18n();
  const styles: Record<EnvironmentTag, string> = {
    production:
      'bg-rose-500/15 text-rose-400 border-rose-500/30 dark:text-rose-300',
    staging:
      'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-300',
    development:
      'bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-300',
  };
  const short: Record<EnvironmentTag, string> = {
    production: 'PROD',
    staging: 'STAGE',
    development: 'DEV',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        styles[env],
      )}
    >
      {compact ? short[env] : t.env[env]}
    </span>
  );
};

export const ConnectionDot: React.FC<{
  status?: ServerConnectionStatus;
}> = ({ status = 'disconnected' }) => {
  const colors: Record<ServerConnectionStatus, string> = {
    connected: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]',
    connecting: 'bg-amber-400 animate-pulse',
    disconnected: 'bg-zinc-400 dark:bg-zinc-600',
    error: 'bg-rose-500',
  };
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', colors[status])}
    />
  );
};

export const ProcessStatusBadge: React.FC<{ status: Pm2ProcessStatus }> = ({
  status,
}) => {
  const map: Record<string, string> = {
    online:
      'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
    stopped:
      'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
    errored:
      'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
    launching:
      'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
    stopping:
      'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
    'waiting restart':
      'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  };
  const cls = map[status] || map.stopped;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        cls,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'online'
            ? 'bg-emerald-400'
            : status === 'errored'
              ? 'bg-rose-400'
              : status === 'launching'
                ? 'bg-sky-400 animate-pulse'
                : 'bg-zinc-400',
        )}
      />
      <span dir="ltr">{status}</span>
    </span>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => {
        const icon =
          toast.variant === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : toast.variant === 'error' ? (
            <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
          ) : toast.variant === 'warning' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-sky-400" />
          );

        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
          >
            <div className="mt-0.5">{icon}</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {toast.title}
              </p>
              {toast.message && (
                <p className="mt-0.5 break-words text-xs text-zinc-600 dark:text-zinc-400">
                  {toast.message}
                </p>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
