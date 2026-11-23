import { ClientChannel } from 'ssh2';
import { HistoricalLogLine, LogSourceType, ServerConfig } from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import {
  buildPm2Command,
  buildShellCommand,
  shellEscape,
} from '../ssh/shellHelpers';
import { sshPool } from '../ssh/sshPool';
import { metricsService } from './metricsService';

interface ActiveLogStream {
  stop: () => void;
}

class LogStreamService {
  private streams = new Map<string, ActiveLogStream>();

  public async startStream(params: {
    streamId: string;
    server: ServerConfig;
    sourceType?: LogSourceType;
    target?: string;
    processName?: string;
    lines?: number;
    onChunk: (
      source: 'stdout' | 'stderr' | 'system',
      line: string,
      timestamp?: number,
    ) => void;
    onError: (msg: string) => void;
  }): Promise<void> {
    this.stopStream(params.streamId);

    const lines = Math.max(20, Math.min(500, params.lines || 150));
    const sourceType: LogSourceType = params.sourceType || 'pm2';
    const target = (params.target ?? params.processName ?? '').trim();

    if (params.server.isDemo) {
      params.onChunk(
        'system',
        `Streaming demo logs [${sourceType}] (${target || 'all'})...`,
        Date.now(),
      );
      const history = demoBackend.generateHistoricalLogs(
        sourceType,
        target,
        15,
        32,
      );
      for (const h of history) {
        params.onChunk(h.source, h.line, h.timestamp);
      }

      if (sourceType !== 'cron') {
        const timer = setInterval(() => {
          const sample = demoBackend.generateLogLine(
            sourceType === 'pm2' ? target || undefined : undefined,
            sourceType,
            target,
          );
          params.onChunk(sample.source, sample.line, sample.timestamp);
        }, 1400);
        this.streams.set(params.streamId, {
          stop: () => clearInterval(timer),
        });
      }
      return;
    }

    let channel: ClientChannel | null = null;
    let closed = false;
    let built: { command: string; stdinInput?: string };

    if (sourceType === 'file' || sourceType === 'cron') {
      if (!target) {
        params.onError('Log file path is required.');
        return;
      }
      const escaped = shellEscape(target);
      const inner = `if [ -f ${escaped} ]; then tail -n ${lines} -F ${escaped}; else echo "File not found: ${target.replace(/"/g, '')}" >&2; exit 1; fi`;
      built = buildShellCommand(params.server, inner, {
        useSudoIfConfigured: params.server.pm2Mode !== 'direct',
      });
    } else {
      const targetProc = target
        ? metricsService
            .getLatestProcesses(params.server.id)
            .find((p) => p.name === target)
        : undefined;

      if (targetProc && (targetProc.outLogPath || targetProc.errLogPath)) {
        const outPath = targetProc.outLogPath
          ? shellEscape(targetProc.outLogPath)
          : '';
        const errPath = targetProc.errLogPath
          ? shellEscape(targetProc.errLogPath)
          : '';
        const inner = [
          'PIDS=""',
          'cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; }',
          'trap cleanup EXIT INT TERM',
          outPath
            ? `if [ -f ${outPath} ]; then tail -n ${lines} -F ${outPath} 2>/dev/null | sed -u 's/^/[OUT] /' & PIDS="$PIDS $!"; fi`
            : '',
          errPath
            ? `if [ -f ${errPath} ]; then tail -n ${lines} -F ${errPath} 2>/dev/null | sed -u 's/^/[ERR] /' >&2 & PIDS="$PIDS $!"; fi`
            : '',
          'if [ -z "$PIDS" ]; then echo "Log files not created yet on disk."; exit 0; fi',
          'wait',
        ]
          .filter(Boolean)
          .join('; ');

        built = buildShellCommand(params.server, inner, {
          useSudoIfConfigured: params.server.pm2Mode !== 'direct',
        });
      } else {
        const targetArg = target ? shellEscape(target) : '';
        built = buildPm2Command(
          params.server,
          `logs ${targetArg} --lines ${lines} --raw`.trim(),
        );
      }
    }

    let outBuffer = '';
    let errBuffer = '';

    const flushLines = (
      buf: string,
      defaultSource: 'stdout' | 'stderr',
    ): string => {
      const parts = buf.split(/\r?\n/);
      const remainder = parts.pop() ?? '';
      for (const rawLine of parts) {
        if (rawLine.startsWith('[OUT] ')) {
          params.onChunk('stdout', rawLine.slice(6), Date.now());
        } else if (rawLine.startsWith('[ERR] ')) {
          params.onChunk('stderr', rawLine.slice(6), Date.now());
        } else if (rawLine.length > 0) {
          params.onChunk(defaultSource, rawLine, Date.now());
        }
      }
      return remainder;
    };

    try {
      channel = await sshPool.spawnStream(params.server, built.command, {
        stdinInput: built.stdinInput,
        onStdout: (chunk) => {
          if (closed) return;
          outBuffer = flushLines(outBuffer + chunk, 'stdout');
        },
        onStderr: (chunk) => {
          if (closed) return;
          errBuffer = flushLines(errBuffer + chunk, 'stderr');
        },
        onClose: () => {
          if (!closed) {
            closed = true;
            this.streams.delete(params.streamId);
          }
        },
        onError: (err) => {
          if (!closed) {
            params.onError(err.message);
          }
        },
      });

      this.streams.set(params.streamId, {
        stop: () => {
          closed = true;
          if (channel) {
            try {
              channel.signal('TERM');
            } catch {
              // ignore
            }
            try {
              channel.close();
            } catch {
              // ignore
            }
          }
        },
      });
    } catch (err) {
      params.onError(err instanceof Error ? err.message : String(err));
    }
  }

