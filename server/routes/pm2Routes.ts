import { Request, Router } from 'express';
import { Pm2Action, StartNewAppInput } from '@shared/types';
import { requireVaultUnlocked } from '../middleware/auth';
import { metricsService } from '../services/metricsService';
import { pm2Service } from '../services/pm2Service';
import { vaultStore } from '../vault/vaultStore';

export const pm2Router = Router({ mergeParams: true });

pm2Router.use(requireVaultUnlocked);

function getServerId(req: Request): string {
  return String((req.params as Record<string, string | undefined>).id || '');
}

pm2Router.get('/list', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const processes = await pm2Service.listProcesses(server);
    res.json({ processes });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to list PM2 processes.',
    });
  }
});

pm2Router.post('/action', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { target, targets, action } = req.body as {
      target?: string;
      targets?: string[];
      action: Pm2Action;
    };
    let output: string;
    if (Array.isArray(targets) && targets.length > 0) {
      const outs = await pm2Service.bulkAction(server, targets, action);
      output = outs.join('\n');
    } else if (target) {
      output = await pm2Service.performAction(server, target, action);
    } else {
      res.status(400).json({ error: 'Target process or targets array required.' });
      return;
    }
    const snapshot = await metricsService.pollServer(server.id);
    res.json({ output, snapshot });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'PM2 action failed.',
    });
  }
});

pm2Router.post('/scale', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { name, instances } = req.body as {
      name: string;
      instances: number | 'max';
    };
    const output = await pm2Service.scaleProcess(server, name, instances);
    const snapshot = await metricsService.pollServer(server.id);
    res.json({ output, snapshot });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Scale failed.',
    });
  }
});

pm2Router.post('/start', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const input = req.body as StartNewAppInput;
    const output = await pm2Service.startNewApp(server, input);
    const snapshot = await metricsService.pollServer(server.id);
    res.json({ output, snapshot });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to start app.',
    });
  }
});

pm2Router.post('/ecosystem', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { filePath, content, action } = req.body as {
      filePath: string;
      content?: string;
      action: 'startOrReload' | 'start';
    };
    const output = await pm2Service.applyEcosystem(
      server,
      filePath,
      content,
      action || 'startOrReload',
    );
    const snapshot = await metricsService.pollServer(server.id);
    res.json({ output, snapshot });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to apply ecosystem.',
    });
  }
});

pm2Router.post('/save', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const output = await pm2Service.saveDump(server);
    res.json({ output });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'pm2 save failed.',
    });
  }
});

pm2Router.post('/resurrect', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const output = await pm2Service.resurrectDump(server);
    const snapshot = await metricsService.pollServer(server.id);
    res.json({ output, snapshot });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'pm2 resurrect failed.',
    });
  }
});
