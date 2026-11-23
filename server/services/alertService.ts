import crypto from 'node:crypto';
import {
  AlertEvent,
  AlertRule,
  AlertSeverity,
  HostMetrics,
  Pm2Process,
  ServerConfig,
  WebhookConfig,
} from '@shared/types';
import { vaultStore } from '../vault/vaultStore';

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

class AlertService {
  private lastProcesses = new Map<string, Map<string, Pm2Process>>();
  private cooldownMap = new Map<string, number>();
  private eventListeners = new Set<(event: AlertEvent) => void>();

  public onAlertFired(cb: (event: AlertEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  public resetServerBaseline(serverId: string): void {
    this.lastProcesses.delete(serverId);
  }

  public evaluate(
    server: ServerConfig,
    host: HostMetrics | null,
    processes: Pm2Process[],
  ): void {
    if (vaultStore.getState() !== 'unlocked') return;

    const rules = vaultStore
      .listAlertRules()
      .filter(
        (r) =>
          r.enabled &&
          (!r.environmentFilter ||
            r.environmentFilter === 'all' ||
            r.environmentFilter === server.environment),
      );

    const prevMap = this.lastProcesses.get(server.id);
    const nextMap = new Map<string, Pm2Process>();
    for (const p of processes) {
      nextMap.set(p.name, p);
    }
    this.lastProcesses.set(server.id, nextMap);

    for (const rule of rules) {
      if (rule.type === 'process_down') {
        for (const proc of processes) {
          const prev = prevMap?.get(proc.name);
          const becameBad =
            proc.status === 'errored' ||
            (prev && prev.status === 'online' && proc.status === 'stopped');
          if (becameBad) {
            this.triggerRule(
              rule,
              server,
              proc.name,
              'critical',
              `Process "${proc.name}" is ${proc.status} on ${server.name} (${server.environment}).`,
            );
          }
        }
      } else if (rule.type === 'restart_spike' && prevMap) {
        for (const proc of processes) {
          const prev = prevMap.get(proc.name);
          if (!prev) continue;
          const delta = proc.restarts - prev.restarts;
          if (delta >= rule.threshold) {
            this.triggerRule(
              rule,
              server,
              proc.name,
              'warning',
              `Process "${proc.name}" restarted ${delta} time(s) (total ${proc.restarts}) on ${server.name}.`,
            );
          }
        }
      } else if (rule.type === 'high_cpu') {
        if (host && host.cpuPercent >= rule.threshold) {
          this.triggerRule(
            rule,
            server,
            undefined,
            'warning',
            `Host CPU reached ${host.cpuPercent.toFixed(1)}% (threshold ${rule.threshold}%) on ${server.name}.`,
          );
        }
        for (const proc of processes) {
          if (proc.status === 'online' && proc.cpu >= rule.threshold) {
            this.triggerRule(
              rule,
              server,
              proc.name,
              'warning',
              `Process "${proc.name}" CPU reached ${proc.cpu.toFixed(1)}% on ${server.name}.`,
            );
          }
        }
      } else if (rule.type === 'high_memory') {
        for (const proc of processes) {
          const mb = proc.memory / (1024 * 1024);
          if (proc.status === 'online' && mb >= rule.threshold) {
            this.triggerRule(
              rule,
              server,
              proc.name,
              'warning',
              `Process "${proc.name}" memory reached ${Math.round(mb)} MB (threshold ${rule.threshold} MB) on ${server.name}.`,
            );
          }
        }
      }
    }
  }

  private triggerRule(
    rule: AlertRule,
    server: ServerConfig,
    processName: string | undefined,
    severity: AlertSeverity,
    message: string,
  ): void {
    const key = `${rule.id}:${server.id}:${processName || 'host'}`;
    const now = Date.now();
    const lastFired = this.cooldownMap.get(key) || 0;
    if (now - lastFired < rule.cooldownSeconds * 1000) {
      return;
    }
    this.cooldownMap.set(key, now);

    const event: AlertEvent = {
      id: `alt-${crypto.randomUUID().slice(0, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      severity,
      serverId: server.id,
      serverName: server.name,
      environment: server.environment,
      processName,
      message,
      timestamp: now,
      acknowledged: false,
    };

    try {
      vaultStore.appendAlertEvent(event);
    } catch {
      return;
    }

    for (const cb of this.eventListeners) {
      try {
        cb(event);
      } catch {
        // ignore listener failure
      }
    }

    void this.dispatchWebhooks(event);
  }

  private async dispatchWebhooks(event: AlertEvent): Promise<void> {
    let webhooks: WebhookConfig[] = [];
    try {
      webhooks = vaultStore.listWebhooks().filter((w) => w.enabled);
    } catch {
      return;
    }

    for (const wh of webhooks) {
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[wh.minSeverity]) {
        continue;
      }
      try {
        await this.sendWebhook(wh, event);
      } catch {
        // Do not crash app on external webhook errors
      }
    }
  }

  public async testWebhook(webhook: WebhookConfig): Promise<void> {
    const sampleEvent: AlertEvent = {
      id: 'alt-test',
      ruleId: 'test',
      ruleName: 'WatchPM2 Test Alert',
      type: 'process_down',
      severity: 'info',
      serverId: 'test',
      serverName: 'WatchPM2 Test Node',
      environment: 'production',
      processName: 'api-gateway',
      message: 'This is a test notification from WatchPM2.',
      timestamp: Date.now(),
      acknowledged: true,
    };
    await this.sendWebhook(webhook, sampleEvent);
  }

  private async sendWebhook(
    wh: WebhookConfig,
    event: AlertEvent,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const prefix = `[WatchPM2 • ${event.severity.toUpperCase()} • ${event.environment}]`;
      const text = `${prefix}\nServer: ${event.serverName}\n${event.processName ? `Process: ${event.processName}\n` : ''}${event.message}`;

      if (wh.provider === 'telegram') {
        if (!wh.telegramBotToken || !wh.telegramChatId) {
          throw new Error('Telegram bot token and chat ID are required.');
        }
        const res = await fetch(
          `https://api.telegram.org/bot${wh.telegramBotToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: wh.telegramChatId,
              text,
            }),
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          throw new Error(`Telegram API returned ${res.status}`);
        }
        return;
      }

      if (!wh.url) {
        throw new Error('Webhook URL is required.');
      }

      let body: unknown;
      if (wh.provider === 'discord') {
        const color =
          event.severity === 'critical'
            ? 0xef4444
            : event.severity === 'warning'
              ? 0xf59e0b
              : 0x10b981;
        body = {
          embeds: [
            {
              title: `${prefix} ${event.ruleName}`,
              description: event.message,
              color,
              fields: [
                { name: 'Server', value: event.serverName, inline: true },
                {
                  name: 'Process',
                  value: event.processName || 'Host',
                  inline: true,
                },
              ],
              timestamp: new Date(event.timestamp).toISOString(),
            },
          ],
        };
      } else if (wh.provider === 'slack') {
        body = { text };
      } else {
        body = event;
      }

      const res = await fetch(wh.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Webhook returned HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export const alertService = new AlertService();
