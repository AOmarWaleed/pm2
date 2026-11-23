import {
  HostMetrics,
  Pm2Process,
  ProcessMetricPoint,
  ServerConfig,
  ServerConnectionStatus,
  ServerTelemetrySnapshot,
} from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import { sshPool } from '../ssh/sshPool';
import { vaultStore } from '../vault/vaultStore';
import { alertService } from './alertService';
import { pm2Service } from './pm2Service';

const MAX_HISTORY = 60;

interface PrevCounters {
  cpuIdle: number;
  cpuTotal: number;
  netRxBytes: number;
  netTxBytes: number;
  timestamp: number;
}

class MetricsService {
  private prevCounters = new Map<string, PrevCounters>();
  private hostHistory = new Map<string, HostMetrics[]>();
  private latestHost = new Map<string, HostMetrics>();
  private latestProcesses = new Map<string, Pm2Process[]>();
  private processHistory = new Map<
    string,
    Map<string, ProcessMetricPoint[]>
  >();
  private activeSubscribers = new Map<string, number>(); // serverId -> subscriber count
  private pollInterval: NodeJS.Timeout | null = null;
  private inFlight = new Set<string>();
  private listeners = new Set<(snapshot: ServerTelemetrySnapshot) => void>();

  public start(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      void this.tick();
    }, 3000);
    this.pollInterval.unref();
  }

  public stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  public onTelemetry(
    cb: (snapshot: ServerTelemetrySnapshot) => void,
  ): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public addSubscription(serverId: string): void {
    this.activeSubscribers.set(
      serverId,
      (this.activeSubscribers.get(serverId) || 0) + 1,
    );
    void this.pollServer(serverId);
  }

  public removeSubscription(serverId: string): void {
    const next = (this.activeSubscribers.get(serverId) || 1) - 1;
    if (next <= 0) {
      this.activeSubscribers.delete(serverId);
    } else {
      this.activeSubscribers.set(serverId, next);
    }
  }

  public clearServerState(serverId: string): void {
    this.prevCounters.delete(serverId);
    this.hostHistory.delete(serverId);
    this.latestHost.delete(serverId);
    this.latestProcesses.delete(serverId);
    this.processHistory.delete(serverId);
    alertService.resetServerBaseline(serverId);
  }

  public getSnapshot(server: ServerConfig): ServerTelemetrySnapshot {
    const connStatus = server.isDemo
      ? demoBackend.getStatus()
      : sshPool.getStatus(server.id).status;
    const lastError = server.isDemo
      ? undefined
      : sshPool.getStatus(server.id).lastError;

    const procMap = this.processHistory.get(server.id);
    const processHistoryObj: Record<string, ProcessMetricPoint[]> = {};
    if (procMap) {
      for (const [k, v] of procMap.entries()) {
        processHistoryObj[k] = v;
      }
    }

    return {
      serverId: server.id,
      connectionStatus: connStatus,
      lastError,
      host: this.latestHost.get(server.id) || null,
      hostHistory: this.hostHistory.get(server.id) || [],
      processes: this.latestProcesses.get(server.id) || [],
      processHistory: processHistoryObj,
    };
  }

  public getLatestProcesses(serverId: string): Pm2Process[] {
    return this.latestProcesses.get(serverId) || [];
  }

  private async tick(): Promise<void> {
    if (vaultStore.getState() !== 'unlocked') return;
    const servers = vaultStore.listServers();
    for (const server of servers) {
      const status: ServerConnectionStatus = server.isDemo
        ? demoBackend.getStatus()
        : sshPool.getStatus(server.id).status;

      const hasSubscriber = (this.activeSubscribers.get(server.id) || 0) > 0;
      if (status === 'connected' && (hasSubscriber || server.isDemo || true)) {
        // Poll all connected servers so alerts fire even when user is viewing another tab!
        void this.pollServer(server.id);
      }
    }
  }

  public async pollServer(serverId: string): Promise<ServerTelemetrySnapshot | null> {
    if (vaultStore.getState() !== 'unlocked') return null;
    const server = vaultStore.getServer(serverId);
    if (!server) return null;

    const status = server.isDemo
      ? demoBackend.getStatus()
      : sshPool.getStatus(server.id).status;
    if (status !== 'connected') {
      return this.getSnapshot(server);
    }

    if (this.inFlight.has(serverId)) {
      return this.getSnapshot(server);
    }
    this.inFlight.add(serverId);

    try {
      const [host, processes] = await Promise.all([
        this.collectHostMetrics(server).catch(() => null),
        pm2Service.listProcesses(server).catch(() => null),
      ]);

      if (host) {
        this.latestHost.set(serverId, host);
        const arr = this.hostHistory.get(serverId) || [];
        arr.push(host);
        if (arr.length > MAX_HISTORY) arr.shift();
        this.hostHistory.set(serverId, arr);
      }

      if (processes) {
        this.latestProcesses.set(serverId, processes);
        const now = Date.now();
        let procMap = this.processHistory.get(serverId);
        if (!procMap) {
          procMap = new Map();
          this.processHistory.set(serverId, procMap);
        }
        for (const p of processes) {
          const hist = procMap.get(p.name) || [];
          hist.push({ timestamp: now, cpu: p.cpu, memory: p.memory });
          if (hist.length > MAX_HISTORY) hist.shift();
          procMap.set(p.name, hist);
        }
      }

      const finalHost = host || this.latestHost.get(serverId) || null;
      const finalProcs = processes || this.latestProcesses.get(serverId) || [];
      alertService.evaluate(server, finalHost, finalProcs);

      const snapshot = this.getSnapshot(server);
      for (const cb of this.listeners) {
        try {
          cb(snapshot);
        } catch {
          // ignore listener failure
        }
      }
      return snapshot;
    } finally {
      this.inFlight.delete(serverId);
    }
  }

  private async collectHostMetrics(
    server: ServerConfig,
  ): Promise<HostMetrics> {
    if (server.isDemo) {
      return demoBackend.getHostMetrics();
    }

    const cmd = [
      'echo "===STAT==="; head -n 1 /proc/stat',
      'echo "===MEM==="; grep -E "^(MemTotal|MemAvailable):" /proc/meminfo',
      'echo "===DISK==="; df -B1 / | tail -n 1',
      'echo "===LOAD==="; cat /proc/loadavg',
      'echo "===UPTIME==="; cat /proc/uptime',
      'echo "===NET==="; tail -n +3 /proc/net/dev',
      'echo "===HOST==="; hostname; uname -r; nproc; (. /etc/os-release 2>/dev/null && printf "%s" "$PRETTY_NAME" || uname -s)',
    ].join('; ');

    const res = await sshPool.exec(server, `bash -c '${cmd}'`, {
      timeoutMs: 10000,
    });

    return this.parseLinuxMetrics(server.id, res.stdout);
  }

  private parseLinuxMetrics(serverId: string, raw: string): HostMetrics {
    const now = Date.now();
    const sections = new Map<string, string[]>();
    let current = '';
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^===(\w+)===$/);
      if (m) {
        current = m[1];
        sections.set(current, []);
      } else if (current && line.trim()) {
        sections.get(current)!.push(line.trim());
      }
    }

    // CPU from /proc/stat
    const statLine = sections.get('STAT')?.[0] || '';
    const cpuParts = statLine
      .replace(/^cpu\s+/, '')
      .split(/\s+/)
      .map((n) => Number.parseInt(n, 10) || 0);
    const idle = (cpuParts[3] || 0) + (cpuParts[4] || 0);
    const total = cpuParts.reduce((a, b) => a + b, 0);

    // Net from /proc/net/dev
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of sections.get('NET') || []) {
      const [ifacePart, statsPart] = line.split(':');
      if (!ifacePart || !statsPart) continue;
      if (ifacePart.trim() === 'lo') continue;
      const nums = statsPart.trim().split(/\s+/).map(Number);
      rxBytes += nums[0] || 0;
      txBytes += nums[8] || 0;
    }

    const prev = this.prevCounters.get(serverId);
    let cpuPercent = 0;
    let netRxBytesPerSec = 0;
    let netTxBytesPerSec = 0;

    if (prev) {
      const dTotal = total - prev.cpuTotal;
      const dIdle = idle - prev.cpuIdle;
      if (dTotal > 0) {
        cpuPercent = Number(
          Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)).toFixed(1),
        );
      }
      const dtSec = Math.max(0.5, (now - prev.timestamp) / 1000);
      if (rxBytes >= prev.netRxBytes) {
        netRxBytesPerSec = Math.round((rxBytes - prev.netRxBytes) / dtSec);
      }
      if (txBytes >= prev.netTxBytes) {
        netTxBytesPerSec = Math.round((txBytes - prev.netTxBytes) / dtSec);
      }
    }

    this.prevCounters.set(serverId, {
      cpuIdle: idle,
      cpuTotal: total,
      netRxBytes: rxBytes,
      netTxBytes: txBytes,
      timestamp: now,
    });

    // Mem from /proc/meminfo (in kB)
    let memTotalKb = 0;
    let memAvailKb = 0;
    for (const line of sections.get('MEM') || []) {
      const parts = line.split(/\s+/);
      const val = Number.parseInt(parts[1] || '0', 10) || 0;
      if (line.startsWith('MemTotal:')) memTotalKb = val;
      if (line.startsWith('MemAvailable:')) memAvailKb = val;
    }
    const memTotalBytes = memTotalKb * 1024;
    const memUsedBytes = Math.max(0, (memTotalKb - memAvailKb) * 1024);
    const memPercent =
      memTotalBytes > 0
        ? Number(((memUsedBytes / memTotalBytes) * 100).toFixed(1))
        : 0;

    // Disk from df -B1 /
    const diskLine = sections.get('DISK')?.[0] || '';
    const diskCols = diskLine.split(/\s+/);
    const diskTotalBytes = Number.parseInt(diskCols[1] || '0', 10) || 0;
    const diskUsedBytes = Number.parseInt(diskCols[2] || '0', 10) || 0;
    const diskPercent =
      diskTotalBytes > 0
        ? Number(((diskUsedBytes / diskTotalBytes) * 100).toFixed(1))
        : 0;

    // Load average
    const loadCols = (sections.get('LOAD')?.[0] || '0 0 0').split(/\s+/);
    const loadAvg: [number, number, number] = [
      Number.parseFloat(loadCols[0] || '0') || 0,
      Number.parseFloat(loadCols[1] || '0') || 0,
      Number.parseFloat(loadCols[2] || '0') || 0,
    ];

    // Uptime
    const uptimeSeconds = Math.floor(
      Number.parseFloat((sections.get('UPTIME')?.[0] || '0').split(/\s+/)[0]) ||
        0,
    );

    const hostMeta = sections.get('HOST') || [];
    const hostname = hostMeta[0] || serverId;
    const kernel = hostMeta[1] || '';
    const cpuCores = Number.parseInt(hostMeta[2] || '1', 10) || 1;
    const osName = hostMeta[3] || 'Linux';

    return {
      timestamp: now,
      cpuPercent,
      memUsedBytes,
      memTotalBytes,
      memPercent,
      diskUsedBytes,
      diskTotalBytes,
      diskPercent,
      loadAvg,
      uptimeSeconds,
      netRxBytesPerSec,
      netTxBytesPerSec,
      hostname,
      osName,
      kernel,
      cpuCores,
    };
  }
}

export const metricsService = new MetricsService();
