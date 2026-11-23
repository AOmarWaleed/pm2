export type EnvironmentTag = 'production' | 'staging' | 'development';

export type AuthMethod = 'privateKey' | 'password';

export type Pm2ExecutionMode = 'direct' | 'sudo' | 'sudo-user';

export type ServerConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  privateKeyContent?: string;
  passphrase?: string;
  password?: string;
  environment: EnvironmentTag;
  pm2Mode: Pm2ExecutionMode;
  pm2TargetUser?: string;
  sudoPassword?: string;
  pm2Path?: string;
  pm2Home?: string;
  defaultCwd?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ServerPublicConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  hasPrivateKeyContent: boolean;
  hasPassphrase: boolean;
  hasPassword: boolean;
  environment: EnvironmentTag;
  pm2Mode: Pm2ExecutionMode;
  pm2TargetUser?: string;
  hasSudoPassword: boolean;
  pm2Path?: string;
  pm2Home?: string;
  defaultCwd?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: number;
  updatedAt: number;
  connectionStatus?: ServerConnectionStatus;
  lastError?: string;
  osLabel?: string;
  pm2Version?: string;
  nodeVersion?: string;
}

export interface ServerInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  privateKeyContent?: string;
  passphrase?: string;
  password?: string;
  environment: EnvironmentTag;
  pm2Mode: Pm2ExecutionMode;
  pm2TargetUser?: string;
  sudoPassword?: string;
  pm2Path?: string;
  pm2Home?: string;
  defaultCwd?: string;
  notes?: string;
  isDemo?: boolean;
}

export interface SshConfigImportCandidate {
  alias: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
}

export interface ServerDetectResult {
  reachable: boolean;
  osName: string;
  kernel: string;
  hostname: string;
  nodeVersion: string | null;
  pm2Version: string | null;
  pm2Path: string | null;
  processCount: number | null;
  error?: string;
  hint?: string;
}

export type Pm2ProcessStatus =
  | 'online'
  | 'stopped'
  | 'stopping'
  | 'waiting restart'
  | 'launching'
  | 'errored'
  | 'one-launch-status'
  | 'unknown';

export interface Pm2Process {
  pm_id: number;
  name: string;
  namespace: string;
  status: Pm2ProcessStatus;
  pid: number;
  cpu: number;
  memory: number;
  uptime: number;
  createdAt: number;
  restarts: number;
  unstableRestarts: number;
  execMode: 'fork_mode' | 'cluster_mode' | string;
  instances: number | string;
  watching: boolean;
  script: string;
  cwd: string;
  args: string[];
  interpreter: string;
  nodeVersion: string;
  outLogPath: string;
  errLogPath: string;
  env: Record<string, string>;
}

export type Pm2Action =
  | 'start'
  | 'stop'
  | 'restart'
  | 'reload'
  | 'delete'
  | 'flush';

export interface StartNewAppInput {
  name: string;
  script: string;
  cwd?: string;
  execMode: 'fork' | 'cluster';
  instances?: number | 'max';
  interpreter?: string;
  args?: string;
  maxMemoryRestart?: string;
  watch?: boolean;
  env?: Record<string, string>;
}

export interface HostMetrics {
  timestamp: number;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
  loadAvg: [number, number, number];
  uptimeSeconds: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  hostname: string;
  osName: string;
  kernel: string;
  cpuCores: number;
}

export interface ProcessMetricPoint {
  timestamp: number;
  cpu: number;
  memory: number;
}

export interface ServerTelemetrySnapshot {
  serverId: string;
  connectionStatus: ServerConnectionStatus;
  lastError?: string;
  host: HostMetrics | null;
  hostHistory: HostMetrics[];
  processes: Pm2Process[];
  processHistory: Record<string, ProcessMetricPoint[]>;
}

