import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AiConfig,
  AiPublicConfig,
  AlertEvent,
  AlertRule,
  LogBookmark,
  LogSourceType,
  ScriptItem,
  ServerConfig,
  ServerInput,
  ServerPublicConfig,
  VaultData,
  VaultState,
  WebhookConfig,
  WebhookPublicConfig,
} from '@shared/types';
import {
  decryptVault,
  EncryptedVaultPayload,
  encryptVault,
  InvalidPasswordError,
} from './crypto';

export function resolveVaultDir(): string {
  return process.env.WATCH_PM2_DATA_DIR
    ? path.resolve(process.env.WATCH_PM2_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
}

function getDefaultVaultData(): VaultData {
  const now = Date.now();
  return {
    servers: [],
    scripts: [
      {
        id: 'script-pm2-status',
        name: 'PM2 Status & Memory Check',
        description: 'Inspect PM2 processes alongside Linux free memory and disk usage.',
        command: 'pm2 status && echo "--- MEMORY ---" && free -h && echo "--- DISK ---" && df -h /',
        tags: ['pm2', 'diagnostics'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'script-git-deploy',
        name: 'Git Pull, Install & Zero-Downtime Reload',
        description: 'Pull latest code on current branch, install production deps, and reload PM2 apps.',
        command: 'git pull --ff-only && npm ci --omit=dev && pm2 reload all --update-env && pm2 save',
        cwd: '/home/deploy/app',
        tags: ['deploy', 'pm2'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'script-pm2-save',
        name: 'Save & Sync PM2 Dump',
        description: 'Freeze current PM2 process list so apps survive server reboot.',
        command: 'pm2 save --force',
        tags: ['pm2', 'maintenance'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    alertRules: [
      {
        id: 'rule-process-down',
        name: 'PM2 Process Errored or Stopped',
        type: 'process_down',
        enabled: true,
        threshold: 1,
        cooldownSeconds: 120,
        environmentFilter: 'all',
      },
      {
        id: 'rule-restart-spike',
        name: 'Unexpected Restart Spike',
        type: 'restart_spike',
        enabled: true,
        threshold: 2,
        cooldownSeconds: 180,
        environmentFilter: 'all',
      },
      {
        id: 'rule-high-cpu',
        name: 'High CPU Utilization',
        type: 'high_cpu',
        enabled: true,
        threshold: 90,
        cooldownSeconds: 180,
        environmentFilter: 'all',
      },
      {
        id: 'rule-high-memory',
        name: 'High Process Memory (MB)',
        type: 'high_memory',
        enabled: true,
        threshold: 1024,
        cooldownSeconds: 180,
        environmentFilter: 'all',
      },
    ],
    alertEvents: [],
    webhooks: [],
    aiConfig: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: '',
      baseUrl: '',
    },
    logBookmarks: {},
    settings: {
      autoLockMinutes: 30,
    },
  };
}

export class VaultStore {
  private vaultData: VaultData | null = null;
  private masterPassword: string | null = null;
  private sessionToken: string | null = null;
  private unlockedAt: number | undefined;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private onLockCallbacks = new Set<() => void>();

  private get vaultFilePath(): string {
    return path.join(resolveVaultDir(), 'vault.enc');
  }

  public onLocked(cb: () => void): () => void {
    this.onLockCallbacks.add(cb);
    return () => this.onLockCallbacks.delete(cb);
  }

  public getState(): VaultState {
    if (!fs.existsSync(this.vaultFilePath)) {
      return 'uninitialized';
    }
    if (!this.vaultData || !this.masterPassword || !this.sessionToken) {
      return 'locked';
    }
    return 'unlocked';
  }

  public getStatus() {
    return {
      state: this.getState(),
      autoLockMinutes: this.vaultData?.settings.autoLockMinutes ?? 30,
      unlockedAt: this.unlockedAt,
    };
  }

  public isValidToken(token: string | undefined | null): boolean {
    if (!token || !this.sessionToken || this.getState() !== 'unlocked') {
      return false;
    }
    const a = Buffer.from(token);
    const b = Buffer.from(this.sessionToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  public touchActivity(): void {
    if (this.getState() !== 'unlocked' || !this.vaultData) return;
    this.scheduleAutoLock(this.vaultData.settings.autoLockMinutes);
  }

  private scheduleAutoLock(minutes: number): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    if (minutes > 0) {
      this.autoLockTimer = setTimeout(() => {
        this.lock();
      }, minutes * 60 * 1000);
      this.autoLockTimer.unref();
    }
  }

  public setup(password: string): { token: string } {
    if (fs.existsSync(this.vaultFilePath)) {
      throw new Error('Vault is already initialized.');
    }
    if (!password || password.length < 6) {
      throw new Error('Master password must be at least 6 characters.');
    }
    const data = getDefaultVaultData();
    this.vaultData = data;
    this.masterPassword = password;
    this.sessionToken = crypto.randomBytes(32).toString('hex');
    this.unlockedAt = Date.now();
    this.persist();
    this.scheduleAutoLock(data.settings.autoLockMinutes);
    return { token: this.sessionToken };
  }

  public unlock(password: string): { token: string } {
    if (!fs.existsSync(this.vaultFilePath)) {
      throw new Error('Vault is not initialized yet.');
    }
    const raw = fs.readFileSync(this.vaultFilePath, 'utf8');
    const payload = JSON.parse(raw) as EncryptedVaultPayload;
    const decryptedJson = decryptVault(payload, password);
    const parsed = JSON.parse(decryptedJson) as Partial<VaultData>;
    const defaults = getDefaultVaultData();
    const merged: VaultData = {
      servers: parsed.servers ?? [],
      scripts: parsed.scripts ?? defaults.scripts,
      alertRules: parsed.alertRules ?? defaults.alertRules,
      alertEvents: parsed.alertEvents ?? [],
      webhooks: parsed.webhooks ?? [],
      aiConfig: parsed.aiConfig ?? defaults.aiConfig,
      logBookmarks: parsed.logBookmarks ?? {},
      settings: {
        autoLockMinutes: parsed.settings?.autoLockMinutes ?? 30,
      },
    };
    this.vaultData = merged;
    this.masterPassword = password;
    this.sessionToken = crypto.randomBytes(32).toString('hex');
    this.unlockedAt = Date.now();
    this.scheduleAutoLock(merged.settings.autoLockMinutes);
    return { token: this.sessionToken };
  }

  public lock(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    const wasUnlocked = this.vaultData !== null;
    this.vaultData = null;
    this.masterPassword = null;
    this.sessionToken = null;
    this.unlockedAt = undefined;
    if (wasUnlocked) {
      for (const cb of this.onLockCallbacks) {
        try {
          cb();
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  public changePassword(currentPassword: string, newPassword: string): void {
    this.requireUnlocked();
    if (currentPassword !== this.masterPassword) {
      throw new InvalidPasswordError('Current master password is incorrect.');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new Error('New master password must be at least 6 characters.');
    }
    this.masterPassword = newPassword;
    this.persist();
  }

  public updateSettings(autoLockMinutes: number): void {
    const data = this.requireUnlocked();
    const normalized = Math.max(0, Math.min(1440, Math.floor(autoLockMinutes)));
    data.settings.autoLockMinutes = normalized;
    this.persist();
    this.scheduleAutoLock(normalized);
  }

  private requireUnlocked(): VaultData {
    if (!this.vaultData || !this.masterPassword) {
      throw new Error('Vault is locked.');
    }
    return this.vaultData;
  }

  private persist(): void {
    const data = this.requireUnlocked();
    const dir = resolveVaultDir();
    fs.mkdirSync(dir, { recursive: true });
    const encrypted = encryptVault(JSON.stringify(data), this.masterPassword!);
    const target = this.vaultFilePath;
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(encrypted, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, target);
  }

  // ---- Servers ----
  public listServers(): ServerConfig[] {
    return [...this.requireUnlocked().servers];
  }

  public getServer(id: string): ServerConfig | undefined {
    return this.requireUnlocked().servers.find((s) => s.id === id);
  }

  public addServer(input: ServerInput): ServerConfig {
    const data = this.requireUnlocked();
    const now = Date.now();
    const server: ServerConfig = {
      id: input.isDemo ? 'demo-server' : `srv-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      host: input.host.trim(),
      port: Number(input.port) || 22,
      username: input.username.trim(),
      authMethod: input.authMethod,
      privateKeyPath: input.privateKeyPath?.trim() || undefined,
      privateKeyContent: input.privateKeyContent?.trim() || undefined,
      passphrase: input.passphrase || undefined,
      password: input.password || undefined,
      environment: input.environment,
      pm2Mode: input.pm2Mode,
      pm2TargetUser: input.pm2TargetUser?.trim() || undefined,
      sudoPassword: input.sudoPassword || undefined,
      pm2Path: input.pm2Path?.trim() || undefined,
      pm2Home: input.pm2Home?.trim() || undefined,
      defaultCwd: input.defaultCwd?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      isDemo: input.isDemo ?? false,
      createdAt: now,
      updatedAt: now,
    };

    if (server.isDemo) {
      const existing = data.servers.find((s) => s.isDemo);
      if (existing) {
        return existing;
      }
    }

    data.servers.push(server);
    this.persist();
    return server;
  }

  public updateServer(id: string, input: Partial<ServerInput>): ServerConfig {
    const data = this.requireUnlocked();
    const idx = data.servers.findIndex((s) => s.id === id);
    if (idx === -1) {
      throw new Error('Server not found.');
    }
    const existing = data.servers[idx];
    const updated: ServerConfig = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      host: input.host !== undefined ? input.host.trim() : existing.host,
      port: input.port !== undefined ? Number(input.port) || 22 : existing.port,
      username:
        input.username !== undefined ? input.username.trim() : existing.username,
      authMethod: input.authMethod ?? existing.authMethod,
      privateKeyPath:
        input.privateKeyPath !== undefined
          ? input.privateKeyPath.trim() || undefined
          : existing.privateKeyPath,
      // Preserve secrets when omitted/empty string unless explicitly replaced or cleared
      privateKeyContent:
        input.privateKeyContent === '__CLEAR__'
          ? undefined
          : input.privateKeyContent !== undefined && input.privateKeyContent !== ''
            ? input.privateKeyContent.trim()
            : existing.privateKeyContent,
      passphrase:
        input.passphrase === '__CLEAR__'
          ? undefined
          : input.passphrase !== undefined && input.passphrase !== ''
            ? input.passphrase
            : existing.passphrase,
      password:
        input.password === '__CLEAR__'
          ? undefined
          : input.password !== undefined && input.password !== ''
            ? input.password
            : existing.password,
      environment: input.environment ?? existing.environment,
      pm2Mode: input.pm2Mode ?? existing.pm2Mode,
      pm2TargetUser:
        input.pm2TargetUser !== undefined
          ? input.pm2TargetUser.trim() || undefined
          : existing.pm2TargetUser,
      sudoPassword:
        input.sudoPassword === '__CLEAR__'
          ? undefined
          : input.sudoPassword !== undefined && input.sudoPassword !== ''
            ? input.sudoPassword
            : existing.sudoPassword,
      pm2Path:
        input.pm2Path !== undefined
          ? input.pm2Path.trim() || undefined
          : existing.pm2Path,
      pm2Home:
        input.pm2Home !== undefined
          ? input.pm2Home.trim() || undefined
          : existing.pm2Home,
      defaultCwd:
        input.defaultCwd !== undefined
          ? input.defaultCwd.trim() || undefined
          : existing.defaultCwd,
      notes:
        input.notes !== undefined
          ? input.notes.trim() || undefined
          : existing.notes,
      updatedAt: Date.now(),
    };
    data.servers[idx] = updated;
    this.persist();
    return updated;
  }

  public deleteServer(id: string): void {
    const data = this.requireUnlocked();
    data.servers = data.servers.filter((s) => s.id !== id);
    this.persist();
  }

  public toPublicServer(s: ServerConfig): ServerPublicConfig {
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      authMethod: s.authMethod,
      privateKeyPath: s.privateKeyPath,
      hasPrivateKeyContent: Boolean(s.privateKeyContent),
      hasPassphrase: Boolean(s.passphrase),
      hasPassword: Boolean(s.password),
      environment: s.environment,
      pm2Mode: s.pm2Mode,
      pm2TargetUser: s.pm2TargetUser,
      hasSudoPassword: Boolean(s.sudoPassword),
      pm2Path: s.pm2Path,
      pm2Home: s.pm2Home,
      defaultCwd: s.defaultCwd,
      notes: s.notes,
      isDemo: s.isDemo,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  // ---- Scripts ----
  public listScripts(): ScriptItem[] {
    return [...this.requireUnlocked().scripts];
  }

  public saveScript(
    input: Omit<ScriptItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): ScriptItem {
    const data = this.requireUnlocked();
    const now = Date.now();
    if (input.id) {
      const idx = data.scripts.findIndex((s) => s.id === input.id);
      if (idx !== -1) {
        const updated: ScriptItem = {
          ...data.scripts[idx],
          name: input.name.trim(),
          description: input.description.trim(),
          command: input.command,
          cwd: input.cwd?.trim() || undefined,
          tags: input.tags,
          serverIds: input.serverIds,
          updatedAt: now,
        };
        data.scripts[idx] = updated;
        this.persist();
        return updated;
      }
    }
    const created: ScriptItem = {
      id: `scr-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      description: input.description.trim(),
      command: input.command,
      cwd: input.cwd?.trim() || undefined,
      tags: input.tags,
      serverIds: input.serverIds,
      createdAt: now,
      updatedAt: now,
    };
    data.scripts.unshift(created);
    this.persist();
    return created;
  }

  public deleteScript(id: string): void {
    const data = this.requireUnlocked();
    data.scripts = data.scripts.filter((s) => s.id !== id);
    this.persist();
  }

  // ---- Alerts ----
  public listAlertRules(): AlertRule[] {
    return [...this.requireUnlocked().alertRules];
  }

  public saveAlertRule(
    input: Omit<AlertRule, 'id'> & { id?: string },
  ): AlertRule {
    const data = this.requireUnlocked();
    if (input.id) {
      const idx = data.alertRules.findIndex((r) => r.id === input.id);
      if (idx !== -1) {
        const updated: AlertRule = { ...input, id: input.id };
        data.alertRules[idx] = updated;
        this.persist();
        return updated;
      }
    }
    const created: AlertRule = {
      ...input,
      id: `rule-${crypto.randomUUID().slice(0, 8)}`,
    };
    data.alertRules.push(created);
    this.persist();
    return created;
  }

  public deleteAlertRule(id: string): void {
    const data = this.requireUnlocked();
    data.alertRules = data.alertRules.filter((r) => r.id !== id);
    this.persist();
  }

  public listAlertEvents(): AlertEvent[] {
    return [...this.requireUnlocked().alertEvents];
  }

  public appendAlertEvent(event: AlertEvent): void {
    const data = this.requireUnlocked();
    data.alertEvents.unshift(event);
    if (data.alertEvents.length > 200) {
      data.alertEvents = data.alertEvents.slice(0, 200);
    }
    this.persist();
  }

  public acknowledgeAlerts(id?: string): void {
    const data = this.requireUnlocked();
    for (const ev of data.alertEvents) {
      if (!id || ev.id === id) {
        ev.acknowledged = true;
      }
    }
    this.persist();
  }

  public clearAlertEvents(): void {
    const data = this.requireUnlocked();
    data.alertEvents = [];
    this.persist();
  }

  // ---- Webhooks ----
  public listWebhooks(): WebhookConfig[] {
    return [...this.requireUnlocked().webhooks];
  }

  public saveWebhook(
    input: Omit<WebhookConfig, 'id' | 'createdAt'> & { id?: string },
  ): WebhookConfig {
    const data = this.requireUnlocked();
    if (input.id) {
      const idx = data.webhooks.findIndex((w) => w.id === input.id);
      if (idx !== -1) {
        const prev = data.webhooks[idx];
        const updated: WebhookConfig = {
          ...prev,
          name: input.name.trim(),
          provider: input.provider,
          enabled: input.enabled,
          url: input.url?.trim() || undefined,
          telegramBotToken:
            input.telegramBotToken && input.telegramBotToken !== ''
              ? input.telegramBotToken.trim()
              : prev.telegramBotToken,
          telegramChatId: input.telegramChatId?.trim() || undefined,
          minSeverity: input.minSeverity,
        };
        data.webhooks[idx] = updated;
        this.persist();
        return updated;
      }
    }
    const created: WebhookConfig = {
      id: `wh-${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      provider: input.provider,
      enabled: input.enabled,
      url: input.url?.trim() || undefined,
      telegramBotToken: input.telegramBotToken?.trim() || undefined,
      telegramChatId: input.telegramChatId?.trim() || undefined,
      minSeverity: input.minSeverity,
      createdAt: Date.now(),
    };
    data.webhooks.push(created);
    this.persist();
    return created;
  }

  public deleteWebhook(id: string): void {
    const data = this.requireUnlocked();
    data.webhooks = data.webhooks.filter((w) => w.id !== id);
    this.persist();
  }

  public toPublicWebhook(w: WebhookConfig): WebhookPublicConfig {
    return {
      id: w.id,
      name: w.name,
      provider: w.provider,
      enabled: w.enabled,
      url: w.url,
      hasTelegramBotToken: Boolean(w.telegramBotToken),
      telegramChatId: w.telegramChatId,
      minSeverity: w.minSeverity,
      createdAt: w.createdAt,
    };
  }

  // ---- AI Config ----
  public getAiConfig(): AiConfig {
    return { ...this.requireUnlocked().aiConfig };
  }

  public getPublicAiConfig(): AiPublicConfig {
    const cfg = this.requireUnlocked().aiConfig;
    return {
      provider: cfg.provider,
      model: cfg.model,
      hasApiKey: Boolean(cfg.apiKey),
      baseUrl: cfg.baseUrl,
    };
  }

  public updateAiConfig(input: Partial<AiConfig>): AiPublicConfig {
    const data = this.requireUnlocked();
    data.aiConfig = {
      provider: input.provider ?? data.aiConfig.provider,
      model: input.model !== undefined ? input.model.trim() : data.aiConfig.model,
      apiKey:
        input.apiKey === '__CLEAR__'
          ? undefined
          : input.apiKey !== undefined && input.apiKey !== ''
            ? input.apiKey.trim()
            : data.aiConfig.apiKey,
      baseUrl:
        input.baseUrl !== undefined
          ? input.baseUrl.trim() || undefined
          : data.aiConfig.baseUrl,
    };
    this.persist();
    return this.getPublicAiConfig();
  }

  // ---- Log Bookmarks ----
  public listLogBookmarks(serverId: string): LogBookmark[] {
    const data = this.requireUnlocked();
    return [...(data.logBookmarks[serverId] || [])];
  }

  public saveLogBookmark(
    serverId: string,
    input: { label: string; sourceType: LogSourceType; target: string },
  ): LogBookmark {
    const data = this.requireUnlocked();
    const list = data.logBookmarks[serverId] || [];
    const existing = list.find(
      (b) => b.sourceType === input.sourceType && b.target === input.target,
    );
    if (existing) {
      existing.label = input.label.trim() || existing.label;
      data.logBookmarks[serverId] = list;
      this.persist();
      return existing;
    }
    const created: LogBookmark = {
      id: `lb-${crypto.randomUUID().slice(0, 8)}`,
      label: input.label.trim() || input.target,
      sourceType: input.sourceType,
      target: input.target.trim(),
      createdAt: Date.now(),
    };
    data.logBookmarks[serverId] = [created, ...list];
    this.persist();
    return created;
  }

  public deleteLogBookmark(serverId: string, bookmarkId: string): void {
    const data = this.requireUnlocked();
    const list = data.logBookmarks[serverId] || [];
    data.logBookmarks[serverId] = list.filter((b) => b.id !== bookmarkId);
    this.persist();
  }
}

export const vaultStore = new VaultStore();
