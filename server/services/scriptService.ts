import { ClientChannel } from 'ssh2';
import { ScriptRunRecord, ServerConfig } from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import { buildShellCommand } from '../ssh/shellHelpers';
import { sshPool } from '../ssh/sshPool';

interface ActiveScriptRun {
  cancel: () => void;
}

class ScriptService {
  private activeRuns = new Map<string, ActiveScriptRun>();
  private history: ScriptRunRecord[] = [];

  public listHistory(): ScriptRunRecord[] {
    return [...this.history];
  }

  private pushHistory(record: ScriptRunRecord): void {
    const idx = this.history.findIndex((r) => r.id === record.id);
    if (idx !== -1) {
      this.history[idx] = record;
    } else {
      this.history.unshift(record);
      if (this.history.length > 60) this.history = this.history.slice(0, 60);
    }
  }

  public async runScript(params: {
    runId: string;
    server: ServerConfig;
    scriptId?: string;
    name: string;
    command: string;
    cwd?: string;
    onOutput: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => void;
    onDone: (
      exitCode: number | null,
      status: 'success' | 'failed' | 'cancelled',
    ) => void;
  }): Promise<void> {
    const record: ScriptRunRecord = {
      id: params.runId,
      scriptId: params.scriptId,
      scriptName: params.name,
      serverId: params.server.id,
      serverName: params.server.name,
      command: params.command,
      cwd: params.cwd || params.server.defaultCwd,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      outputPreview: '',
    };
    this.pushHistory(record);

    const appendPreview = (txt: string) => {
      record.outputPreview = (record.outputPreview + txt).slice(-1500);
    };

    if (params.server.isDemo) {
      params.onOutput(
        'system',
        `Running on ${params.server.name}${record.cwd ? ` (${record.cwd})` : ''}...\n$ ${params.command}\n`,
      );
      const lines = params.command.split('&&').map((s) => s.trim());
      let cancelled = false;
      this.activeRuns.set(params.runId, {
        cancel: () => {
          cancelled = true;
        },
      });

      setTimeout(() => {
        if (cancelled) {
          record.status = 'cancelled';
          record.finishedAt = Date.now();
          this.activeRuns.delete(params.runId);
          params.onDone(null, 'cancelled');
          return;
        }
        let exitCode = 0;
        for (const cmd of lines) {
          const res = demoBackend.runShellCommand(
            cmd,
            record.cwd || '/home/deploy/app',
          );
          if (res.stdout) {
            appendPreview(res.stdout);
            params.onOutput('stdout', res.stdout);
          }
          if (res.stderr) {
            appendPreview(res.stderr);
            params.onOutput('stderr', res.stderr);
          }
          if (res.code !== 0) {
            exitCode = res.code;
            break;
          }
        }
        record.exitCode = exitCode;
        record.status = exitCode === 0 ? 'success' : 'failed';
        record.finishedAt = Date.now();
        this.activeRuns.delete(params.runId);
        params.onDone(exitCode, record.status);
      }, 450);
      return;
    }

    const built = buildShellCommand(params.server, params.command, {
      useSudoIfConfigured: params.server.pm2Mode !== 'direct',
      cwd: record.cwd,
    });

    let cancelled = false;
    let channel: ClientChannel | null = null;

    params.onOutput(
      'system',
      `Running on ${params.server.name}${record.cwd ? ` (${record.cwd})` : ''}...\n$ ${params.command}\n`,
    );

    try {
      channel = await sshPool.spawnStream(params.server, built.command, {
        stdinInput: built.stdinInput,
        onStdout: (chunk) => {
          appendPreview(chunk);
          params.onOutput('stdout', chunk);
        },
        onStderr: (chunk) => {
          appendPreview(chunk);
          params.onOutput('stderr', chunk);
        },
        onClose: (code) => {
          this.activeRuns.delete(params.runId);
          record.exitCode = code;
          record.finishedAt = Date.now();
          record.status = cancelled
            ? 'cancelled'
            : code === 0
              ? 'success'
              : 'failed';
          params.onDone(code, record.status);
        },
        onError: (err) => {
          appendPreview(err.message);
          params.onOutput('stderr', `\n${err.message}\n`);
        },
      });

      this.activeRuns.set(params.runId, {
        cancel: () => {
          cancelled = true;
          if (channel) {
            try {
              channel.signal('INT');
              channel.close();
            } catch {
              // ignore
            }
          }
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPreview(msg);
      params.onOutput('stderr', `${msg}\n`);
      record.status = 'failed';
      record.finishedAt = Date.now();
      this.activeRuns.delete(params.runId);
      params.onDone(1, 'failed');
    }
  }

  public cancelRun(runId: string): void {
    this.activeRuns.get(runId)?.cancel();
  }
}

export const scriptService = new ScriptService();
