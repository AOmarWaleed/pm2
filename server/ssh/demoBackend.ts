import {
  describeCron,
  getNextCronRuns,
  validateCronExpression,
} from '@shared/cronUtils';
import {
  CronJobInput,
  CronJobItem,
  CronRunRecord,
  FileEntry,
  FileReadResult,
  HistoricalLogLine,
  HostMetrics,
  LogSourceType,
  Pm2Action,
  Pm2Process,
  ServerConnectionStatus,
  ServerDetectResult,
  StartNewAppInput,
} from '@shared/types';

interface MockFileNode {
  content?: string;
  isDirectory: boolean;
  modifiedAt: number;
  permissions: string;
}

class DemoBackend {
  private status: ServerConnectionStatus = 'connected';
  private processes: Pm2Process[] = [];
  private fsNodes = new Map<string, MockFileNode>();
  private cronJobs: CronJobItem[] = [];
  private cronLogs = new Map<string, string>();
  private netRxBase = 240_000;
  private netTxBase = 160_000;
  private hostStartedAt = Date.now() - 1000 * 60 * 60 * 24 * 14;
  private crashListeners = new Set<() => void>();

  constructor() {
    this.seed();
  }

  private seed(): void {
    const now = Date.now();
    this.processes = [
      {
        pm_id: 0,
        name: 'api-gateway',
        namespace: 'default',
        status: 'online',
        pid: 14210,
        cpu: 14.2,
        memory: 186 * 1024 * 1024,
        uptime: now - 1000 * 60 * 60 * 48,
        createdAt: now - 1000 * 60 * 60 * 24 * 10,
        restarts: 2,
        unstableRestarts: 0,
        execMode: 'cluster_mode',
        instances: 2,
        watching: false,
        script: 'dist/gateway.js',
        cwd: '/home/deploy/app',
        args: ['--port', '8080'],
        interpreter: 'node',
        nodeVersion: '22.14.0',
        outLogPath: '/home/deploy/.pm2/logs/api-gateway-out.log',
        errLogPath: '/home/deploy/.pm2/logs/api-gateway-error.log',
        env: {
          NODE_ENV: 'production',
          PORT: '8080',
          REDIS_URL: 'redis://10.0.2.15:6379',
          JWT_SECRET: 'sk_live_demo_secret_token_9481',
          DATABASE_URL: 'postgres://app:pass@10.0.2.20:5432/prod_db',
        },
      },
      {
        pm_id: 1,
        name: 'auth-service',
        namespace: 'default',
        status: 'online',
        pid: 14288,
        cpu: 6.4,
        memory: 112 * 1024 * 1024,
        uptime: now - 1000 * 60 * 60 * 32,
        createdAt: now - 1000 * 60 * 60 * 24 * 10,
        restarts: 1,
        unstableRestarts: 0,
        execMode: 'fork_mode',
        instances: 1,
        watching: true,
        script: 'services/auth/index.js',
        cwd: '/home/deploy/app',
        args: [],
        interpreter: 'node',
        nodeVersion: '22.14.0',
        outLogPath: '/home/deploy/.pm2/logs/auth-service-out.log',
        errLogPath: '/home/deploy/.pm2/logs/auth-service-error.log',
        env: {
          NODE_ENV: 'production',
          AUTH_PORT: '8081',
          OAUTH_CLIENT_SECRET: 'demo_oauth_secret_abc',
        },
      },
      {
        pm_id: 2,
        name: 'billing-worker',
        namespace: 'workers',
        status: 'online',
        pid: 14502,
        cpu: 21.8,
        memory: 294 * 1024 * 1024,
        uptime: now - 1000 * 60 * 60 * 6,
        createdAt: now - 1000 * 60 * 60 * 24 * 8,
        restarts: 3,
        unstableRestarts: 0,
        execMode: 'fork_mode',
        instances: 1,
        watching: false,
        script: 'workers/billing-queue.js',
        cwd: '/home/deploy/workers',
        args: ['--concurrency', '8'],
        interpreter: 'node',
        nodeVersion: '22.14.0',
        outLogPath: '/home/deploy/.pm2/logs/billing-worker-out.log',
        errLogPath: '/home/deploy/.pm2/logs/billing-worker-error.log',
        env: {
          NODE_ENV: 'production',
          STRIPE_WEBHOOK_SECRET: 'whsec_demo_9918273',
          QUEUE_NAME: 'billing-high',
        },
      },
      {
        pm_id: 3,
        name: 'realtime-ws',
        namespace: 'default',
        status: 'online',
        pid: 14720,
        cpu: 9.7,
        memory: 158 * 1024 * 1024,
        uptime: now - 1000 * 60 * 60 * 19,
        createdAt: now - 1000 * 60 * 60 * 24 * 7,
        restarts: 0,
        unstableRestarts: 0,
        execMode: 'cluster_mode',
        instances: 2,
        watching: false,
        script: 'ws-server.js',
        cwd: '/home/deploy/realtime',
        args: [],
        interpreter: 'node',
        nodeVersion: '22.14.0',
        outLogPath: '/home/deploy/.pm2/logs/realtime-ws-out.log',
        errLogPath: '/home/deploy/.pm2/logs/realtime-ws-error.log',
        env: {
          NODE_ENV: 'production',
          WS_PORT: '9000',
        },
      },
      {
        pm_id: 4,
        name: 'legacy-cron',
        namespace: 'maintenance',
        status: 'stopped',
        pid: 0,
        cpu: 0,
        memory: 0,
        uptime: 0,
        createdAt: now - 1000 * 60 * 60 * 24 * 20,
        restarts: 5,
        unstableRestarts: 1,
        execMode: 'fork_mode',
        instances: 1,
        watching: false,
        script: 'cleanup.js',
        cwd: '/home/deploy/cron',
        args: [],
        interpreter: 'node',
        nodeVersion: '22.14.0',
        outLogPath: '/home/deploy/.pm2/logs/legacy-cron-out.log',
        errLogPath: '/home/deploy/.pm2/logs/legacy-cron-error.log',
        env: {
          NODE_ENV: 'production',
          DRY_RUN: 'false',
        },
      },
    ];

    const dirs = [
      '/',
      '/home',
      '/home/deploy',
      '/home/deploy/app',
      '/home/deploy/app/src',
      '/home/deploy/workers',
      '/home/deploy/realtime',
      '/home/deploy/cron',
      '/etc',
      '/etc/nginx',
      '/etc/nginx/sites-enabled',
      '/var',
      '/var/log',
      '/var/log/pm2',
      '/var/log/nginx',
    ];
    for (const d of dirs) {
      this.fsNodes.set(d, {
        isDirectory: true,
        modifiedAt: now - 1000 * 60 * 60 * 48,
        permissions: 'drwxr-xr-x',
      });
    }

    this.fsNodes.set('/home/deploy/app/ecosystem.config.js', {
      isDirectory: false,
      modifiedAt: now - 1000 * 60 * 30,
      permissions: '-rw-r--r--',
      content: `module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: './dist/gateway.js',
      cwd: '/home/deploy/app',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
    },
    {
      name: 'auth-service',
      script: './services/auth/index.js',
      cwd: '/home/deploy/app',
      watch: true,
      env: {
        NODE_ENV: 'production',
        AUTH_PORT: 8081,
      },
    },
  ],
};
`,
    });

    this.fsNodes.set('/home/deploy/app/.env', {
      isDirectory: false,
      modifiedAt: now - 1000 * 60 * 120,
      permissions: '-rw-------',
      content: `NODE_ENV=production
PORT=8080
REDIS_URL=redis://10.0.2.15:6379
DATABASE_URL=postgres://app:demo_pass@10.0.2.20:5432/prod_db
JWT_SECRET=sk_live_demo_secret_token_9481
`,
    });

    this.fsNodes.set('/home/deploy/app/package.json', {
      isDirectory: false,
      modifiedAt: now - 1000 * 60 * 60 * 24,
      permissions: '-rw-r--r--',
      content: JSON.stringify(
        {
          name: 'prod-api-platform',
          version: '2.14.0',
          private: true,
          scripts: {
            build: 'tsc -p tsconfig.json',
            start: 'node dist/gateway.js',
          },
          dependencies: {
            express: '^5.0.0',
            ioredis: '^5.4.1',
            pg: '^8.13.1',
          },
        },
        null,
        2,
      ),
    });

    this.fsNodes.set('/home/deploy/app/src/index.ts', {
      isDirectory: false,
      modifiedAt: now - 1000 * 60 * 90,
      permissions: '-rw-r--r--',
      content: `import express from 'express';

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.listen(process.env.PORT || 8080);
`,
    });

    this.fsNodes.set('/etc/nginx/sites-enabled/api.conf', {
      isDirectory: false,
      modifiedAt: now - 1000 * 60 * 60 * 72,
      permissions: '-rw-r--r--',
      content: `server {
    listen 443 ssl http2;
    server_name api.example.internal;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
`,
    });

    this.fsNodes.set('/var/log/nginx/error.log', {
      isDirectory: false,
      modifiedAt: now,
      permissions: '-rw-r-----',
      content: `${new Date(now - 900000).toISOString()} [error] 1842#1842: *9182 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 185.220.101.4, server: api.example.internal, request: "POST /api/v2/invoices/sync HTTP/2.0"\n${new Date(now - 300000).toISOString()} [warn] 1842#1842: *9204 an upstream response is buffered to a temporary file /var/cache/nginx/proxy_temp/4/00/0000000004\n`,
    });

    this.seedDemoCrons(now);
  }

