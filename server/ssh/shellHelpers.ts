import { ServerConfig } from '@shared/types';

export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Generates bash snippet that discovers Node/PM2 across nvm, fnm, volta, and standard paths
 * on non-interactive SSH shells.
 */
export function buildPathBootstrap(server: ServerConfig): string {
  const parts = [
    'export PATH="$HOME/.volta/bin:$HOME/.fnm/current/bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"',
    'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
    'for _d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$_d" ] && PATH="$_d:$PATH"; done',
  ];
  if (server.pm2Home) {
    parts.push(`export PM2_HOME=${shellEscape(server.pm2Home)}`);
  }
  return parts.join('; ');
}

export function resolvePm2BinaryExpression(server: ServerConfig): string {
  if (server.pm2Path) {
    return shellEscape(server.pm2Path);
  }
  return 'pm2';
}

export function buildShellCommand(
  server: ServerConfig,
  innerCommand: string,
  options?: { useSudoIfConfigured?: boolean; cwd?: string },
): { command: string; stdinInput?: string } {
  const bootstrap = buildPathBootstrap(server);
  const cdPrefix = options?.cwd ? `cd ${shellEscape(options.cwd)} && ` : '';
  const fullInner = `${bootstrap}; ${cdPrefix}${innerCommand}`;

  if (options?.useSudoIfConfigured) {
    const hasSudoPw = Boolean(server.sudoPassword);
    const sudoPassFlag = hasSudoPw ? '-S -p "" ' : '';

    if (server.pm2Mode === 'sudo') {
      return {
        command: `sudo ${sudoPassFlag}-E bash -lc ${shellEscape(fullInner)}`,
        stdinInput: hasSudoPw ? `${server.sudoPassword}\n` : undefined,
      };
    }

    if (server.pm2Mode === 'sudo-user' && server.pm2TargetUser) {
      return {
        command: `sudo ${sudoPassFlag}-H -u ${shellEscape(server.pm2TargetUser)} bash -lc ${shellEscape(fullInner)}`,
        stdinInput: hasSudoPw ? `${server.sudoPassword}\n` : undefined,
      };
    }
  }

  return {
    command: `bash -lc ${shellEscape(fullInner)}`,
  };
}

export function buildPm2Command(
  server: ServerConfig,
  pm2Args: string,
  cwd?: string,
): { command: string; stdinInput?: string } {
  const pm2Bin = resolvePm2BinaryExpression(server);
  return buildShellCommand(server, `${pm2Bin} ${pm2Args}`, {
    useSudoIfConfigured: true,
    cwd,
  });
}

export function extractJsonArray(rawOutput: string): unknown[] {
  const trimmed = rawOutput.trim();
  if (!trimmed) return [];

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) {
    throw new Error(
      `Expected JSON array from PM2, got: ${trimmed.slice(0, 200)}`,
    );
  }

  const slice = trimmed.slice(firstBracket, lastBracket + 1);
  const parsed = JSON.parse(slice);
  if (!Array.isArray(parsed)) {
    throw new Error('PM2 jlist output did not parse to an array.');
  }
  return parsed;
}
