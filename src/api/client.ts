import {
  AiCommandSuggestion,
  AiConfig,
  AiLogDiagnosis,
  AiPublicConfig,
  AlertEvent,
  AlertRule,
  FileEntry,
  FileReadResult,
  Pm2Action,
  Pm2Process,
  ScriptItem,
  ScriptRunRecord,
  ServerDetectResult,
  ServerInput,
  ServerPublicConfig,
  ServerTelemetrySnapshot,
  SshConfigImportCandidate,
  StartNewAppInput,
  VaultStatusResponse,
  WebhookConfig,
  WebhookPublicConfig,
} from '@shared/types';

const TOKEN_STORAGE_KEY = 'watchpm2_vault_token';

type LockHandler = () => void;
const lockHandlers = new Set<LockHandler>();

export function onApiVaultLocked(cb: LockHandler): () => void {
  lockHandlers.add(cb);
  return () => lockHandlers.delete(cb);
}

export function getVaultToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setVaultToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  skipAuthRedirect = false,
): Promise<T> {
  const token = getVaultToken();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof ArrayBuffer) && !(init.body instanceof Uint8Array)) {
    if (!headers.has('Content-Type') && init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
  }
  if (token) {
    headers.set('X-Vault-Token', token);
  }

  const res = await fetch(path, {
    ...init,
    headers,
  });

  if (!skipAuthRedirect && (res.status === 423 || res.status === 401)) {
    setVaultToken(null);
    for (const h of lockHandlers) h();
  }

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
  }

  if (!res.ok) {
    throw new Error(
      typeof parsed.error === 'string'
        ? parsed.error
        : `Request failed with status ${res.status}`,
    );
  }

  return parsed as T;
}