  private seedDemoCrons(now: number): void {
    const mkRun = (
      jobId: string,
      jobName: string,
      idx: number,
      agoMin: number,
      durMs: number,
      exitCode: number,
      trigger: 'schedule' | 'manual' | 'syslog',
      logText: string,
    ): CronRunRecord => {
      const startedAt = now - agoMin * 60_000;
      const finishedAt = trigger === 'syslog' ? null : startedAt + durMs;
      const runId = `run-${jobId}-${idx}`;
      const logFile = `/home/deploy/.watchpm2/cron-logs/${jobId}/${runId}.log`;
      this.cronLogs.set(logFile, logText);
      return {
        runId,
        jobId,
        jobName,
        status:
          trigger === 'syslog'
            ? 'unknown'
            : exitCode === 0
              ? 'success'
              : 'failed',
        exitCode: trigger === 'syslog' ? null : exitCode,
        startedAt,
        finishedAt,
        durationMs: trigger === 'syslog' ? null : durMs,
        logFile: trigger === 'syslog' ? undefined : logFile,
        trigger,
        outputPreview: logText.slice(-300),
      };
    };

    const backupRuns: CronRunRecord[] = [
      mkRun(
        'cron-backup',
        'db-nightly-backup',
        1,
        120,
        41200,
        0,
        'schedule',
        '[02:00:01] Starting pg_dump for prod_db...\n[02:00:34] Compressed dump: /backups/prod_db_2026-11-23.sql.zst (412 MB)\n[02:00:42] Uploaded cleanly to s3://company-backups/db/\n[02:00:42] Done (exit 0)',
      ),
      mkRun(
        'cron-backup',
        'db-nightly-backup',
        2,
        1560,
        39800,
        0,
        'schedule',
        '[02:00:01] Starting pg_dump for prod_db...\n[02:00:40] Uploaded cleanly to s3://company-backups/db/\n[02:00:40] Done (exit 0)',
      ),
      mkRun(
        'cron-backup',
        'db-nightly-backup',
        3,
        3000,
        4320,
        2,
        'schedule',
        '[02:00:01] Starting pg_dump for prod_db...\npg_dump: error: connection to server at "10.0.2.20", port 5432 failed: FATAL: too many clients already\n[02:00:05] Backup aborted with exit code 2',
      ),
      mkRun(
        'cron-backup',
        'db-nightly-backup',
        4,
        4440,
        40100,
        0,
        'schedule',
        '[02:00:01] Uploaded cleanly to s3://company-backups/db/',
      ),
    ];

    const warmupRuns: CronRunRecord[] = [
      mkRun(
        'cron-warmup',
        'cache-warmup',
        1,
        4,
        1420,
        0,
        'schedule',
        '{"ts":"' +
          new Date(now - 240_000).toISOString() +
          '","level":"info","keysWarmed":1480,"durationMs":1420,"msg":"Redis catalog cache refreshed"}',
      ),
      mkRun(
        'cron-warmup',
        'cache-warmup',
        2,
        9,
        1380,
        0,
        'schedule',
        'Warmed 1480 keys in 1380ms',
      ),
      mkRun(
        'cron-warmup',
        'cache-warmup',
        3,
        14,
        1510,
        0,
        'schedule',
        'Warmed 1480 keys in 1510ms',
      ),
    ];

    const reconcileRuns: CronRunRecord[] = [
      mkRun(
        'cron-reconcile',
        'invoice-reconcile',
        1,
        12,
        6240,
        1,
        'schedule',
        `[ERROR] Starting Stripe invoice reconciliation batch #412...\nFetching pending invoices from PostgreSQL...\nError: StripeAPIError: Rate limit exceeded (429 Too Many Requests) for key rk_live_***\n    at StripeClient.request (/home/deploy/workers/dist/stripe.js:114:19)\n    at async runReconcile (/home/deploy/workers/dist/reconcile.js:48:11)\nProcess exited with code 1 after 6240ms`,
      ),
      mkRun(
        'cron-reconcile',
        'invoice-reconcile',
        2,
        27,
        4890,
        0,
        'schedule',
        'Reconciled 42 invoices, 0 discrepancies.',
      ),
      mkRun(
        'cron-reconcile',
        'invoice-reconcile',
        3,
        42,
        5120,
        0,
        'schedule',
        'Reconciled 38 invoices, 0 discrepancies.',
      ),
    ];

    const tmpRuns: CronRunRecord[] = [
      mkRun(
        'cron-tmp',
        'tmp-cleanup',
        1,
        900,
        0,
        0,
        'syslog',
        `${new Date(now - 900 * 60_000).toISOString()} prod-eu-node-01 CRON[8912]: (deploy) CMD (find /tmp/uploads -mtime +3 -delete)`,
      ),
    ];

    this.cronJobs = [
      {
        id: 'cron-reconcile',
        name: 'invoice-reconcile',
        source: 'user-crontab',
        sourceFile: 'deploy crontab',
        schedule: '*/15 * * * *',
        scheduleHuman: describeCron('*/15 * * * *'),
        nextRuns: getNextCronRuns('*/15 * * * *', 3),
        command: 'node /home/deploy/workers/dist/reconcile.js --batch=200',
        rawLine:
          '*/15 * * * * "$HOME/.watchpm2/cron-run.sh" cron-reconcile ...',
        user: 'deploy',
        enabled: true,
        tracked: true,
        editable: true,
        lastRun: reconcileRuns[0],
        recentRuns: reconcileRuns,
      },
      {
        id: 'cron-warmup',
        name: 'cache-warmup',
        source: 'user-crontab',
        sourceFile: 'deploy crontab',
        schedule: '*/5 * * * *',
        scheduleHuman: describeCron('*/5 * * * *'),
        nextRuns: getNextCronRuns('*/5 * * * *', 3),
        command: '/usr/local/bin/node /home/deploy/app/scripts/warm-cache.js',
        rawLine: '*/5 * * * * "$HOME/.watchpm2/cron-run.sh" cron-warmup ...',
        user: 'deploy',
        enabled: true,
        tracked: true,
        editable: true,
        lastRun: warmupRuns[0],
        recentRuns: warmupRuns,
      },
      {
        id: 'cron-backup',
        name: 'db-nightly-backup',
        source: 'user-crontab',
        sourceFile: 'deploy crontab',
        schedule: '0 2 * * *',
        scheduleHuman: describeCron('0 2 * * *'),
        nextRuns: getNextCronRuns('0 2 * * *', 3),
        command: '/home/deploy/scripts/pg-backup.sh --bucket s3://company-backups/db',
        rawLine: '0 2 * * * "$HOME/.watchpm2/cron-run.sh" cron-backup ...',
        user: 'deploy',
        enabled: true,
        tracked: true,
        editable: true,
        lastRun: backupRuns[0],
        recentRuns: backupRuns,
      },
      {
        id: 'cron-tmp',
        name: 'tmp-cleanup',
        source: 'user-crontab',
        sourceFile: 'deploy crontab',
        schedule: '30 4 * * 0',
        scheduleHuman: describeCron('30 4 * * 0'),
        nextRuns: getNextCronRuns('30 4 * * 0', 3),
        command: 'find /tmp/uploads -type f -mtime +3 -delete',
        rawLine: '30 4 * * 0 find /tmp/uploads -type f -mtime +3 -delete',
        user: 'deploy',
        enabled: true,
        tracked: false,
        editable: true,
        lastRun: tmpRuns[0],
        recentRuns: tmpRuns,
      },
      {
        id: 'cron-certbot',
        name: 'certbot-renew',
        source: 'system-cron',
        sourceFile: '/etc/cron.d/certbot',
        schedule: '0 */12 * * *',
        scheduleHuman: describeCron('0 */12 * * *'),
        nextRuns: getNextCronRuns('0 */12 * * *', 3),
        command: 'certbot -q renew --nginx',
        rawLine: '0 */12 * * * root certbot -q renew --nginx',
        user: 'root',
        enabled: true,
        tracked: false,
        editable: false,
        recentRuns: [],
      },
      {
        id: 'timer-apt',
        name: 'apt-daily-upgrade.timer',
        source: 'systemd-timer',
        sourceFile: 'systemd',
        schedule: '0 6 * * *',
        scheduleHuman: 'Daily at 06:00',
        nextRuns: getNextCronRuns('0 6 * * *', 3),
        command: 'systemctl start apt-daily-upgrade.service',
        rawLine: 'Mon 2026-11-24 06:00:00 UTC  apt-daily-upgrade.timer',
        enabled: true,
        tracked: false,
        editable: false,
        recentRuns: [],
      },
    ];
  }

