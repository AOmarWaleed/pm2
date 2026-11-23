import React, { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  Columns2,
  FileText,
  Layers,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { LogBookmark, LogSourceType, ServerPublicConfig } from '@shared/types';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useApp } from '@/store/appStore';
import { LogTabItem, LogTabPane } from './LogTabPane';

export const LogsExplorerView: React.FC<{ server: ServerPublicConfig }> = ({
  server,
}) => {
  const { t } = useI18n();
  const { telemetry, pendingLogTabByServer, pushToast } = useApp();
  const processes = telemetry[server.id]?.processes || [];

  const [tabs, setTabs] = useState<LogTabItem[]>(() => [
    {
      id: `tab-pm2-all`,
      label: 'All Processes',
      sourceType: 'pm2',
      target: '',
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-pm2-all');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitTabId, setSplitTabId] = useState<string>('tab-pm2-all');

  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const [customFilePath, setCustomFilePath] = useState(
    '/var/log/nginx/error.log',
  );
  const [bookmarks, setBookmarks] = useState<LogBookmark[]>([]);

  const loadBookmarks = useCallback(async () => {
    try {
      const res = await api.listLogBookmarks(server.id);
      setBookmarks(res.bookmarks);
    } catch {
      // ignore if disconnected/unloaded
    }
  }, [server.id]);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  const openOrFocusTab = useCallback(
    (sourceType: LogSourceType, target: string, label?: string) => {
      const cleanTarget = target.trim();
      const tabId = `tab-${sourceType}-${cleanTarget || 'all'}`;
      const displayLabel =
        label ||
        cleanTarget.split('/').pop() ||
        cleanTarget ||
        t.logs.allProcesses;

      setTabs((prev) => {
        if (prev.some((item) => item.id === tabId)) return prev;
        return [
          ...prev,
          { id: tabId, label: displayLabel, sourceType, target: cleanTarget },
        ];
      });
      setActiveTabId(tabId);
      setShowNewTabMenu(false);
    },
    [t.logs.allProcesses],
  );

  // Consume deep-link requests from PM2 table / File Manager / Cron Jobs
  const pending = pendingLogTabByServer[server.id];
  useEffect(() => {
    if (!pending) return;
    openOrFocusTab(pending.sourceType, pending.target, pending.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.nonce]);

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((item) => item.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1].id);
      }
      if (splitTabId === id) {
        setSplitTabId(next[0].id);
      }
      return next;
    });
  };

  const handleToggleSplit = () => {
    if (!splitEnabled) {
      if (tabs.length >= 2) {
        const second = tabs.find((tb) => tb.id !== activeTabId) || tabs[0];
        setSplitTabId(second.id);
      } else {
        setSplitTabId(activeTabId);
      }
      setSplitEnabled(true);
    } else {
      setSplitEnabled(false);
    }
  };

  const handleToggleBookmark = async (tab: LogTabItem) => {
    const existing = bookmarks.find(
      (b) => b.sourceType === tab.sourceType && b.target === tab.target,
    );
    try {
      if (existing) {
        await api.deleteLogBookmark(server.id, existing.id);
        pushToast({ variant: 'info', title: 'Bookmark removed' });
      } else {
        await api.saveLogBookmark(server.id, {
          label: tab.label,
          sourceType: tab.sourceType,
          target: tab.target,
        });
        pushToast({ variant: 'success', title: `Bookmarked ${tab.label}` });
      }
      await loadBookmarks();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Bookmark failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const activeTab = tabs.find((tb) => tb.id === activeTabId) || tabs[0];
  const rightTab = tabs.find((tb) => tb.id === splitTabId) || tabs[0];

  const getIcon = (src: LogSourceType) => {
    if (src === 'file') return <FileText className="h-3.5 w-3.5 text-sky-400" />;
    if (src === 'cron') return <Clock className="h-3.5 w-3.5 text-amber-400" />;
    return <Layers className="h-3.5 w-3.5 text-emerald-400" />;
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4 sm:p-5">
      {/* Explorer Header & Multi-Tab Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5">
            {tabs.map((tab) => {
              const isActive = activeTab.id === tab.id;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400'
                  }`}
                >
                  {getIcon(tab.sourceType)}
                  <span dir="ltr" className="max-w-[160px] truncate font-mono">
                    {tab.label}
                  </span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* + New Log Tab Dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowNewTabMenu((v) => !v)}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-dashed border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:border-emerald-500/50 hover:text-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.logs.newTab}</span>
            </button>

            {showNewTabMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowNewTabMenu(false)}
                />
                <div className="absolute start-0 top-full z-40 mt-1.5 w-80 space-y-3 rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      PM2 Processes
                    </div>
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      <button
                        onClick={() =>
                          openOrFocusTab('pm2', '', t.logs.allProcesses)
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <Layers className="h-3.5 w-3.5 text-emerald-400" />
                        <span>{t.logs.allProcesses}</span>
                      </button>
                      {processes.map((p) => (
                        <button
                          key={p.name}
                          onClick={() =>
                            openOrFocusTab('pm2', p.name, p.name)
                          }
                          dir="ltr"
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-start font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Layers className="h-3.5 w-3.5 text-emerald-400" />
                            <span>{p.name}</span>
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {p.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {bookmarks.length > 0 && (
                    <div className="border-t border-zinc-200 pt-2.5 dark:border-zinc-800">
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        {t.logs.bookmarks}
                      </div>
                      <div className="max-h-28 space-y-1 overflow-y-auto">
                        {bookmarks.map((bm) => (
                          <div
                            key={bm.id}
                            className="flex items-center justify-between gap-1 rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <button
                              onClick={() =>
                                openOrFocusTab(
                                  bm.sourceType,
                                  bm.target,
                                  bm.label,
                                )
                              }
                              dir="ltr"
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-start font-mono text-xs"
                            >
                              <Star className="h-3 w-3 shrink-0 text-amber-400" />
                              <span className="truncate">{bm.target}</span>
                            </button>
                            <button
                              onClick={async () => {
                                await api.deleteLogBookmark(server.id, bm.id);
                                await loadBookmarks();
                              }}
                              className="p-1 text-zinc-400 hover:text-rose-500"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!customFilePath.trim()) return;
                      openOrFocusTab('file', customFilePath.trim());
                    }}
                    className="border-t border-zinc-200 pt-2.5 dark:border-zinc-800"
                  >
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Custom Log File Path
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        dir="ltr"
                        value={customFilePath}
                        onChange={(e) => setCustomFilePath(e.target.value)}
                        placeholder={t.logs.customFilePlaceholder}
                        className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        {t.logs.openFileTab}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Split View Toggle */}
        <button
          onClick={handleToggleSplit}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
            splitEnabled
              ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400'
              : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
          }`}
        >
          <Columns2 className="h-3.5 w-3.5" />
          <span>{splitEnabled ? t.logs.closeSplit : t.logs.splitView}</span>
        </button>
      </div>

      {/* Panes */}
      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          splitEnabled ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        <div className="flex min-h-0 flex-col">
          <LogTabPane
            key={`${server.id}-left-${activeTab.id}`}
            server={server}
            tab={activeTab}
            isBookmarked={bookmarks.some(
              (b) =>
                b.sourceType === activeTab.sourceType &&
                b.target === activeTab.target,
            )}
            onToggleBookmark={(tb) => void handleToggleBookmark(tb)}
          />
        </div>

        {splitEnabled && (
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[11px] font-semibold text-zinc-500">
                Right Split Pane
              </span>
              <select
                dir="ltr"
                value={rightTab.id}
                onChange={(e) => setSplitTabId(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              >
                {tabs.map((tb) => (
                  <option key={tb.id} value={tb.id}>
                    {tb.sourceType}: {tb.label}
                  </option>
                ))}
              </select>
            </div>
            <LogTabPane
              key={`${server.id}-right-${rightTab.id}`}
              server={server}
              tab={rightTab}
              isBookmarked={bookmarks.some(
                (b) =>
                  b.sourceType === rightTab.sourceType &&
                  b.target === rightTab.target,
              )}
              onToggleBookmark={(tb) => void handleToggleBookmark(tb)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