export interface ScriptItem {
  id: string;
  name: string;
  description: string;
  command: string;
  cwd?: string;
  tags: string[];
  serverIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScriptRunRecord {
  id: string;
  scriptId?: string;
  scriptName: string;
  serverId: string;
  serverName: string;
  command: string;
  cwd?: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  exitCode: number | null;
  startedAt: number;
  finishedAt?: number;
  outputPreview: string;
}

export type AlertRuleType =
  | 'process_down'
  | 'restart_spike'
  | 'high_cpu'
  | 'high_memory';

export interface AlertRule {
  id: string;
  name: string;
  type: AlertRuleType;
  enabled: boolean;
  threshold: number;
  cooldownSeconds: number;
  environmentFilter?: EnvironmentTag | 'all';
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  serverId: string;
  serverName: string;
  environment: EnvironmentTag;
  processName?: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

export type WebhookProvider = 'telegram' | 'discord' | 'slack' | 'custom';

export interface WebhookConfig {
  id: string;
  name: string;
  provider: WebhookProvider;
  enabled: boolean;
  url?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  minSeverity: AlertSeverity;
  createdAt: number;
}

export interface WebhookPublicConfig {
  id: string;
  name: string;
  provider: WebhookProvider;
  enabled: boolean;
  url?: string;
  hasTelegramBotToken: boolean;
  telegramChatId?: string;
  minSeverity: AlertSeverity;
  createdAt: number;
}

export type AiProvider = 'gemini' | 'openai' | 'openai-compatible';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AiPublicConfig {
  provider: AiProvider;
  model: string;
  hasApiKey: boolean;
  baseUrl?: string;
}

export type CommandRiskLevel = 'safe' | 'caution' | 'destructive';

export interface AiCommandSuggestion {
  explanation: string;
  command: string;
  risk: CommandRiskLevel;
  warnings: string[];
  targetCwd?: string;
}

export interface AiLogDiagnosis {
  summary: string;
  rootCause: string;
  severity: AlertSeverity;
  steps: string[];
  suggestedCommand?: AiCommandSuggestion;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  permissions: string;
  isSymlink?: boolean;
}

export interface FileReadResult {
  path: string;
  content: string;
  size: number;
  encoding: 'utf8';
}

export type VaultState = 'uninitialized' | 'locked' | 'unlocked';

export interface VaultStatusResponse {
  state: VaultState;
  autoLockMinutes: number;
  unlockedAt?: number;
}

export interface VaultData {
  servers: ServerConfig[];
  scripts: ScriptItem[];
  alertRules: AlertRule[];
  alertEvents: AlertEvent[];
  webhooks: WebhookConfig[];
  aiConfig: AiConfig;
  settings: {
    autoLockMinutes: number;
  };
}

export type WsClientMessage =
  | { type: 'telemetry:subscribe'; serverIds: string[] }
  | { type: 'telemetry:unsubscribe'; serverIds: string[] }
  | {
      type: 'logs:start';
      streamId: string;
      serverId: string;
      processName?: string;
      lines?: number;
    }
  | { type: 'logs:stop'; streamId: string }
  | {
      type: 'terminal:open';
      sessionId: string;
      serverId: string;
      cols: number;
      rows: number;
      initialCwd?: string;
    }
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'terminal:close'; sessionId: string }
  | {
      type: 'script:run';
      runId: string;
      serverId: string;
      scriptId?: string;
      name: string;
      command: string;
      cwd?: string;
    }
  | { type: 'script:cancel'; runId: string };

export type WsServerMessage =
  | { type: 'telemetry:update'; snapshot: ServerTelemetrySnapshot }
  | {
      type: 'logs:chunk';
      streamId: string;
      serverId: string;
      source: 'stdout' | 'stderr' | 'system';
      line: string;
      timestamp: number;
    }
  | { type: 'logs:error'; streamId: string; message: string }
  | { type: 'terminal:data'; sessionId: string; data: string }
  | { type: 'terminal:closed'; sessionId: string; reason?: string }
  | {
      type: 'script:output';
      runId: string;
      stream: 'stdout' | 'stderr' | 'system';
      chunk: string;
    }
  | {
      type: 'script:done';
      runId: string;
      exitCode: number | null;
      status: 'success' | 'failed' | 'cancelled';
    }
  | { type: 'alert:fired'; event: AlertEvent }
  | { type: 'vault:locked' };