  public onCrashSimulated(cb: () => void): () => void {
    this.crashListeners.add(cb);
    return () => this.crashListeners.delete(cb);
  }

  public getStatus(): ServerConnectionStatus {
    return this.status;
  }

  public connect(): void {
    this.status = 'connected';
  }

  public disconnect(): void {
    this.status = 'disconnected';
  }

  public detect(): ServerDetectResult {
    return {
      reachable: true,
      osName: 'Ubuntu 24.04.1 LTS (Demo Sandbox)',
      kernel: '6.8.0-45-generic',
      hostname: 'prod-eu-node-01',
      nodeVersion: 'v22.14.0',
      pm2Version: '5.4.3',
      pm2Path: '/home/deploy/.nvm/versions/node/v22.14.0/bin/pm2',
      processCount: this.processes.length,
    };
  }

  public listProcesses(): Pm2Process[] {
    // Gently fluctuate live metrics for online processes
    for (const p of this.processes) {
      if (p.status === 'online') {
        const deltaCpu = (Math.random() - 0.48) * 4.5;
        p.cpu = Number(Math.max(0.4, Math.min(96, p.cpu + deltaCpu)).toFixed(1));
        const deltaMem = (Math.random() - 0.48) * 6 * 1024 * 1024;
        p.memory = Math.max(
          48 * 1024 * 1024,
          Math.round(p.memory + deltaMem),
        );
      } else {
        p.cpu = 0;
        p.memory = 0;
      }
    }
    return this.processes.map((p) => ({ ...p, env: { ...p.env } }));
  }

