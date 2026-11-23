import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AiPublicConfig,
  AlertEvent,
  AlertRule,
  EnvironmentTag,
  ScriptItem,
  ScriptRunRecord,
  ServerPublicConfig,
  ServerTelemetrySnapshot,
  VaultState,
  WebhookPublicConfig,
} from '@shared/types';
import { api, getVaultToken, onApiVaultLocked } from '../api/client';
import { wsClient } from '../api/wsClient';

export type ServerSection =
  | 'overview'
  | 'processes'
  | 'logs'
  | 'ecosystem'
  | 'terminal'
  | 'files'
  | 'scripts'
  | 'ai';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}

export interface DangerConfirmRequest {
  title: string;
  description: string;
  environment: EnvironmentTag;
  requireExactMatch?: string;
  confirmLabel?: string;
}

interface AppContextValue {
  vaultState: VaultState;
  autoLockMinutes: number;
  loadingVault: boolean;
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  servers: ServerPublicConfig[];
  openTabIds: string[];
  activeTabId: 'fleet' | string;
  sectionByServer: Record<string, ServerSection>;
  telemetry: Record<string, ServerTelemetrySnapshot>;

  selectedLogProcessByServer: Record<string, string | undefined>;
  terminalCwdByServer: Record<string, string | undefined>;
  filesDirByServer: Record<string, string | undefined>;
  aiLogSeedByServer: Record<
    string,
    { processName: string; logs: string; nonce: number } | undefined
  >;

  scripts: ScriptItem[];
  scriptHistory: ScriptRunRecord[];
  alertRules: AlertRule[];
  alertEvents: AlertEvent[];
  webhooks: WebhookPublicConfig[];
  aiConfig: AiPublicConfig | null;
  unreadAlertsCount: number;
  browserNotifEnabled: boolean;
  setBrowserNotifEnabled: (enabled: boolean) => void;

