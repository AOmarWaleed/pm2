import {
  FileEntry,
  FileReadResult,
  HostMetrics,
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

  public generateLogLine(processName?: string): {
    source: 'stdout' | 'stderr';
    line: string;
  } {
    const time = new Date().toISOString();
    const proc = processName
      ? this.processes.find((p) => p.name === processName)
      : this.processes[Math.floor(Math.random() * this.processes.length)];
    const name = proc?.name || 'api-gateway';

    if (proc?.status === 'errored' || Math.random() < 0.18) {
      const errs = [
        `\x1b[31m[${time}] [${name}] ERROR: ETIMEDOUT connecting to redis://10.0.2.15:6379 after 3000ms\x1b[0m`,
        `\x1b[31m[${time}] [${name}] UnhandledPromiseRejectionWarning: PoolExhaustedError at PgPool.acquire (node_modules/pg-pool/index.js:184:15)\x1b[0m`,
        `\x1b[33m[${time}] [${name}] WARN: Event loop lag spiked to 184ms (memory RSS=${Math.round((proc?.memory || 150e6) / 1048576)}MB)\x1b[0m`,
      ];
      return {
        source: 'stderr',
        line: errs[Math.floor(Math.random() * errs.length)],
      };
    }

    const reqId = Math.random().toString(36).slice(2, 9);
    const routes = [
      'GET /api/v2/health 200 4ms',
      'POST /api/v2/invoices/sync 202 31ms',
      'GET /api/v2/sessions/verify 200 9ms',
      'JOB processed batch #4821 in 42ms',
    ];
    return {
      source: 'stdout',
      line: `\x1b[32m[${time}]\x1b[0m \x1b[36m[${name}]\x1b[0m req=${reqId} ${routes[Math.floor(Math.random() * routes.length)]}`,
    };
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
