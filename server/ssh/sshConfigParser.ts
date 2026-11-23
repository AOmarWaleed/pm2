import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SshConfigImportCandidate } from '@shared/types';

export function expandTilde(inputPath: string): string {
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  return inputPath;
}

export function parseLocalSshConfig(): SshConfigImportCandidate[] {
  const configPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(configPath)) {
    return [];
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  interface WorkingHost {
    aliases: string[];
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
  }

  const blocks: WorkingHost[] = [];
  let current: WorkingHost | null = null;

  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/#.*$/, '').trim();
    if (!cleanLine) continue;

    const match = cleanLine.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^["']|["']$/g, '');

    if (key === 'host') {
      if (current) blocks.push(current);
      const aliases = value
        .split(/\s+/)
        .filter((a) => a && !a.includes('*') && !a.includes('?'));
      current = { aliases };
      continue;
    }

    if (!current) continue;

    if (key === 'hostname') {
      current.hostName = value;
    } else if (key === 'user') {
      current.user = value;
    } else if (key === 'port') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) current.port = parsed;
    } else if (key === 'identityfile' && !current.identityFile) {
      current.identityFile = expandTilde(value);
    }
  }

  if (current) blocks.push(current);

  const candidates: SshConfigImportCandidate[] = [];
  for (const b of blocks) {
    if (b.aliases.length === 0) continue;
    for (const alias of b.aliases) {
      candidates.push({
        alias,
        host: b.hostName || alias,
        port: b.port || 22,
        username: b.user || 'root',
        privateKeyPath: b.identityFile,
      });
    }
  }

  return candidates;
}
