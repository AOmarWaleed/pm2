import { ClientChannel } from 'ssh2';
import { ServerConfig } from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import { buildPm2Command, buildShellCommand, shellEscape } from '../ssh/shellHelpers';
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
    processName?: string;
    lines?: number;
    onChunk: (source: 'stdout' | 'stderr' | 'system', line: string) => void;
    onError: (msg: string) => void;
  }): Promise<void> {
    this.stopStream(params.streamId);

    const lines = Math.max(20, Math.min(500, params.lines || 120));

    if (params.server.isDemo) {
      params.onChunk(
        'system',
        `Streaming demo logs (${params.processName || 'all processes'})...`,
      );
      for (let i = 0; i < 12; i++) {
        const sample = demoBackend.generateLogLine(params.processName);
        params.onChunk(sample.source, sample.line);
      }
      const timer = setInterval(() => {
        const sample = demoBackend.generateLogLine(params.processName);
        params.onChunk(sample.source, sample.line);
      }, 1400);
      this.streams.set(params.streamId, {
        stop: () => clearInterval(timer),
      });
      return;
    }

    let channel: ClientChannel | null = null;
    let closed = false;

    const targetProc = params.processName
      ? metricsService
          .getLatestProcesses(params.server.id)
          .find((p) => p.name === params.processName)
      : undefined;

    let built: { command: string; stdinInput?: string };

    if (targetProc && (targetProc.outLogPath || targetProc.errLogPath)) {
      const outPath = targetProc.outLogPath
        ? shellEscape(targetProc.outLogPath)
        : '';
      const errPath = targetProc.errLogPath
        ? shellEscape(targetProc.errLogPath)
        : '';
      // Tail both out & err files cleanly and kill background tail processes on channel close
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
      const targetArg = params.processName
        ? shellEscape(params.processName)
        : '';
      built = buildPm2Command(
        params.server,
        `logs ${targetArg} --lines ${lines} --raw`.trim(),
      );
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
          params.onChunk('stdout', rawLine.slice(6));
        } else if (rawLine.startsWith('[ERR] ')) {
          params.onChunk('stderr', rawLine.slice(6));
        } else if (rawLine.length > 0) {
          params.onChunk(defaultSource, rawLine);
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
}

export const logStreamService = new LogStreamService();
