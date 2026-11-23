import path from 'node:path';
import express, { Request, Router } from 'express';
import { requireVaultUnlocked } from '../middleware/auth';
import { sftpService } from '../services/sftpService';
import { vaultStore } from '../vault/vaultStore';

export const filesRouter = Router({ mergeParams: true });

filesRouter.use(requireVaultUnlocked);

function getServerId(req: Request): string {
  return String((req.params as Record<string, string | undefined>).id || '');
}

filesRouter.get('/list', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const dirPath =
      typeof req.query.path === 'string' && req.query.path
        ? req.query.path
        : server.defaultCwd || '/';
    const entries = await sftpService.listDir(server, dirPath);
    res.json({ path: dirPath, entries });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to list directory.',
    });
  }
});

filesRouter.get('/read', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) {
      res.status(400).json({ error: 'File path is required.' });
      return;
    }
    const result = await sftpService.readFile(server, filePath);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to read file.',
    });
  }
});

filesRouter.put('/write', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { path: filePath, content } = req.body as {
      path?: string;
      content?: string;
    };
    if (!filePath || content === undefined) {
      res.status(400).json({ error: 'Path and content are required.' });
      return;
    }
    await sftpService.writeFile(server, filePath, content);
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to write file.',
    });
  }
});

filesRouter.post('/mkdir', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { path: dirPath } = req.body as { path?: string };
    if (!dirPath) {
      res.status(400).json({ error: 'Directory path is required.' });
      return;
    }
    await sftpService.mkdir(server, dirPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create directory.',
    });
  }
});

filesRouter.post('/rename', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { oldPath, newPath } = req.body as {
      oldPath?: string;
      newPath?: string;
    };
    if (!oldPath || !newPath) {
      res.status(400).json({ error: 'oldPath and newPath are required.' });
      return;
    }
    await sftpService.rename(server, oldPath, newPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Rename failed.',
    });
  }
});

filesRouter.delete('/remove', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { path: targetPath, isDirectory } = req.body as {
      path?: string;
      isDirectory?: boolean;
    };
    if (!targetPath) {
      res.status(400).json({ error: 'Target path is required.' });
      return;
    }
    await sftpService.remove(server, targetPath, Boolean(isDirectory));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Delete failed.',
    });
  }
});

filesRouter.post(
  '/upload',
  express.raw({ type: 'application/octet-stream', limit: '25mb' }),
  async (req, res) => {
    const server = vaultStore.getServer(getServerId(req));
    if (!server) {
      res.status(404).json({ error: 'Server not found.' });
      return;
    }
    try {
      const targetPath =
        typeof req.query.path === 'string' ? req.query.path : '';
      if (!targetPath) {
        res.status(400).json({ error: 'Target path query param is required.' });
        return;
      }
      const buf = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body || '');
      await sftpService.writeFile(server, targetPath, buf);
      res.json({ ok: true, path: targetPath, size: buf.length });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  },
);

filesRouter.get('/download', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) {
      res.status(400).json({ error: 'File path is required.' });
      return;
    }
    const buf = await sftpService.readRawBuffer(server, filePath);
    const filename = path.posix.basename(filePath);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g, '')}"`,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buf);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Download failed.',
    });
  }
});
