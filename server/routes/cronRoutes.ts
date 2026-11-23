import { Request, Router } from 'express';
import { CronJobInput } from '@shared/types';
import { requireVaultUnlocked } from '../middleware/auth';
import { cronService } from '../services/cronService';
import { vaultStore } from '../vault/vaultStore';

export const cronRouter = Router({ mergeParams: true });

cronRouter.use(requireVaultUnlocked);

function getServerId(req: Request): string {
  return String((req.params as Record<string, string | undefined>).id || '');
}

cronRouter.get('/', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const jobs = await cronService.listCronJobs(server);
    res.json({ jobs });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to list cron jobs.',
    });
  }
});

cronRouter.post('/', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    await cronService.createCronJob(server, req.body as CronJobInput);
    const jobs = await cronService.listCronJobs(server);
    res.json({ jobs });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create cron job.',
    });
  }
});

cronRouter.put('/:jobId', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    await cronService.updateCronJob(
      server,
      String((req.params as Record<string, string>).jobId),
      req.body as CronJobInput,
    );
    const jobs = await cronService.listCronJobs(server);
    res.json({ jobs });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update cron job.',
    });
  }
});

cronRouter.post('/:jobId/toggle', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { enabled } = req.body as { enabled: boolean };
    await cronService.toggleCronEnabled(
      server,
      String((req.params as Record<string, string>).jobId),
      Boolean(enabled),
    );
    const jobs = await cronService.listCronJobs(server);
    res.json({ jobs });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to toggle cron job.',
    });
  }
});

cronRouter.post('/:jobId/track', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    const { tracked } = req.body as { tracked: boolean };
    await cronService.toggleCronTracking(
      server,
      String((req.params as Record<string, string>).jobId),
      Boolean(tracked),
    );
    const jobs = await cronService.listCronJobs(server);
    res.json({ jobs });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to toggle tracking.',
    });
  }
});

cronRouter.delete('/:jobId', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    await cronService.deleteCronJob(
      server,
      String((req.params as Record<string, string>).jobId),
    );
    const jobs = await cronService.listCronJobs(server);
    res.json({ jobs });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to delete cron job.',
    });
  }
});

cronRouter.get('/run-log', async (req, res) => {
  const server = vaultStore.getServer(getServerId(req));
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  const logPath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!logPath) {
    res.status(400).json({ error: 'Log path query parameter is required.' });
    return;
  }
  try {
    const result = await cronService.readRunLog(server, logPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to read run log.',
    });
  }
});
