import {
  Pm2Action,
  Pm2Process,
  Pm2ProcessStatus,
  ServerConfig,
  ServerDetectResult,
  StartNewAppInput,
} from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import {
  buildPm2Command,
  buildShellCommand,
  extractJsonArray,
  resolvePm2BinaryExpression,
  shellEscape,
} from '../ssh/shellHelpers';
import { sshPool } from '../ssh/sshPool';
import { sftpService } from './sftpService';

interface RawPm2Item {
  pm_id?: number;
  name?: string;
  pid?: number;
  monit?: {
    cpu?: number;
    memory?: number;
  };
  pm2_env?: {
    namespace?: string;
    status?: string;
    pm_uptime?: number;
    created_at?: number;
    restart_time?: number;
    unstable_restarts?: number;
    exec_mode?: string;
    instances?: number | string;
    watch?: boolean | string[];
    pm_exec_path?: string;
    pm_cwd?: string;
    args?: string[];
    exec_interpreter?: string;
    node_version?: string;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
    cron_restart?: string;
    env?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

function normalizeStatus(raw?: string): Pm2ProcessStatus {
  switch (raw) {
    case 'online':
    case 'stopped':
    case 'stopping':
    case 'waiting restart':
    case 'launching':
    case 'errored':
    case 'one-launch-status':
      return raw;
    default:
      return 'unknown';
  }
}

function normalizeEnv(pm2Env?: RawPm2Item['pm2_env']): Record<string, string> {
  const result: Record<string, string> = {};
  if (!pm2Env) return result;
  const source =
    pm2Env.env && typeof pm2Env.env === 'object' ? pm2Env.env : pm2Env;

  const skipKeys = new Set([
    'pm_id',
    'pm_cwd',
    'pm_exec_path',
    'pm_out_log_path',
    'pm_err_log_path',
    'pm_pid_path',
    'env',
    'args',
    'axm_actions',
    'axm_monitor',
    'axm_options',
    'axm_dynamic',
    'versioning',
  ]);

  for (const [k, v] of Object.entries(source)) {
    if (skipKeys.has(k)) continue;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      result[k] = String(v);
    }
  }
  return result;
}

export class Pm2Service {
  public async detectEnvironment(
    server: ServerConfig,
    transient = false,
  ): Promise<ServerDetectResult> {
    if (server.isDemo) {
      return demoBackend.detect();
    }

    const pm2Bin = resolvePm2BinaryExpression(server);
    const probeInner = [
      'OS=$(. /etc/os-release 2>/dev/null && printf "%s" "$PRETTY_NAME" || uname -s)',
      'KERNEL=$(uname -r)',
      'HOST=$(hostname)',
      'NODE_V=$(node -v 2>/dev/null || echo "")',
      `PM2_BIN_RESOLVED=$(command -v ${pm2Bin} 2>/dev/null || echo ${server.pm2Path ? shellEscape(server.pm2Path) : '""'})`,
      'PM2_V=""',
      'if [ -n "$PM2_BIN_RESOLVED" ]; then PM2_V=$("$PM2_BIN_RESOLVED" -v 2>/dev/null | tail -n 1); fi',
      'printf "WATCHPM2_META:%s|%s|%s|%s|%s|%s\\n" "$OS" "$KERNEL" "$HOST" "$NODE_V" "$PM2_BIN_RESOLVED" "$PM2_V"',
    ].join('; ');

    const built = buildShellCommand(server, probeInner, {
      useSudoIfConfigured: server.pm2Mode !== 'direct',
    });

    try {
      const execRes = transient
        ? await sshPool.execTransient(server, built.command, {
            stdinInput: built.stdinInput,
          })
        : await sshPool.exec(server, built.command, {
            stdinInput: built.stdinInput,
          });

      const line = execRes.stdout
        .split(/\r?\n/)
        .find((l) => l.startsWith('WATCHPM2_META:'));

      if (!line) {
        return {
          reachable: true,
          osName: 'Linux',
          kernel: '',
          hostname: server.host,
          nodeVersion: null,
          pm2Version: null,
          pm2Path: null,
          processCount: null,
          error:
            execRes.stderr.trim() || 'Could not inspect remote environment.',
        };
      }

      const [, payload] = line.split('WATCHPM2_META:');
      const [osName, kernel, hostname, nodeVersion, pm2Path, pm2Version] =
        payload.split('|');

      let processCount: number | null = null;
      let hint: string | undefined;

      if (pm2Version) {
        try {
          const procs = await this.listProcesses(server, transient);
          processCount = procs.length;
        } catch (err) {
          hint =
            err instanceof Error
              ? err.message
              : 'PM2 found, but failed to list processes.';
        }
      } else {
        hint =
          'PM2 binary was not found in PATH. Set custom pm2 path or switch PM2 Execution Mode (sudo / target user).';
      }

      return {
        reachable: true,
        osName: osName || 'Linux',
        kernel: kernel || '',
        hostname: hostname || server.host,
        nodeVersion: nodeVersion || null,
        pm2Version: pm2Version || null,
        pm2Path: pm2Path || null,
        processCount,
        hint,
      };
    } catch (err) {
      return {
        reachable: false,
        osName: '',
        kernel: '',
        hostname: server.host,
        nodeVersion: null,
        pm2Version: null,
        pm2Path: null,
        processCount: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async listProcesses(
    server: ServerConfig,
    transient = false,
  ): Promise<Pm2Process[]> {
    if (server.isDemo) {
      return demoBackend.listProcesses();
    }

    const built = buildPm2Command(server, 'jlist');
    const res = transient
      ? await sshPool.execTransient(server, built.command, {
          stdinInput: built.stdinInput,
        })
      : await sshPool.exec(server, built.command, {
          stdinInput: built.stdinInput,
        });

    if (res.code !== 0 && !res.stdout.includes('[')) {
      throw new Error(
        res.stderr.trim() || res.stdout.trim() || `pm2 jlist exited ${res.code}`,
      );
    }

    const rawList = extractJsonArray(res.stdout) as RawPm2Item[];
    return rawList.map((item) => {
      const env = item.pm2_env || {};
      const status = normalizeStatus(env.status);
      return {
        pm_id: typeof item.pm_id === 'number' ? item.pm_id : 0,
        name: item.name || `app-${item.pm_id ?? 0}`,
        namespace: String(env.namespace || 'default'),
        status,
        pid: typeof item.pid === 'number' ? item.pid : 0,
        cpu: typeof item.monit?.cpu === 'number' ? item.monit.cpu : 0,
        memory: typeof item.monit?.memory === 'number' ? item.monit.memory : 0,
        uptime:
          status === 'online' && typeof env.pm_uptime === 'number'
            ? env.pm_uptime
            : 0,
        createdAt: typeof env.created_at === 'number' ? env.created_at : 0,
        restarts: typeof env.restart_time === 'number' ? env.restart_time : 0,
        unstableRestarts:
          typeof env.unstable_restarts === 'number' ? env.unstable_restarts : 0,
        execMode: String(env.exec_mode || 'fork_mode'),
        instances: env.instances ?? 1,
        watching: Boolean(env.watch),
        script: String(env.pm_exec_path || ''),
        cwd: String(env.pm_cwd || ''),
        args: Array.isArray(env.args) ? env.args.map(String) : [],
        interpreter: String(env.exec_interpreter || 'node'),
        nodeVersion: String(env.node_version || ''),
        outLogPath: String(env.pm_out_log_path || ''),
        errLogPath: String(env.pm_err_log_path || ''),
        cronRestart:
          typeof env.cron_restart === 'string' && env.cron_restart.trim()
            ? env.cron_restart.trim()
            : undefined,
        env: normalizeEnv(env),
      };
    });
  }

  public async performAction(
    server: ServerConfig,
    target: string,
    action: Pm2Action,
  ): Promise<string> {
    const allowed: Pm2Action[] = [
      'start',
      'stop',
      'restart',
      'reload',
      'delete',
      'flush',
    ];
    if (!allowed.includes(action)) {
      throw new Error(`Unsupported PM2 action: ${action}`);
    }

    if (server.isDemo) {
      return demoBackend.performAction(target, action);
    }

    const escapedTarget = target === 'all' ? 'all' : shellEscape(target);
    const extraFlag = action === 'restart' || action === 'reload' ? ' --update-env' : '';
    const built = buildPm2Command(server, `${action} ${escapedTarget}${extraFlag}`);
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });

    if (res.code !== 0) {
      throw new Error(
        res.stderr.trim() || res.stdout.trim() || `PM2 ${action} failed`,
      );
    }
    return res.stdout.trim() || `[PM2] ${action} ${target} completed.`;
  }

  public async bulkAction(
    server: ServerConfig,
    targets: string[],
    action: Pm2Action,
  ): Promise<string[]> {
    const outputs: string[] = [];
    for (const t of targets) {
      const out = await this.performAction(server, t, action);
      outputs.push(out);
    }
    return outputs;
  }

  public async scaleProcess(
    server: ServerConfig,
    name: string,
    instances: number | 'max',
  ): Promise<string> {
    if (server.isDemo) {
      const count = instances === 'max' ? 4 : Number(instances);
      return demoBackend.scaleProcess(name, count);
    }

    const instArg = instances === 'max' ? 'max' : String(Math.max(1, Math.floor(instances)));
    const built = buildPm2Command(server, `scale ${shellEscape(name)} ${instArg}`);
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || 'PM2 scale failed');
    }
    return res.stdout.trim() || `Scaled ${name} to ${instArg}`;
  }

