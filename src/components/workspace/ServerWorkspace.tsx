import React from 'react';
import {
  Activity,
  Bot,
  FileCode2,
  Flame,
  FolderOpen,
  Layers,
  Plug,
  RefreshCw,
  ScrollText,
  Terminal as TerminalIcon,
  Unplug,
  Zap,
} from 'lucide-react';
import { ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { ServerSection, useApp } from '@/store/appStore';
import { cn, formatDurationSeconds } from '@/utils/format';
import { AiAssistantView } from '../ai/AiAssistantView';
import { ConnectionDot, EnvBadge } from '../common/Badges';
import { EcosystemView } from '../ecosystem/EcosystemView';
import { FileManagerView } from '../files/FileManagerView';
import { LiveLogsView } from '../logs/LiveLogsView';
import { ServerOverviewView } from '../overview/ServerOverviewView';
import { Pm2ProcessTable } from '../pm2/Pm2ProcessTable';
import { ScriptsLibraryView } from '../scripts/ScriptsLibraryView';
import { SshTerminalView } from '../terminal/SshTerminalView';

export const ServerWorkspace: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const {
    sectionByServer,
    setServerSection,
    telemetry,
    connectServer,
    disconnectServer,
    pushToast,
  } = useApp();

  const activeSection: ServerSection =
    sectionByServer[server.id] || 'processes';
  const snapshot = telemetry[server.id];
  const isConnected = server.connectionStatus === 'connected';

  const navItems: Array<{
    id: ServerSection;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'processes',
      label: t.nav.processes,
      icon: <Layers className="h-4 w-4" />,
      badge: snapshot?.processes.length || undefined,
    },
    {
      id: 'overview',
      label: t.nav.overview,
      icon: <Activity className="h-4 w-4" />,
    },
    {
      id: 'logs',
      label: t.nav.logs,
      icon: <ScrollText className="h-4 w-4" />,
    },
    {
      id: 'ecosystem',
      label: t.nav.ecosystem,
      icon: <FileCode2 className="h-4 w-4" />,
    },
    {
      id: 'terminal',
      label: t.nav.terminal,
      icon: <TerminalIcon className="h-4 w-4" />,
    },
    {
      id: 'files',
      label: t.nav.files,
      icon: <FolderOpen className="h-4 w-4" />,
    },
    {
      id: 'scripts',
      label: t.nav.scripts,
      icon: <Zap className="h-4 w-4" />,
    },
    {
      id: 'ai',
      label: t.nav.ai,
      icon: <Bot className="h-4 w-4" />,
    },
  ];

  const handleSimulateCrash = async () => {
    try {
      const res = await api.simulateDemoCrash(server.id);
      pushToast({
        variant: 'warning',
        title: `Simulated crash: ${res.crashed.name}`,
        message: 'Check Alerts Center and Live Logs!',
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Failed to simulate crash',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col md:flex-row">
      {/* Left Sidebar */}
      <aside className="flex shrink-0 flex-col border-b border-zinc-200 bg-white dark:border-zinc-800/80 dark:bg-zinc-950 md:w-56 md:border-b-0 md:border-e">
        <div className="border-b border-zinc-200 p-3.5 dark:border-zinc-800/80">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ConnectionDot status={server.connectionStatus} />
              <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                {server.name}
              </span>
            </div>
            <EnvBadge env={server.environment} compact />
          </div>
          <p
            dir="ltr"
            className="mt-1 truncate font-mono text-[11px] text-zinc-500"
          >
            {server.username}@{server.host}:{server.port}
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            {isConnected ? (
              <button
                onClick={() => void disconnectServer(server.id)}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <Unplug className="h-3 w-3" />
                <span>{t.fleet.disconnect}</span>
              </button>
            ) : (
              <button
                onClick={() => void connectServer(server.id)}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
              >
                <Plug className="h-3 w-3" />
                <span>{t.fleet.connect}</span>
              </button>
            )}
            <button
              onClick={() => void connectServer(server.id)}
              title={t.nav.reconnect}
              className="rounded-lg border border-zinc-200 p-1 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto">
          {navItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setServerSection(server.id, item.id)}
                className={cn(
                  'flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium transition',
                  active
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200',
                )}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="rounded-md bg-zinc-500/15 px-1.5 py-0.5 font-mono text-[10px]">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-zinc-200 p-3 text-[11px] text-zinc-500 dark:border-zinc-800/80 md:block">
          {server.isDemo && (
            <button
              onClick={() => void handleSimulateCrash()}
              className="mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 font-medium text-rose-500 hover:bg-rose-500/20"
            >
              <Flame className="h-3.5 w-3.5" />
              <span>{t.nav.simulateCrash}</span>
            </button>
          )}
          <div dir="ltr" className="space-y-1 font-mono text-[10px]">
            <div className="truncate">
              OS: {snapshot?.host?.osName || server.osLabel || 'Linux'}
            </div>
            <div>
              Mode: {server.pm2Mode}
              {server.pm2TargetUser ? ` (${server.pm2TargetUser})` : ''}
            </div>
            {snapshot?.host && (
              <div>
                Uptime: {formatDurationSeconds(snapshot.host.uptimeSeconds)}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950/60">
        {activeSection === 'overview' && (
          <ServerOverviewView server={server} />
        )}
        {activeSection === 'processes' && (
          <Pm2ProcessTable server={server} />
        )}
        {activeSection === 'logs' && <LiveLogsView server={server} />}
        {activeSection === 'ecosystem' && <EcosystemView server={server} />}
        {activeSection === 'terminal' && <SshTerminalView server={server} />}
        {activeSection === 'files' && <FileManagerView server={server} />}
        {activeSection === 'scripts' && (
          <ScriptsLibraryView server={server} />
        )}
        {activeSection === 'ai' && <AiAssistantView server={server} />}
      </main>
    </div>
  );
};