  public stopStream(streamId: string): void {
    const existing = this.streams.get(streamId);
    if (existing) {
      existing.stop();
      this.streams.delete(streamId);
    }
  }

  public async fetchHistoricalLogs(
    server: ServerConfig,
    options: {
      sourceType: LogSourceType;
      target: string;
      rangeMinutes: number;
      maxLines: number;
    },
  ): Promise<HistoricalLogLine[]> {
    const maxLines = Math.max(50, Math.min(3000, options.maxLines || 800));
    if (server.isDemo) {
      return demoBackend.generateHistoricalLogs(
        options.sourceType,
        options.target,
        options.rangeMinutes,
        maxLines,
      );
    }

    let built: { command: string; stdinInput?: string };
    const target = options.target.trim();

    if (options.sourceType === 'file' || options.sourceType === 'cron') {
      if (!target) throw new Error('File path target is required.');
      const escaped = shellEscape(target);
      built = buildShellCommand(
        server,
        `if [ -f ${escaped} ]; then tail -n ${maxLines} ${escaped}; else echo "File not found" >&2; exit 1; fi`,
        { useSudoIfConfigured: server.pm2Mode !== 'direct' },
      );
    } else {
      const proc = target
        ? metricsService
            .getLatestProcesses(server.id)
            .find((p) => p.name === target)
        : undefined;

      if (proc && (proc.outLogPath || proc.errLogPath)) {
        const half = Math.ceil(maxLines / 2);
        const cmds: string[] = [];
        if (proc.outLogPath) {
          cmds.push(
            `if [ -f ${shellEscape(proc.outLogPath)} ]; then tail -n ${half} ${shellEscape(proc.outLogPath)} | sed 's/^/[OUT] /'; fi`,
          );
        }
        if (proc.errLogPath) {
          cmds.push(
            `if [ -f ${shellEscape(proc.errLogPath)} ]; then tail -n ${half} ${shellEscape(proc.errLogPath)} | sed 's/^/[ERR] /'; fi`,
          );
        }
        built = buildShellCommand(server, cmds.join('; '), {
          useSudoIfConfigured: server.pm2Mode !== 'direct',
        });
      } else {
        const targetArg = target ? shellEscape(target) : '';
        built = buildPm2Command(
          server,
          `logs ${targetArg} --lines ${maxLines} --nostream --raw`.trim(),
        );
      }
    }

    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
      timeoutMs: 20000,
    });

    const now = Date.now();
    const lines = res.stdout.split(/\r?\n/).filter(Boolean);
    const out: HistoricalLogLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      let raw = lines[i];
      let source: 'stdout' | 'stderr' = 'stdout';
      if (raw.startsWith('[OUT] ')) {
        raw = raw.slice(6);
      } else if (raw.startsWith('[ERR] ')) {
        raw = raw.slice(6);
        source = 'stderr';
      }
      out.push({
        source,
        line: raw,
        timestamp: now - (lines.length - i) * 500,
      });
    }

    return out;
  }
}

export const logStreamService = new LogStreamService();