  public getHostMetrics(): HostMetrics {
    const now = Date.now();
    const totalMem = 16 * 1024 * 1024 * 1024;
    const procMem = this.processes.reduce((acc, p) => acc + p.memory, 0);
    const osMemBase = 2.6 * 1024 * 1024 * 1024;
    const usedMem = Math.min(totalMem * 0.94, procMem + osMemBase + Math.random() * 140 * 1024 * 1024);

    const totalCpuRaw = this.processes.reduce((acc, p) => acc + p.cpu, 0) / 4;
    const cpuPercent = Number(
      Math.max(4, Math.min(98, totalCpuRaw + 6 + (Math.random() - 0.5) * 4)).toFixed(1),
    );

    const diskTotal = 160 * 1024 * 1024 * 1024;
    const diskUsed = 74.8 * 1024 * 1024 * 1024;

    this.netRxBase = Math.max(45_000, this.netRxBase + (Math.random() - 0.5) * 80_000);
    this.netTxBase = Math.max(30_000, this.netTxBase + (Math.random() - 0.5) * 60_000);

    return {
      timestamp: now,
      cpuPercent,
      memUsedBytes: Math.round(usedMem),
      memTotalBytes: totalMem,
      memPercent: Number(((usedMem / totalMem) * 100).toFixed(1)),
      diskUsedBytes: Math.round(diskUsed),
      diskTotalBytes: diskTotal,
      diskPercent: Number(((diskUsed / diskTotal) * 100).toFixed(1)),
      loadAvg: [
        Number((cpuPercent / 30).toFixed(2)),
        Number((cpuPercent / 34).toFixed(2)),
        Number((cpuPercent / 38).toFixed(2)),
      ],
      uptimeSeconds: Math.floor((now - this.hostStartedAt) / 1000),
      netRxBytesPerSec: Math.round(this.netRxBase),
      netTxBytesPerSec: Math.round(this.netTxBase),
      hostname: 'prod-eu-node-01',
      osName: 'Ubuntu 24.04.1 LTS (Demo)',
      kernel: '6.8.0-45-generic',
      cpuCores: 4,
    };
  }