  toasts: ToastItem[];
  pushToast: (t: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;

  showAlertsModal: boolean;
  setShowAlertsModal: (v: boolean) => void;
  showSettingsModal: boolean;
  setShowSettingsModal: (v: boolean) => void;

  pendingConfirm: {
    req: DangerConfirmRequest;
    resolve: (ok: boolean) => void;
  } | null;
  confirmDanger: (req: DangerConfirmRequest) => Promise<boolean>;

  refreshVaultStatus: () => Promise<void>;
  onVaultAuthenticated: () => Promise<void>;
  lockVault: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshAlerts: () => Promise<void>;
  refreshScripts: () => Promise<void>;
  refreshAiConfig: () => Promise<void>;

  openServerTab: (serverId: string, section?: ServerSection) => void;
  closeServerTab: (serverId: string) => void;
  setActiveTab: (tabId: 'fleet' | string) => void;
  setServerSection: (serverId: string, section: ServerSection) => void;

  connectServer: (serverId: string) => Promise<void>;
  disconnectServer: (serverId: string) => Promise<void>;
  launchDemoServer: () => Promise<void>;

  jumpToLogs: (serverId: string, processName?: string) => void;
  jumpToTerminal: (serverId: string, cwd?: string) => void;
  jumpToFiles: (serverId: string, dirPath?: string) => void;
  jumpToAiDiagnoseLogs: (
    serverId: string,
    processName: string,
    logs: string,
  ) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [vaultState, setVaultState] = useState<VaultState>('locked');
  const [autoLockMinutes, setAutoLockMinutes] = useState(30);
  const [loadingVault, setLoadingVault] = useState(true);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('watchpm2_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [servers, setServers] = useState<ServerPublicConfig[]>([]);
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('watchpm2_open_tabs');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [activeTabId, setActiveTabId] = useState<'fleet' | string>('fleet');
  const [sectionByServer, setSectionByServer] = useState<
    Record<string, ServerSection>
  >({});
  const [telemetry, setTelemetry] = useState<
    Record<string, ServerTelemetrySnapshot>
  >({});

  const [selectedLogProcessByServer, setSelectedLogProcessByServer] = useState<
    Record<string, string | undefined>
  >({});
  const [terminalCwdByServer, setTerminalCwdByServer] = useState<
    Record<string, string | undefined>
  >({});
  const [filesDirByServer, setFilesDirByServer] = useState<
    Record<string, string | undefined>
  >({});
  const [aiLogSeedByServer, setAiLogSeedByServer] = useState<
    Record<
      string,
      { processName: string; logs: string; nonce: number } | undefined
    >
  >({});

  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [scriptHistory, setScriptHistory] = useState<ScriptRunRecord[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookPublicConfig[]>([]);
  const [aiConfig, setAiConfig] = useState<AiPublicConfig | null>(null);

  const [browserNotifEnabled, setBrowserNotifEnabledState] = useState<boolean>(
    () => localStorage.getItem('watchpm2_browser_notif') === '1',
  );

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    req: DangerConfirmRequest;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const browserNotifRef = useRef(browserNotifEnabled);
  browserNotifRef.current = browserNotifEnabled;

  useEffect(() => {
    localStorage.setItem('watchpm2_theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('watchpm2_open_tabs', JSON.stringify(openTabIds));
  }, [openTabIds]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setBrowserNotifEnabled = useCallback((enabled: boolean) => {
    setBrowserNotifEnabledState(enabled);
    localStorage.setItem('watchpm2_browser_notif', enabled ? '1' : '0');
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 5500);
  }, []);

  const confirmDanger = useCallback((req: DangerConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      setPendingConfirm({
        req,
        resolve: (ok) => {
          setPendingConfirm(null);
          resolve(ok);
        },
      });
    });
  }, []);

  const refreshServers = useCallback(async () => {
    const res = await api.listServers();
    setServers(res.servers);
    setOpenTabIds((prev) =>
      prev.filter((id) => res.servers.some((s) => s.id === id)),
    );
  }, []);

  const refreshAlerts = useCallback(async () => {
    const res = await api.listAlerts();
    setAlertRules(res.rules);
    setAlertEvents(res.events);
    setWebhooks(res.webhooks);
  }, []);

  const refreshScripts = useCallback(async () => {
    const res = await api.listScripts();
    setScripts(res.scripts);
    setScriptHistory(res.history);
  }, []);

  const refreshAiConfig = useCallback(async () => {
    const res = await api.getAiConfig();
    setAiConfig(res.config);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    wsClient.connect();
    await Promise.all([
      refreshServers(),
      refreshAlerts(),
      refreshScripts(),
      refreshAiConfig(),
    ]);
  }, [refreshServers, refreshAlerts, refreshScripts, refreshAiConfig]);

  const refreshVaultStatus = useCallback(async () => {
    setLoadingVault(true);
    try {
      const status = await api.getVaultStatus();
      setVaultState(status.state);
      setAutoLockMinutes(status.autoLockMinutes);
      if (status.state === 'unlocked' && getVaultToken()) {
        await loadWorkspaceData();
      } else if (status.state === 'unlocked' && !getVaultToken()) {
        // Fresh browser session while server holds unlock? Still require unlock or verify token.
        setVaultState('locked');
      }
    } catch {
      setVaultState('locked');
    } finally {
      setLoadingVault(false);
    }
  }, [loadWorkspaceData]);

  const onVaultAuthenticated = useCallback(async () => {
    setVaultState('unlocked');
    await loadWorkspaceData();
  }, [loadWorkspaceData]);

  const lockVault = useCallback(async () => {
    wsClient.disconnect();
    await api.lockVault();
    setVaultState('locked');
    setServers([]);
    setTelemetry({});
  }, []);

  useEffect(() => {
    void refreshVaultStatus();
    const unsubApiLock = onApiVaultLocked(() => {
      wsClient.disconnect();
      setVaultState('locked');
    });
    return () => unsubApiLock();
  }, [refreshVaultStatus]);

  useEffect(() => {
    if (vaultState !== 'unlocked' || servers.length === 0) return;
    const ids = servers.map((s) => s.id);
    wsClient.send({ type: 'telemetry:subscribe', serverIds: ids });
    return () => {
      wsClient.send({ type: 'telemetry:unsubscribe', serverIds: ids });
    };
  }, [vaultState, servers]);

  useEffect(() => {
    return wsClient.subscribe((msg) => {
      if (msg.type === 'telemetry:update') {
        const snap = msg.snapshot;
        setTelemetry((prev) => ({ ...prev, [snap.serverId]: snap }));
        setServers((prev) =>
          prev.map((s) =>
            s.id === snap.serverId
              ? {
                  ...s,
                  connectionStatus: snap.connectionStatus,
                  lastError: snap.lastError,
                  osLabel: snap.host?.osName || s.osLabel,
                }
              : s,
          ),
        );
      } else if (msg.type === 'alert:fired') {
        setAlertEvents((prev) => [msg.event, ...prev.slice(0, 199)]);
        pushToast({
          variant: msg.event.severity === 'critical' ? 'error' : 'warning',
          title: `${msg.event.serverName} • ${msg.event.ruleName}`,
          message: msg.event.message,
        });
        if (
          browserNotifRef.current &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          new Notification(`WatchPM2: ${msg.event.ruleName}`, {
            body: msg.event.message,
          });
        }
      } else if (msg.type === 'vault:locked') {
        wsClient.disconnect();
        setVaultState('locked');
      }
    });
  }, [pushToast]);

  const openServerTab = useCallback(
    (serverId: string, section?: ServerSection) => {
      setOpenTabIds((prev) =>
        prev.includes(serverId) ? prev : [...prev, serverId],
      );
      setActiveTabId(serverId);
      if (section) {
        setSectionByServer((prev) => ({ ...prev, [serverId]: section }));
      } else {
        setSectionByServer((prev) =>
          prev[serverId] ? prev : { ...prev, [serverId]: 'processes' },
        );
      }
      wsClient.send({ type: 'telemetry:subscribe', serverIds: [serverId] });
    },
    [],
  );

  const closeServerTab = useCallback(
    (serverId: string) => {
      setOpenTabIds((prev) => {
        const next = prev.filter((id) => id !== serverId);
        if (activeTabId === serverId) {
          setActiveTabId(next[next.length - 1] || 'fleet');
        }
        return next;
      });
    },
    [activeTabId],
  );

  const setServerSection = useCallback(
    (serverId: string, section: ServerSection) => {
      setSectionByServer((prev) => ({ ...prev, [serverId]: section }));
    },
    [],
  );

  const connectServer = useCallback(
    async (serverId: string) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === serverId ? { ...s, connectionStatus: 'connecting' } : s,
        ),
      );
      try {
        const res = await api.connectServer(serverId);
        setTelemetry((prev) => ({ ...prev, [serverId]: res.snapshot }));
        setServers((prev) =>
          prev.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  connectionStatus: res.snapshot.connectionStatus,
                  lastError: res.snapshot.lastError,
                }
              : s,
          ),
        );
        pushToast({ variant: 'success', title: 'SSH Connected' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setServers((prev) =>
          prev.map((s) =>
            s.id === serverId
              ? { ...s, connectionStatus: 'error', lastError: message }
              : s,
          ),
        );
        pushToast({ variant: 'error', title: 'Connection failed', message });
      }
    },
    [pushToast],
  );

  const disconnectServer = useCallback(async (serverId: string) => {
    const res = await api.disconnectServer(serverId);
    setTelemetry((prev) => ({ ...prev, [serverId]: res.snapshot }));
    setServers((prev) =>
      prev.map((s) =>
        s.id === serverId ? { ...s, connectionStatus: 'disconnected' } : s,
      ),
    );
  }, []);

  const launchDemoServer = useCallback(async () => {
    const res = await api.createDemoServer();
    await refreshServers();
    openServerTab(res.server.id, 'processes');
    const snapRes = await api.getTelemetry(res.server.id);
    setTelemetry((prev) => ({ ...prev, [res.server.id]: snapRes.snapshot }));
  }, [openServerTab, refreshServers]);

  const jumpToLogs = useCallback(
    (serverId: string, processName?: string) => {
      setSelectedLogProcessByServer((prev) => ({
        ...prev,
        [serverId]: processName,
      }));
      openServerTab(serverId, 'logs');
    },
    [openServerTab],
  );

  const jumpToTerminal = useCallback(
    (serverId: string, cwd?: string) => {
      if (cwd) {
        setTerminalCwdByServer((prev) => ({ ...prev, [serverId]: cwd }));
      }
      openServerTab(serverId, 'terminal');
    },
    [openServerTab],
  );

  const jumpToFiles = useCallback(
    (serverId: string, dirPath?: string) => {
      if (dirPath) {
        setFilesDirByServer((prev) => ({ ...prev, [serverId]: dirPath }));
      }
      openServerTab(serverId, 'files');
    },
    [openServerTab],
  );

  const jumpToAiDiagnoseLogs = useCallback(
    (serverId: string, processName: string, logs: string) => {
      setAiLogSeedByServer((prev) => ({
        ...prev,
        [serverId]: { processName, logs, nonce: Date.now() },
      }));
      openServerTab(serverId, 'ai');
    },
    [openServerTab],
  );

  const unreadAlertsCount = alertEvents.filter((e) => !e.acknowledged).length;

  return (
    <AppContext.Provider
      value={{
        vaultState,
        autoLockMinutes,
        loadingVault,
        theme,
        toggleTheme,
        servers,
        openTabIds,
        activeTabId,
        sectionByServer,
        telemetry,
        selectedLogProcessByServer,
        terminalCwdByServer,
        filesDirByServer,
        aiLogSeedByServer,
        scripts,
        scriptHistory,
        alertRules,
        alertEvents,
        webhooks,
        aiConfig,
        unreadAlertsCount,
        browserNotifEnabled,
        setBrowserNotifEnabled,
        toasts,
        pushToast,
        dismissToast,
        showAlertsModal,
        setShowAlertsModal,
        showSettingsModal,
        setShowSettingsModal,
        pendingConfirm,
        confirmDanger,
        refreshVaultStatus,
        onVaultAuthenticated,
        lockVault,
        refreshServers,
        refreshAlerts,
        refreshScripts,
        refreshAiConfig,
        openServerTab,
        closeServerTab,
        setActiveTab: setActiveTabId,
        setServerSection,
        connectServer,
        disconnectServer,
        launchDemoServer,
        jumpToLogs,
        jumpToTerminal,
        jumpToFiles,
        jumpToAiDiagnoseLogs,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
