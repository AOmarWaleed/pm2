import React, { useState } from 'react';
import {
  Activity,
  Bell,
  ChevronDown,
  Globe,
  LayoutGrid,
  Lock,
  Moon,
  Plus,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { cn } from '@/utils/format';
import { ConnectionDot, EnvBadge } from '../common/Badges';

export const TopTabBar: React.FC = () => {
  const {
    servers,
    openTabIds,
    activeTabId,
    setActiveTab,
    openServerTab,
    closeServerTab,
    unreadAlertsCount,
    setShowAlertsModal,
    setShowSettingsModal,
    lockVault,
    theme,
    toggleTheme,
  } = useApp();
  const { t, lang, toggleLang } = useI18n();
  const [showTabPicker, setShowTabPicker] = useState(false);

  const openServers = openTabIds
    .map((id) => servers.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const closedServers = servers.filter((s) => !openTabIds.includes(s.id));

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-3 dark:border-zinc-800/80 dark:bg-zinc-950">
      {/* Brand + Tab Strip */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
        <div className="me-2 flex shrink-0 items-center gap-2 rounded-lg bg-emerald-500/10 px-2.5 py-1 ring-1 ring-emerald-500/20">
          <Activity className="h-4 w-4 text-emerald-500" />
          <span
            dir="ltr"
            className="text-xs font-bold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            WatchPM2
          </span>
        </div>

        <button
          onClick={() => setActiveTab('fleet')}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
            activeTabId === 'fleet'
              ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900',
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>{t.tabs.fleet}</span>
          <span className="rounded bg-zinc-500/20 px-1.5 py-0.2 text-[10px]">
            {servers.length}
          </span>
        </button>

        {openServers.map((srv) => {
          const isActive = activeTabId === srv.id;
          return (
            <div
              key={srv.id}
              onClick={() => setActiveTab(srv.id)}
              className={cn(
                'group flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                isActive
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70',
              )}
            >
              <ConnectionDot status={srv.connectionStatus} />
              <span className="max-w-[140px] truncate">{srv.name}</span>
              <EnvBadge env={srv.environment} compact />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeServerTab(srv.id);
                }}
                title="Close tab"
                className="rounded p-0.5 text-zinc-400 opacity-70 hover:bg-zinc-200 hover:text-zinc-900 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {/* Quick Open Server Dropdown */}
        {servers.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setShowTabPicker((v) => !v)}
              title={t.tabs.openTab}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTabPicker && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowTabPicker(false)}
                />
                <div className="absolute start-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                  {closedServers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">
                      {t.tabs.noClosedServers}
                    </p>
                  ) : (
                    closedServers.map((srv) => (
                      <button
                        key={srv.id}
                        onClick={() => {
                          openServerTab(srv.id);
                          setShowTabPicker(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <ConnectionDot status={srv.connectionStatus} />
                          <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                            {srv.name}
                          </span>
                        </div>
                        <EnvBadge env={srv.environment} compact />
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right Utility Actions */}
      <div className="ms-2 flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => setShowAlertsModal(true)}
          className="relative inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Bell className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t.tabs.alerts}</span>
          {unreadAlertsCount > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unreadAlertsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setShowSettingsModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{t.tabs.settings}</span>
        </button>

        <button
          onClick={toggleLang}
          title="Switch Language"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{lang === 'en' ? 'AR' : 'EN'}</span>
        </button>

        <button
          onClick={toggleTheme}
          title="Toggle Theme"
          className="rounded-lg border border-zinc-200 p-1.5 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          onClick={() => void lockVault()}
          title={t.vault.lockVault}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:border-rose-500/40 hover:text-rose-500 dark:border-zinc-800 dark:text-zinc-300"
        >
          <Lock className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t.vault.lockVault}</span>
        </button>
      </div>
    </header>
  );
};