export const api = {
  // Vault
  getVaultStatus: () =>
    request<VaultStatusResponse>('/api/vault/status', {}, true),

  setupVault: async (password: string) => {
    const res = await request<VaultStatusResponse & { token: string }>(
      '/api/vault/setup',
      { method: 'POST', body: JSON.stringify({ password }) },
      true,
    );
    setVaultToken(res.token);
    return res;
  },

  unlockVault: async (password: string) => {
    const res = await request<VaultStatusResponse & { token: string }>(
      '/api/vault/unlock',
      { method: 'POST', body: JSON.stringify({ password }) },
      true,
    );
    setVaultToken(res.token);
    return res;
  },

  lockVault: async () => {
    setVaultToken(null);
    return request<VaultStatusResponse>(
      '/api/vault/lock',
      { method: 'POST' },
      true,
    );
  },

  changeVaultPassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/vault/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  updateVaultSettings: (autoLockMinutes: number) =>
    request<VaultStatusResponse>('/api/vault/settings', {
      method: 'PUT',
      body: JSON.stringify({ autoLockMinutes }),
    }),

  // Servers
  listServers: () =>
    request<{ servers: ServerPublicConfig[] }>('/api/servers'),

  importSshConfig: () =>
    request<{ candidates: SshConfigImportCandidate[] }>(
      '/api/servers/ssh-config',
    ),

  createDemoServer: () =>
    request<{ server: ServerPublicConfig }>('/api/servers/demo', {
      method: 'POST',
    }),

  testServerConnection: (
    payload: Partial<ServerInput> & { existingId?: string },
  ) =>
    request<ServerDetectResult>('/api/servers/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createServer: (input: ServerInput) =>
    request<{ server: ServerPublicConfig }>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateServer: (id: string, input: Partial<ServerInput>) =>
    request<{ server: ServerPublicConfig }>(`/api/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteServer: (id: string) =>
    request<{ ok: true }>(`/api/servers/${id}`, { method: 'DELETE' }),

  connectServer: (id: string) =>
    request<{ snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${id}/connect`,
      { method: 'POST' },
    ),

  disconnectServer: (id: string) =>
    request<{ snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${id}/disconnect`,
      { method: 'POST' },
    ),

  getTelemetry: (id: string) =>
    request<{ snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${id}/telemetry`,
    ),

  simulateDemoCrash: (id: string, processName?: string) =>
    request<{ crashed: Pm2Process; snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${id}/demo/simulate-crash`,
      { method: 'POST', body: JSON.stringify({ processName }) },
    ),

  // PM2
  listPm2: (serverId: string) =>
    request<{ processes: Pm2Process[] }>(`/api/servers/${serverId}/pm2/list`),

  pm2Action: (
    serverId: string,
    payload: { target?: string; targets?: string[]; action: Pm2Action },
  ) =>
    request<{ output: string; snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${serverId}/pm2/action`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  pm2Scale: (serverId: string, name: string, instances: number | 'max') =>
    request<{ output: string; snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${serverId}/pm2/scale`,
      { method: 'POST', body: JSON.stringify({ name, instances }) },
    ),

  pm2StartApp: (serverId: string, input: StartNewAppInput) =>
    request<{ output: string; snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${serverId}/pm2/start`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  pm2ApplyEcosystem: (
    serverId: string,
    payload: {
      filePath: string;
      content?: string;
      action: 'startOrReload' | 'start';
    },
  ) =>
    request<{ output: string; snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${serverId}/pm2/ecosystem`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  pm2Save: (serverId: string) =>
    request<{ output: string }>(`/api/servers/${serverId}/pm2/save`, {
      method: 'POST',
    }),

  pm2Resurrect: (serverId: string) =>
    request<{ output: string; snapshot: ServerTelemetrySnapshot }>(
      `/api/servers/${serverId}/pm2/resurrect`,
      { method: 'POST' },
    ),

  // Files
  listFiles: (serverId: string, dirPath: string) =>
    request<{ path: string; entries: FileEntry[] }>(
      `/api/servers/${serverId}/files/list?path=${encodeURIComponent(dirPath)}`,
    ),

  readFile: (serverId: string, filePath: string) =>
    request<FileReadResult>(
      `/api/servers/${serverId}/files/read?path=${encodeURIComponent(filePath)}`,
    ),

  writeFile: (serverId: string, filePath: string, content: string) =>
    request<{ ok: true; path: string }>(
      `/api/servers/${serverId}/files/write`,
      { method: 'PUT', body: JSON.stringify({ path: filePath, content }) },
    ),

  mkdir: (serverId: string, dirPath: string) =>
    request<{ ok: true }>(`/api/servers/${serverId}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path: dirPath }),
    }),

  renameFile: (serverId: string, oldPath: string, newPath: string) =>
    request<{ ok: true }>(`/api/servers/${serverId}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    }),

  removeFile: (serverId: string, targetPath: string, isDirectory: boolean) =>
    request<{ ok: true }>(`/api/servers/${serverId}/files/remove`, {
      method: 'DELETE',
      body: JSON.stringify({ path: targetPath, isDirectory }),
    }),

  uploadFile: async (serverId: string, targetPath: string, file: File) => {
    const buf = await file.arrayBuffer();
    return request<{ ok: true; path: string; size: number }>(
      `/api/servers/${serverId}/files/upload?path=${encodeURIComponent(targetPath)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
      },
    );
  },

  getDownloadUrl: (serverId: string, filePath: string) => {
    const token = getVaultToken() || '';
    return `/api/servers/${serverId}/files/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
  },

  // Scripts
  listScripts: () =>
    request<{ scripts: ScriptItem[]; history: ScriptRunRecord[] }>(
      '/api/scripts',
    ),

  saveScript: (
    script: Omit<ScriptItem, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
    },
  ) =>
    request<{ script: ScriptItem }>('/api/scripts', {
      method: 'POST',
      body: JSON.stringify(script),
    }),

  deleteScript: (id: string) =>
    request<{ ok: true }>(`/api/scripts/${id}`, { method: 'DELETE' }),

  // Alerts
  listAlerts: () =>
    request<{
      rules: AlertRule[];
      events: AlertEvent[];
      webhooks: WebhookPublicConfig[];
    }>('/api/alerts'),

  saveAlertRule: (rule: Omit<AlertRule, 'id'> & { id?: string }) =>
    request<{ rule: AlertRule }>('/api/alerts/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    }),

  deleteAlertRule: (id: string) =>
    request<{ ok: true }>(`/api/alerts/rules/${id}`, { method: 'DELETE' }),

  acknowledgeAlerts: (id?: string) =>
    request<{ ok: true }>('/api/alerts/events/ack', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  clearAlertEvents: () =>
    request<{ ok: true }>('/api/alerts/events', { method: 'DELETE' }),

  saveWebhook: (
    wh: Omit<WebhookConfig, 'id' | 'createdAt'> & { id?: string },
  ) =>
    request<{ webhook: WebhookPublicConfig }>('/api/alerts/webhooks', {
      method: 'POST',
      body: JSON.stringify(wh),
    }),

  deleteWebhook: (id: string) =>
    request<{ ok: true }>(`/api/alerts/webhooks/${id}`, { method: 'DELETE' }),

  testWebhook: (id: string) =>
    request<{ ok: true }>(`/api/alerts/webhooks/${id}/test`, {
      method: 'POST',
    }),

  // AI
  getAiConfig: () => request<{ config: AiPublicConfig }>('/api/ai/config'),

  updateAiConfig: (cfg: Partial<AiConfig>) =>
    request<{ config: AiPublicConfig }>('/api/ai/config', {
      method: 'PUT',
      body: JSON.stringify(cfg),
    }),

  testAiConnection: (cfg: Partial<AiConfig>) =>
    request<{ ok: true; reply: string }>('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  suggestAiCommand: (serverId: string, prompt: string, language: 'en' | 'ar') =>
    request<{ suggestion: AiCommandSuggestion }>('/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({ serverId, prompt, language }),
    }),

  diagnoseLogsWithAi: (
    serverId: string,
    processName: string,
    logs: string,
    language: 'en' | 'ar',
  ) =>
    request<{ diagnosis: AiLogDiagnosis }>('/api/ai/diagnose-logs', {
      method: 'POST',
      body: JSON.stringify({ serverId, processName, logs, language }),
    }),
};
