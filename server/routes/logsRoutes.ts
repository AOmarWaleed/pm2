import { Request, Router } from 'express';
import { LogSourceType } from '@shared/types';
import { requireVaultUnlocked } from '../middleware/auth';
import { logStreamService } from '../services/logStreamService';
import { vaultStore } from '../vault/vaultStore';

export const logsRouter = Router({ mergeParams: true });

logsRouter.use(requireVaultUnlocked);

function getServerId(req: Request): string {
  return String((req.params as Record<string, string | undefined>).id || '');
}

logsRouter.get('/history', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }

  const sourceType =
    req.query.sourceType === 'file' || req.query.sourceType === 'cron'
      ? req.query.sourceType
      : 'pm2';
  const target = typeof req.query.target === 'string' ? req.query.target : '';
  const rangeMinutes =
    Number.parseInt(String(req.query.rangeMinutes || '60'), 10) || 60;
  const maxLines =
    Number.parseInt(String(req.query.maxLines || '800'), 10) || 800;

  try {
    const lines = await logStreamService.fetchHistoricalLogs(server, {
      sourceType,
      target,
      rangeMinutes,
      maxLines,
    });
    res.json({ lines });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : 'Failed to fetch historical logs.',
    });
  }
});

logsRouter.get('/bookmarks', (req, res) => {
  const serverId = getServerId(req);
  if (!vaultStore.getServer(serverId)) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  res.json({ bookmarks: vaultStore.listLogBookmarks(serverId) });
});

logsRouter.post('/bookmarks', (req, res) => {
  const serverId = getServerId(req);
  if (!vaultStore.getServer(serverId)) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  const { label, sourceType, target } = req.body as {
    label?: string;
    sourceType?: LogSourceType;
    target?: string;
  };
  if (!target?.trim()) {
    res.status(400).json({ error: 'Bookmark target is required.' });
    return;
  }
  const bookmark = vaultStore.saveLogBookmark(serverId, {
    label: label || target,
    sourceType: sourceType || 'file',
    target: target.trim(),
  });
  res.json({ bookmark });
});

logsRouter.delete('/bookmarks/:bookmarkId', (req, res) => {
  const serverId = getServerId(req);
  if (!vaultStore.getServer(serverId)) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  const bookmarkId = String(
    (req.params as Record<string, string | undefined>).bookmarkId || '',
  );
  vaultStore.deleteLogBookmark(serverId, bookmarkId);
  res.json({ ok: true });
});
