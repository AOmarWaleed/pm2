import path from 'node:path';
import { FileEntry, FileReadResult, ServerConfig } from '@shared/types';
import { demoBackend } from '../ssh/demoBackend';
import { sshPool } from '../ssh/sshPool';

const MAX_EDITABLE_BYTES = 2 * 1024 * 1024; // 2 MB

function formatPermissions(mode: number, isDir: boolean): string {
  const perms = [
    isDir ? 'd' : '-',
    mode & 0o400 ? 'r' : '-',
    mode & 0o200 ? 'w' : '-',
    mode & 0o100 ? 'x' : '-',
    mode & 0o040 ? 'r' : '-',
    mode & 0o020 ? 'w' : '-',
    mode & 0o010 ? 'x' : '-',
    mode & 0o004 ? 'r' : '-',
    mode & 0o002 ? 'w' : '-',
    mode & 0o001 ? 'x' : '-',
  ];
  return perms.join('');
}

export class SftpService {
  public async listDir(server: ServerConfig, dirPath: string): Promise<FileEntry[]> {
    const target = dirPath || server.defaultCwd || '/';
    if (server.isDemo) {
      return demoBackend.listDir(target);
    }

    const sftp = await sshPool.getSftp(server);
    return new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(target, (err, list) => {
        if (err) {
          reject(err);
          return;
        }
        const entries: FileEntry[] = list.map((item) => {
          const isDirectory = (item.attrs.mode & 0o170000) === 0o040000;
          const isSymlink = (item.attrs.mode & 0o170000) === 0o120000;
          const fullPath = path.posix.join(target, item.filename);
          return {
            name: item.filename,
            path: fullPath,
            isDirectory,
            isSymlink,
            size: item.attrs.size,
            modifiedAt: (item.attrs.mtime || 0) * 1000,
            permissions: formatPermissions(item.attrs.mode, isDirectory),
          };
        });
        entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        resolve(entries);
      });
    });
  }

  public async readFile(
    server: ServerConfig,
    filePath: string,
  ): Promise<FileReadResult> {
    if (server.isDemo) {
      return demoBackend.readFile(filePath);
    }

    const sftp = await sshPool.getSftp(server);
    return new Promise<FileReadResult>((resolve, reject) => {
      sftp.stat(filePath, (statErr, stats) => {
        if (statErr) {
          reject(statErr);
          return;
        }
        if (stats.size > MAX_EDITABLE_BYTES) {
          reject(
            new Error(
              `File is too large for inline editor (${Math.round(stats.size / 1024)} KB > 2048 KB). Download it instead.`,
            ),
          );
          return;
        }
        sftp.readFile(filePath, (readErr, buf) => {
          if (readErr) {
            reject(readErr);
            return;
          }
          // Reject obvious binary files containing null bytes
          if (buf.subarray(0, 4096).includes(0)) {
            reject(new Error('Binary file cannot be opened in text editor.'));
            return;
          }
          resolve({
            path: filePath,
            content: buf.toString('utf8'),
            size: buf.length,
            encoding: 'utf8',
          });
        });
      });
    });
  }

  public async readRawBuffer(
    server: ServerConfig,
    filePath: string,
  ): Promise<Buffer> {
    if (server.isDemo) {
      const res = demoBackend.readFile(filePath);
      return Buffer.from(res.content, 'utf8');
    }

    const sftp = await sshPool.getSftp(server);
    return new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(filePath, (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });
  }

  public async writeFile(
    server: ServerConfig,
    filePath: string,
    content: string | Buffer,
  ): Promise<void> {
    if (server.isDemo) {
      demoBackend.writeFile(
        filePath,
        typeof content === 'string' ? content : content.toString('utf8'),
      );
      return;
    }

    const sftp = await sshPool.getSftp(server);
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    return new Promise<void>((resolve, reject) => {
      sftp.writeFile(filePath, data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async mkdir(server: ServerConfig, dirPath: string): Promise<void> {
    if (server.isDemo) {
      demoBackend.mkdir(dirPath);
      return;
    }

    const sftp = await sshPool.getSftp(server);
    return new Promise<void>((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async rename(
    server: ServerConfig,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    if (server.isDemo) {
      demoBackend.rename(oldPath, newPath);
      return;
    }

    const sftp = await sshPool.getSftp(server);
    return new Promise<void>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async remove(
    server: ServerConfig,
    targetPath: string,
    isDirectory: boolean,
  ): Promise<void> {
    const clean = path.posix.normalize(targetPath);
    if (clean === '/' || clean === '/home' || clean === '/etc') {
      throw new Error('Refusing to delete protected system directory.');
    }

    if (server.isDemo) {
      demoBackend.remove(clean);
      return;
    }

    const sftp = await sshPool.getSftp(server);
    if (!isDirectory) {
      return new Promise<void>((resolve, reject) => {
        sftp.unlink(clean, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    const children = await this.listDir(server, clean);
    for (const child of children) {
      await this.remove(server, child.path, child.isDirectory);
    }

    return new Promise<void>((resolve, reject) => {
      sftp.rmdir(clean, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export const sftpService = new SftpService();