  public async startNewApp(
    server: ServerConfig,
    input: StartNewAppInput,
  ): Promise<string> {
    if (!input.name.trim() || !input.script.trim()) {
      throw new Error('Process name and script path are required.');
    }

    if (server.isDemo) {
      const proc = demoBackend.startNewApp(input);
      return `[PM2] Started ${proc.name} (id ${proc.pm_id})`;
    }

    const args: string[] = ['start', shellEscape(input.script.trim())];
    args.push('--name', shellEscape(input.name.trim()));

    if (input.cwd?.trim()) {
      args.push('--cwd', shellEscape(input.cwd.trim()));
    }
    if (input.execMode === 'cluster') {
      args.push('-i', String(input.instances ?? 'max'));
    }
    if (input.interpreter?.trim()) {
      args.push('--interpreter', shellEscape(input.interpreter.trim()));
    }
    if (input.maxMemoryRestart?.trim()) {
      args.push('--max-memory-restart', shellEscape(input.maxMemoryRestart.trim()));
    }
    if (input.watch) {
      args.push('--watch');
    }
    if (input.args?.trim()) {
      args.push('--', input.args.trim());
    }

    const envPrefix = input.env
      ? Object.entries(input.env)
          .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
          .map(([k, v]) => `${k}=${shellEscape(v)}`)
          .join(' ') + ' '
      : '';

    const pm2Bin = resolvePm2BinaryExpression(server);
    const innerCmd = `${envPrefix}${pm2Bin} ${args.join(' ')}`;
    const built = buildShellCommand(server, innerCmd, {
      useSudoIfConfigured: true,
      cwd: input.cwd?.trim() || server.defaultCwd,
    });

    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || 'PM2 start failed');
    }
    return res.stdout.trim() || `Started ${input.name}`;
  }

  public async applyEcosystem(
    server: ServerConfig,
    filePath: string,
    content: string | undefined,
    action: 'startOrReload' | 'start',
  ): Promise<string> {
    if (!filePath.trim()) {
      throw new Error('Ecosystem file path is required.');
    }

    if (content !== undefined) {
      await sftpService.writeFile(server, filePath.trim(), content);
    }

    if (server.isDemo) {
      return `[PM2 Demo] Applied ${action} on ${filePath.trim()}`;
    }

    const built = buildPm2Command(
      server,
      `${action} ${shellEscape(filePath.trim())} --update-env`,
    );
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(
        res.stderr.trim() || res.stdout.trim() || `PM2 ${action} failed`,
      );
    }
    return res.stdout.trim() || `Applied ${action} on ${filePath}`;
  }

  public async saveDump(server: ServerConfig): Promise<string> {
    if (server.isDemo) {
      return '[PM2 Demo] Process list saved to /home/deploy/.pm2/dump.pm2';
    }
    const built = buildPm2Command(server, 'save --force');
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || 'pm2 save failed');
    }
    return res.stdout.trim() || 'PM2 process list saved.';
  }

  public async resurrectDump(server: ServerConfig): Promise<string> {
    if (server.isDemo) {
      return '[PM2 Demo] Restored processes from dump.pm2';
    }
    const built = buildPm2Command(server, 'resurrect');
    const res = await sshPool.exec(server, built.command, {
      stdinInput: built.stdinInput,
    });
    if (res.code !== 0) {
      throw new Error(
        res.stderr.trim() || res.stdout.trim() || 'pm2 resurrect failed',
      );
    }
    return res.stdout.trim() || 'PM2 processes resurrected.';
  }
}

export const pm2Service = new Pm2Service();
