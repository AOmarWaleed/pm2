import fs from 'node:fs';
import { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { ServerConfig, ServerConnectionStatus } from '@shared/types';
import { expandTilde } from './sshConfigParser';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

interface PoolEntry {
  client: Client;
  status: ServerConnectionStatus;
  lastError?: string;
}

export class SshPool {
  private entries = new Map<string, PoolEntry>();
  private connecting = new Map<string, Promise<Client>>();

  public getStatus(serverId: string): {
    status: ServerConnectionStatus;
    lastError?: string;
  } {
    const entry = this.entries.get(serverId);
    if (!entry) {
      return { status: 'disconnected' };
    }
    return { status: entry.status, lastError: entry.lastError };
  }

  private buildConnectConfig(server: ServerConfig): ConnectConfig {
    const config: ConnectConfig = {
      host: server.host,
      port: server.port || 22,
      username: server.username,
      readyTimeout: 12000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    };

    if (server.authMethod === 'password') {
      config.password = server.password || '';
    } else {
      if (server.privateKeyContent) {
        config.privateKey = server.privateKeyContent;
      } else if (server.privateKeyPath) {
        const resolved = expandTilde(server.privateKeyPath);
        if (!fs.existsSync(resolved)) {
          throw new Error(`Private key file not found: ${resolved}`);
        }
        config.privateKey = fs.readFileSync(resolved);
      } else {
        throw new Error('Private key authentication requires key path or content.');
      }
      if (server.passphrase) {
        config.passphrase = server.passphrase;
      }
    }

    return config;
  }

  public async connect(server: ServerConfig): Promise<Client> {
    if (server.isDemo) {
      throw new Error('Demo server does not use real SSH pool.');
    }

    const existing = this.entries.get(server.id);
    if (existing && existing.status === 'connected') {
      return existing.client;
    }

    const inFlight = this.connecting.get(server.id);
    if (inFlight) {
      return inFlight;
    }

    const promise = new Promise<Client>((resolve, reject) => {
      let config: ConnectConfig;
      try {
        config = this.buildConnectConfig(server);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.entries.set(server.id, {
          client: new Client(),
          status: 'error',
          lastError: msg,
        });
        reject(err);
        return;
      }

      const client = new Client();
      this.entries.set(server.id, { client, status: 'connecting' });

      let settled = false;

      client.on('ready', () => {
        settled = true;
        this.entries.set(server.id, { client, status: 'connected' });
        resolve(client);
      });

      client.on('error', (err) => {
        const message = err.message || 'SSH connection error';
        this.entries.set(server.id, {
          client,
          status: 'error',
          lastError: message,
        });
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      client.on('close', () => {
        const current = this.entries.get(server.id);
        if (current && current.client === client && current.status !== 'error') {
          this.entries.set(server.id, {
            client,
            status: 'disconnected',
            lastError: current.lastError,
          });
        }
      });

      client.on('end', () => {
        const current = this.entries.get(server.id);
        if (current && current.client === client && current.status === 'connected') {
          this.entries.set(server.id, {
            client,
            status: 'disconnected',
          });
        }
      });

      client.connect(config);
    }).finally(() => {
      this.connecting.delete(server.id);
    });

    this.connecting.set(server.id, promise);
    return promise;
  }

  public disconnect(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (entry) {
      try {
        entry.client.end();
      } catch {
        // ignore
      }
      this.entries.delete(serverId);
    }
  }

  public disconnectAll(): void {
    for (const id of [...this.entries.keys()]) {
      this.disconnect(id);
    }
  }

  public async exec(
    server: ServerConfig,
    command: string,
    options?: { stdinInput?: string; timeoutMs?: number },
  ): Promise<ExecResult> {
    const client = await this.connect(server);
    return new Promise<ExecResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finished = false;

      const timeoutMs = options?.timeoutMs ?? 25000;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          if (!finished) {
            finished = true;
            reject(err);
          }
          return;
        }

        if (options?.stdinInput) {
          stream.write(options.stdinInput);
        }
        stream.end();

        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          if (!finished) {
            finished = true;
            resolve({ stdout, stderr, code });
          }
        });
      });
    });
  }

  public async execTransient(
    server: ServerConfig,
    command: string,
    options?: { stdinInput?: string },
  ): Promise<ExecResult> {
    const client = new Client();
    const config = this.buildConnectConfig(server);
    return new Promise<ExecResult>((resolve, reject) => {
      let settled = false;
      client.on('ready', () => {
        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            if (!settled) {
              settled = true;
              reject(err);
            }
            return;
          }
          let stdout = '';
          let stderr = '';
          if (options?.stdinInput) {
            stream.write(options.stdinInput);
          }
          stream.end();
          stream.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
          });
          stream.on('close', (code: number | null) => {
            client.end();
            if (!settled) {
              settled = true;
              resolve({ stdout, stderr, code });
            }
          });
        });
      });
      client.on('error', (err) => {
        client.end();
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      client.connect(config);
    });
  }

  public async spawnStream(
    server: ServerConfig,
    command: string,
    handlers: {
      stdinInput?: string;
      onStdout: (chunk: string) => void;
      onStderr: (chunk: string) => void;
      onClose: (code: number | null) => void;
      onError: (err: Error) => void;
    },
  ): Promise<ClientChannel> {
    const client = await this.connect(server);
    return new Promise<ClientChannel>((resolve, reject) => {
      client.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        if (handlers.stdinInput) {
          stream.write(handlers.stdinInput);
        }
        stream.on('data', (chunk: Buffer) => {
          handlers.onStdout(chunk.toString('utf8'));
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          handlers.onStderr(chunk.toString('utf8'));
        });
        stream.on('close', (code: number | null) => {
          handlers.onClose(code);
        });
        stream.on('error', (streamErr: Error) => {
          handlers.onError(streamErr);
        });
        resolve(stream);
      });
    });
  }

  public async openShell(
    server: ServerConfig,
    cols: number,
    rows: number,
  ): Promise<ClientChannel> {
    const client = await this.connect(server);
    return new Promise<ClientChannel>((resolve, reject) => {
      client.shell(
        { term: 'xterm-256color', cols: cols || 100, rows: rows || 30 },
        (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(stream);
        },
      );
    });
  }

  public async getSftp(server: ServerConfig): Promise<SFTPWrapper> {
    const client = await this.connect(server);
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(sftp);
      });
    });
  }
}

export const sshPool = new SshPool();
