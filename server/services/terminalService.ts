import { ClientChannel } from 'ssh2';
import { ServerConfig } from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import { shellEscape } from '../ssh/shellHelpers';
import { sshPool } from '../ssh/sshPool';

interface TerminalSession {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  public async openSession(params: {
    sessionId: string;
    server: ServerConfig;
    cols: number;
    rows: number;
    initialCwd?: string;
    onData: (data: string) => void;
    onClosed: (reason?: string) => void;
  }): Promise<void> {
    this.closeSession(params.sessionId);

    if (params.server.isDemo) {
      this.openDemoSession(params);
      return;
    }

    try {
      const stream: ClientChannel = await sshPool.openShell(
        params.server,
        params.cols,
        params.rows,
      );

      stream.on('data', (chunk: Buffer) => {
        params.onData(chunk.toString('utf8'));
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        params.onData(chunk.toString('utf8'));
      });
      stream.on('close', () => {
        this.sessions.delete(params.sessionId);
        params.onClosed('SSH shell closed.');
      });

      if (params.initialCwd) {
        stream.write(`cd ${shellEscape(params.initialCwd)}\n`);
      }

      this.sessions.set(params.sessionId, {
        write: (data) => {
          stream.write(data);
        },
        resize: (cols, rows) => {
          try {
            stream.setWindow(rows, cols, 0, 0);
          } catch {
            // ignore
          }
        },
        close: () => {
          try {
            stream.end('exit\n');
            stream.close();
          } catch {
            // ignore
          }
        },
      });
    } catch (err) {
      params.onClosed(err instanceof Error ? err.message : String(err));
    }
  }

  private openDemoSession(params: {
    sessionId: string;
    initialCwd?: string;
    onData: (data: string) => void;
    onClosed: (reason?: string) => void;
  }): void {
    let cwd = params.initialCwd || '/home/deploy/app';
    let lineBuf = '';

    const prompt = () =>
      `\x1b[32mdeploy@prod-eu-node-01\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `;

    params.onData(
      `\x1b[36mWatchPM2 Interactive Demo Terminal\x1b[0m\r\nType \x1b[33mhelp\x1b[0m to inspect available demo commands.\r\n${prompt()}`,
    );

    this.sessions.set(params.sessionId, {
      write: (data) => {
        for (const ch of data) {
          if (ch === '\r' || ch === '\n') {
            params.onData('\r\n');
            const cmd = lineBuf.trim();
            lineBuf = '';
            if (cmd === 'clear') {
              params.onData('\x1b[2J\x1b[H');
            } else if (cmd === 'exit') {
              this.closeSession(params.sessionId);
              params.onClosed('Exited demo shell.');
              return;
            } else if (cmd.length > 0) {
              const res = demoBackend.runShellCommand(cmd, cwd);
              if (res.nextCwd) cwd = res.nextCwd;
              if (res.stdout) {
                params.onData(res.stdout.replace(/\n/g, '\r\n'));
              }
              if (res.stderr) {
                params.onData(
                  `\x1b[31m${res.stderr.replace(/\n/g, '\r\n')}\x1b[0m`,
                );
              }
            }
            params.onData(prompt());
          } else if (ch === '\x7f' || ch === '\b') {
            if (lineBuf.length > 0) {
              lineBuf = lineBuf.slice(0, -1);
              params.onData('\b \b');
            }
          } else if (ch === '\x03') {
            lineBuf = '';
            params.onData(`^C\r\n${prompt()}`);
          } else if (ch === '\x0c') {
            params.onData('\x1b[2J\x1b[H' + prompt() + lineBuf);
          } else if (ch >= ' ') {
            lineBuf += ch;
            params.onData(ch);
          }
        }
      },
      resize: () => {
        // no-op in demo emulator
      },
      close: () => {
        this.sessions.delete(params.sessionId);
      },
    });
  }

  public sendInput(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.resize(cols, rows);
  }

  public closeSession(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.close();
      this.sessions.delete(sessionId);
    }
  }
}

export const terminalService = new TerminalService();