  public performAction(target: string, action: Pm2Action): string {
    const match = (p: Pm2Process) =>
      target === 'all' || String(p.pm_id) === target || p.name === target;

    const affected = this.processes.filter(match);
    if (affected.length === 0) {
      throw new Error(`Process "${target}" not found.`);
    }

    const now = Date.now();
    if (action === 'delete') {
      this.processes = this.processes.filter((p) => !match(p));
      return `[PM2] Deleted ${affected.map((p) => p.name).join(', ')}`;
    }

    for (const p of affected) {
      if (action === 'start') {
        p.status = 'online';
        p.pid = p.pid || 15000 + Math.floor(Math.random() * 900);
        p.uptime = now;
        p.cpu = 8.5;
        p.memory = 110 * 1024 * 1024;
      } else if (action === 'stop') {
        p.status = 'stopped';
        p.pid = 0;
        p.cpu = 0;
        p.memory = 0;
        p.uptime = 0;
      } else if (action === 'restart' || action === 'reload') {
        p.status = 'online';
        p.pid = 15000 + Math.floor(Math.random() * 900);
        p.uptime = now;
        p.restarts += 1;
        if (p.memory === 0) p.memory = 120 * 1024 * 1024;
      }
    }

    return `[PM2] Action "${action}" applied to ${affected.map((p) => p.name).join(', ')}`;
  }

  public scaleProcess(name: string, instances: number): string {
    const proc = this.processes.find((p) => p.name === name);
    if (!proc) throw new Error(`Process "${name}" not found.`);
    proc.instances = Math.max(1, instances);
    proc.execMode = instances > 1 ? 'cluster_mode' : 'fork_mode';
    return `[PM2] Scaled ${name} to ${proc.instances} instance(s)`;
  }

  public startNewApp(input: StartNewAppInput): Pm2Process {
    const nextId =
      this.processes.reduce((max, p) => Math.max(max, p.pm_id), -1) + 1;
    const now = Date.now();
    const proc: Pm2Process = {
      pm_id: nextId,
      name: input.name,
      namespace: 'default',
      status: 'online',
      pid: 16000 + nextId,
      cpu: 3.2,
      memory: 84 * 1024 * 1024,
      uptime: now,
      createdAt: now,
      restarts: 0,
      unstableRestarts: 0,
      execMode: input.execMode === 'cluster' ? 'cluster_mode' : 'fork_mode',
      instances: input.execMode === 'cluster' ? input.instances || 2 : 1,
      watching: Boolean(input.watch),
      script: input.script,
      cwd: input.cwd || '/home/deploy/app',
      args: input.args ? input.args.split(/\s+/).filter(Boolean) : [],
      interpreter: input.interpreter || 'node',
      nodeVersion: '22.14.0',
      outLogPath: `/home/deploy/.pm2/logs/${input.name}-out.log`,
      errLogPath: `/home/deploy/.pm2/logs/${input.name}-error.log`,
      env: { NODE_ENV: 'production', ...(input.env || {}) },
    };
    this.processes.push(proc);
    return proc;
  }

  public simulateCrash(processName = 'billing-worker'): Pm2Process {
    const target =
      this.processes.find((p) => p.name === processName) ||
      this.processes.find((p) => p.status === 'online') ||
      this.processes[0];
    if (!target) {
      throw new Error('No processes available to simulate crash.');
    }
    target.status = 'errored';
    target.pid = 0;
    target.cpu = 0;
    target.memory = 0;
    target.restarts += 3;
    target.unstableRestarts += 1;
    for (const cb of this.crashListeners) cb();
    return target;
  }

  public generateLogLine(
    processName?: string,
    sourceType: LogSourceType = 'pm2',
    target?: string,
    atTime?: number,
  ): {
    source: 'stdout' | 'stderr';
    line: string;
    timestamp: number;
  } {
    const ts = atTime ?? Date.now();
    const time = new Date(ts).toISOString();

    if (sourceType === 'file') {
      const fileTarget = target || '/var/log/nginx/error.log';
      if (fileTarget.includes('nginx')) {
        const rand = Math.random();
        if (rand < 0.28) {
          return {
            source: 'stderr',
            timestamp: ts,
            line: `${time} [error] 1842#1842: *${Math.floor(9000 + Math.random() * 900)} upstream timed out (110: Connection timed out) upstream="127.0.0.1:8080" client="185.220.101.4" method=POST path=/api/v2/invoices/sync status=504`,
          };
        }
        if (rand < 0.45) {
          return {
            source: 'stderr',
            timestamp: ts,
            line: `${time} [warn] 1842#1842: upstream response buffered to temporary file client="10.0.1.9" path=/api/v2/exports/csv status=200 latency_ms=${Math.floor(240 + Math.random() * 400)}`,
          };
        }
        return {
          source: 'stdout',
          timestamp: ts,
          line: `${time} [info] nginx access client="172.18.0.4" method=GET path=/api/v2/health status=200 bytes=${Math.floor(180 + Math.random() * 1400)} latency_ms=${Math.floor(2 + Math.random() * 18)}`,
        };
      }
      return {
        source: 'stdout',
        timestamp: ts,
        line: JSON.stringify({
          timestamp: time,
          level: Math.random() < 0.15 ? 'warn' : 'info',
          file: fileTarget,
          host: 'prod-eu-node-01',
          msg: 'System file event flushed cleanly',
        }),
      };
    }

    const proc = processName
      ? this.processes.find((p) => p.name === processName)
      : this.processes[Math.floor(Math.random() * this.processes.length)];
    const name = proc?.name || 'api-gateway';

    const roll = Math.random();
    if (proc?.status === 'errored' || roll < 0.18) {
      const errs = [
        JSON.stringify({
          timestamp: time,
          level: 'error',
          service: name,
          reqId: `req_${Math.random().toString(36).slice(2, 8)}`,
          status: 502,
          code: 'ETIMEDOUT',
          upstream: 'redis://10.0.2.15:6379',
          latencyMs: 3004,
          msg: 'Redis connection timed out after 3000ms',
        }),
        `\x1b[31m[${time}] [${name}] ERROR: UnhandledPromiseRejectionWarning: PoolExhaustedError at PgPool.acquire (pg-pool/index.js:184:15) pool=primary waiting=14\x1b[0m`,
        `\x1b[33m[${time}] [${name}] WARN: Event loop lag spiked latency_ms=184 memory_mb=${Math.round((proc?.memory || 150e6) / 1048576)} service=${name}\x1b[0m`,
      ];
      return {
        source: 'stderr',
        timestamp: ts,
        line: errs[Math.floor(Math.random() * errs.length)],
      };
    }

    if (roll < 0.45) {
      return {
        source: 'stdout',
        timestamp: ts,
        line: JSON.stringify({
          timestamp: time,
          level: roll < 0.25 ? 'debug' : 'info',
          service: name,
          method: roll < 0.35 ? 'POST' : 'GET',
          path: roll < 0.35 ? '/api/v2/invoices/sync' : '/api/v2/sessions/verify',
          status: 200,
          latencyMs: Math.floor(4 + Math.random() * 48),
          reqId: `req_${Math.random().toString(36).slice(2, 8)}`,
          msg: 'Request completed',
        }),
      };
    }

    const reqId = Math.random().toString(36).slice(2, 9);
    const routes = [
      'method=GET path=/api/v2/health status=200 duration_ms=4',
      'method=POST path=/api/v2/invoices/sync status=202 duration_ms=31',
      'method=GET path=/api/v2/sessions/verify status=200 duration_ms=9',
      'job=billing_batch status=ok processed=128 duration_ms=42',
    ];
    return {
      source: 'stdout',
      timestamp: ts,
      line: `\x1b[32m[${time}]\x1b[0m \x1b[36m[${name}]\x1b[0m level=info reqId=${reqId} ${routes[Math.floor(Math.random() * routes.length)]}`,
    };
  }

  public generateHistoricalLogs(
    sourceType: LogSourceType,
    target: string,
    rangeMinutes: number,
    maxLines: number,
  ): HistoricalLogLine[] {
    if (sourceType === 'cron') {
      const content = this.cronLogs.get(target) || '';
      const now = Date.now();
      return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, i) => ({
          source: line.toLowerCase().includes('error') ? 'stderr' : 'stdout',
          line,
          timestamp: now - (50 - i) * 1000,
        }));
    }

    const count = Math.min(maxLines, 160);
    const now = Date.now();
    const spanMs = Math.max(60_000, rangeMinutes * 60_000);
    const lines: HistoricalLogLine[] = [];
    for (let i = 0; i < count; i++) {
      const ts = now - spanMs + Math.floor((spanMs * i) / count);
      const item = this.generateLogLine(
        sourceType === 'pm2' ? target || undefined : undefined,
        sourceType,
        target,
        ts,
      );
      lines.push(item);
    }
    return lines;
  }

  // ---- Demo Cron Jobs ----
  public listCronJobs(): CronJobItem[] {
    return this.cronJobs.map((j) => ({
      ...j,
      nextRuns: j.enabled ? getNextCronRuns(j.schedule, 3) : [],
      recentRuns: [...j.recentRuns],
      lastRun: j.recentRuns[0],
    }));
  }

  public createCronJob(input: CronJobInput): CronJobItem {
    const err = validateCronExpression(input.schedule);
    if (err) throw new Error(err);
    const id = `cron-${Date.now().toString(36)}`;
    const job: CronJobItem = {
      id,
      name: input.name.trim(),
      source: 'user-crontab',
      sourceFile: 'deploy crontab',
      schedule: input.schedule.trim(),
      scheduleHuman: describeCron(input.schedule),
      nextRuns:
        input.enabled !== false ? getNextCronRuns(input.schedule, 3) : [],
      command: input.command.trim(),
      rawLine: `${input.schedule.trim()} ${input.command.trim()}`,
      user: 'deploy',
      enabled: input.enabled !== false,
      tracked: input.tracked !== false,
      editable: true,
      recentRuns: [],
    };
    this.cronJobs.unshift(job);
    return job;
  }

  public updateCronJob(jobId: string, input: CronJobInput): void {
    const job = this.cronJobs.find((j) => j.id === jobId);
    if (!job || !job.editable) throw new Error('Editable cron job not found.');
    job.name = input.name.trim();
    job.schedule = input.schedule.trim();
    job.scheduleHuman = describeCron(job.schedule);
    job.command = input.command.trim();
    if (input.enabled !== undefined) job.enabled = input.enabled;
    if (input.tracked !== undefined) job.tracked = input.tracked;
    job.nextRuns = job.enabled ? getNextCronRuns(job.schedule, 3) : [];
  }

  public toggleCronEnabled(jobId: string, enabled: boolean): void {
    const job = this.cronJobs.find((j) => j.id === jobId);
    if (!job || !job.editable) throw new Error('Editable cron job not found.');
    job.enabled = enabled;
    job.nextRuns = enabled ? getNextCronRuns(job.schedule, 3) : [];
  }

  public toggleCronTracking(jobId: string, tracked: boolean): void {
    const job = this.cronJobs.find((j) => j.id === jobId);
    if (!job || !job.editable) throw new Error('Editable cron job not found.');
    job.tracked = tracked;
  }

  public deleteCronJob(jobId: string): void {
    this.cronJobs = this.cronJobs.filter((j) => j.id !== jobId);
  }

  public readCronRunLog(logFile: string): { content: string; path: string } {
    const content = this.cronLogs.get(logFile);
    if (content === undefined) {
      throw new Error(`Run log not found: ${logFile}`);
    }
    return { content, path: logFile };
  }

  public runCronNow(params: {
    runId: string;
    jobId: string;
    onOutput: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => void;
    onDone: (record: CronRunRecord) => void;
  }): void {
    const job = this.cronJobs.find((j) => j.id === params.jobId);
    if (!job) {
      params.onOutput('stderr', 'Cron job not found.\n');
      params.onDone({
        runId: params.runId,
        jobId: params.jobId,
        jobName: params.jobId,
        status: 'failed',
        exitCode: 1,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0,
        trigger: 'manual',
      });
      return;
    }

    const startedAt = Date.now();
    const logFile = `/home/deploy/.watchpm2/cron-logs/${job.id}/${params.runId}.log`;
    job.activeRun = {
      runId: params.runId,
      pid: 24100 + Math.floor(Math.random() * 500),
      startedAt,
      logFile,
    };

    params.onOutput(
      'system',
      `[${new Date(startedAt).toISOString()}] Executing "${job.name}"...\n$ ${job.command}\n`,
    );

    const willFail = job.command.includes('fail') && !job.command.includes('echo');
    const stepLines = [
      `Connecting to runtime environment (user=${job.user || 'deploy'})...`,
      `Processing scheduled task "${job.name}"...`,
      willFail
        ? `ERROR: Task aborted unexpectedly (exit code 1)`
        : `Task "${job.name}" completed cleanly (processed 100%).`,
    ];

    let fullText = `$ ${job.command}\n`;
    stepLines.forEach((line, idx) => {
      setTimeout(() => {
        const isErr = willFail && idx === stepLines.length - 1;
        fullText += line + '\n';
        params.onOutput(isErr ? 'stderr' : 'stdout', line + '\n');

        if (idx === stepLines.length - 1) {
          const finishedAt = Date.now();
          const exitCode = willFail ? 1 : 0;
          this.cronLogs.set(logFile, fullText);
          const record: CronRunRecord = {
            runId: params.runId,
            jobId: job.id,
            jobName: job.name,
            status: exitCode === 0 ? 'success' : 'failed',
            exitCode,
            startedAt,
            finishedAt,
            durationMs: Math.max(100, finishedAt - startedAt),
            logFile,
            trigger: 'manual',
            outputPreview: fullText.slice(-400),
          };
          job.activeRun = undefined;
          job.recentRuns.unshift(record);
          if (job.recentRuns.length > 20) job.recentRuns.pop();
          job.lastRun = record;
          params.onDone(record);
        }
      }, 350 * (idx + 1));
    });
  }

  // ---- Mock SFTP ----
  private normalizePath(p: string): string {
    const parts = p.split('/').filter(Boolean);
    const stack: string[] = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return '/' + stack.join('/');
  }

  public listDir(dirPath: string): FileEntry[] {
    const norm = this.normalizePath(dirPath || '/home/deploy/app');
    const dirNode = this.fsNodes.get(norm);
    if (!dirNode || !dirNode.isDirectory) {
      throw new Error(`Directory not found: ${norm}`);
    }
    const prefix = norm === '/' ? '/' : `${norm}/`;
    const entries: FileEntry[] = [];

    for (const [fullPath, node] of this.fsNodes.entries()) {
      if (fullPath === norm) continue;
      if (!fullPath.startsWith(prefix)) continue;
      const rest = fullPath.slice(prefix.length);
      if (rest.includes('/')) continue;
      entries.push({
        name: rest,
        path: fullPath,
        isDirectory: node.isDirectory,
        size: node.isDirectory ? 4096 : Buffer.byteLength(node.content || '', 'utf8'),
        modifiedAt: node.modifiedAt,
        permissions: node.permissions,
      });
    }

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  public readFile(filePath: string): FileReadResult {
    const norm = this.normalizePath(filePath);
    const node = this.fsNodes.get(norm);
    if (!node || node.isDirectory) {
      throw new Error(`File not found: ${norm}`);
    }
    const content = node.content ?? '';
    return {
      path: norm,
      content,
      size: Buffer.byteLength(content, 'utf8'),
      encoding: 'utf8',
    };
  }

  public writeFile(filePath: string, content: string): void {
    const norm = this.normalizePath(filePath);
    const parent = norm.slice(0, norm.lastIndexOf('/')) || '/';
    if (!this.fsNodes.has(parent)) {
      this.mkdir(parent);
    }
    this.fsNodes.set(norm, {
      isDirectory: false,
      content,
      modifiedAt: Date.now(),
      permissions: '-rw-r--r--',
    });
  }

  public mkdir(dirPath: string): void {
    const norm = this.normalizePath(dirPath);
    const parts = norm.split('/').filter(Boolean);
    let curr = '';
    for (const part of parts) {
      curr += '/' + part;
      if (!this.fsNodes.has(curr)) {
        this.fsNodes.set(curr, {
          isDirectory: true,
          modifiedAt: Date.now(),
          permissions: 'drwxr-xr-x',
        });
      }
    }
  }

  public rename(oldPath: string, newPath: string): void {
    const from = this.normalizePath(oldPath);
    const to = this.normalizePath(newPath);
    const node = this.fsNodes.get(from);
    if (!node) throw new Error(`Path not found: ${from}`);
    if (node.isDirectory) {
      const entries = [...this.fsNodes.entries()];
      for (const [k, v] of entries) {
        if (k === from || k.startsWith(`${from}/`)) {
          const updatedKey = to + k.slice(from.length);
          this.fsNodes.delete(k);
          this.fsNodes.set(updatedKey, { ...v, modifiedAt: Date.now() });
        }
      }
    } else {
      this.fsNodes.delete(from);
      this.fsNodes.set(to, { ...node, modifiedAt: Date.now() });
    }
  }

  public remove(targetPath: string): void {
    const norm = this.normalizePath(targetPath);
    if (norm === '/') throw new Error('Refusing to delete root directory.');
    for (const key of [...this.fsNodes.keys()]) {
      if (key === norm || key.startsWith(`${norm}/`)) {
        this.fsNodes.delete(key);
      }
    }
  }

  // ---- Mock Interactive Command Exec ----
  public runShellCommand(command: string, cwd = '/home/deploy/app'): {
    stdout: string;
    stderr: string;
    code: number;
    nextCwd?: string;
  } {
    const trimmed = command.trim();
    if (!trimmed) return { stdout: '', stderr: '', code: 0 };

    if (trimmed === 'pwd') {
      return { stdout: `${cwd}\n`, stderr: '', code: 0 };
    }
    if (trimmed === 'whoami') {
      return { stdout: 'deploy\n', stderr: '', code: 0 };
    }
    if (trimmed === 'uname -a') {
      return {
        stdout: 'Linux prod-eu-node-01 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux\n',
        stderr: '',
        code: 0,
      };
    }
    if (trimmed === 'uptime') {
      return {
        stdout: ' 08:45:12 up 14 days,  3:18,  1 user,  load average: 0.42, 0.38, 0.35\n',
        stderr: '',
        code: 0,
      };
    }
    if (trimmed.startsWith('cd ')) {
      const target = trimmed.slice(3).trim();
      const resolved = target.startsWith('/')
        ? this.normalizePath(target)
        : this.normalizePath(`${cwd}/${target}`);
      const node = this.fsNodes.get(resolved);
      if (!node || !node.isDirectory) {
        return {
          stdout: '',
          stderr: `bash: cd: ${target}: No such file or directory\n`,
          code: 1,
        };
      }
      return { stdout: '', stderr: '', code: 0, nextCwd: resolved };
    }
    if (trimmed === 'ls' || trimmed.startsWith('ls ')) {
      try {
        const list = this.listDir(cwd);
        return {
          stdout: list.map((e) => (e.isDirectory ? `${e.name}/` : e.name)).join('  ') + '\n',
          stderr: '',
          code: 0,
        };
      } catch (e) {
        return { stdout: '', stderr: String(e) + '\n', code: 1 };
      }
    }
    if (trimmed.startsWith('cat ')) {
      const fileArg = trimmed.slice(4).trim();
      const target = fileArg.startsWith('/')
        ? fileArg
        : `${cwd}/${fileArg}`;
      try {
        const res = this.readFile(target);
        return { stdout: res.content + (res.content.endsWith('\n') ? '' : '\n'), stderr: '', code: 0 };
      } catch (err) {
        return { stdout: '', stderr: `${err instanceof Error ? err.message : String(err)}\n`, code: 1 };
      }
    }
    if (trimmed.startsWith('pm2 ')) {
      if (trimmed.includes('status') || trimmed.includes('list') || trimmed.includes('ls')) {
        const rows = this.processes
          .map((p) => {
            const mode = p.execMode.replace('_mode', '').padEnd(7);
            const cpuStr = `${p.cpu.toFixed(1)}%`.padStart(5);
            const memStr = `${Math.round(p.memory / 1048576)}MB`.padStart(6);
            return `│ ${String(p.pm_id).padEnd(3)} │ ${p.name.padEnd(16)} │ ${mode} │ ${p.status.padEnd(8)} │ ↺ ${String(p.restarts).padEnd(3)} │ ${cpuStr} │ ${memStr} │`;
          })
          .join('\n');
        return {
          stdout: `┌─────┬──────────────────┬─────────┬──────────┬───────┬───────┬────────┐\n${rows}\n└─────┴──────────────────┴─────────┴──────────┴───────┴───────┴────────┘\n`,
          stderr: '',
          code: 0,
        };
      }
      if (trimmed.includes('save')) {
        return { stdout: '[PM2] Saving current process list...\n[PM2] Successfully saved in /home/deploy/.pm2/dump.pm2\n', stderr: '', code: 0 };
      }
      return { stdout: `[PM2 Demo] Executed: ${trimmed}\n`, stderr: '', code: 0 };
    }
    if (trimmed === 'free -h') {
      return {
        stdout: '               total        used        free      shared  buff/cache   available\nMem:            16Gi       4.2Gi       8.1Gi       120Mi       3.7Gi        11Gi\n',
        stderr: '',
        code: 0,
      };
    }
    if (trimmed === 'df -h' || trimmed === 'df -h /') {
      return {
        stdout: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1  160G   75G   85G  47% /\n',
        stderr: '',
        code: 0,
      };
    }
    if (trimmed === 'help') {
      return {
        stdout:
          'Demo Sandbox Shell Commands: ls, cd, pwd, cat <file>, pm2 list, pm2 save, free -h, df -h, uptime, uname -a, whoami, clear\n',
        stderr: '',
        code: 0,
      };
    }

    return {
      stdout: `[demo-sandbox] Executed command: ${trimmed}\nOK (exit code 0)\n`,
      stderr: '',
      code: 0,
    };
  }
}

export const demoBackend = new DemoBackend();
