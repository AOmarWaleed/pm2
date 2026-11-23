import { Router } from 'express';
import { AlertRule, ScriptItem, WebhookConfig } from '@shared/types';
import { requireVaultUnlocked } from '../middleware/auth';
import { aiService } from '../services/aiService';
import { alertService } from '../services/alertService';
import { metricsService } from '../services/metricsService';
import { scriptService } from '../services/scriptService';
import { vaultStore } from '../vault/vaultStore';

// ---- Scripts Router ----
export const scriptsRouter = Router();
scriptsRouter.use(requireVaultUnlocked);

scriptsRouter.get('/', (_req, res) => {
  res.json({
    scripts: vaultStore.listScripts(),
    history: scriptService.listHistory(),
  });
});

scriptsRouter.post('/', (req, res) => {
  try {
    const body = req.body as Omit<
      ScriptItem,
      'id' | 'createdAt' | 'updatedAt'
    > & { id?: string };
    if (!body.name || !body.command) {
      res.status(400).json({ error: 'Script name and command are required.' });
      return;
    }
    const script = vaultStore.saveScript({
      ...body,
      description: body.description || '',
      tags: Array.isArray(body.tags) ? body.tags : [],
    });
    res.json({ script });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to save script.',
    });
  }
});

scriptsRouter.put('/:id', (req, res) => {
  try {
    const body = req.body as Omit<
      ScriptItem,
      'id' | 'createdAt' | 'updatedAt'
    >;
    const script = vaultStore.saveScript({
      ...body,
      id: req.params.id,
      description: body.description || '',
      tags: Array.isArray(body.tags) ? body.tags : [],
    });
    res.json({ script });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update script.',
    });
  }
});

scriptsRouter.delete('/:id', (req, res) => {
  vaultStore.deleteScript(req.params.id);
  res.json({ ok: true });
});

// ---- Alerts & Webhooks Router ----
export const alertsRouter = Router();
alertsRouter.use(requireVaultUnlocked);

alertsRouter.get('/', (_req, res) => {
  res.json({
    rules: vaultStore.listAlertRules(),
    events: vaultStore.listAlertEvents(),
    webhooks: vaultStore
      .listWebhooks()
      .map((w) => vaultStore.toPublicWebhook(w)),
  });
});

alertsRouter.post('/rules', (req, res) => {
  try {
    const body = req.body as Omit<AlertRule, 'id'> & { id?: string };
    const rule = vaultStore.saveAlertRule(body);
    res.json({ rule });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to save alert rule.',
    });
  }
});

alertsRouter.delete('/rules/:id', (req, res) => {
  vaultStore.deleteAlertRule(req.params.id);
  res.json({ ok: true });
});

alertsRouter.post('/events/ack', (req, res) => {
  const { id } = req.body as { id?: string };
  vaultStore.acknowledgeAlerts(id);
  res.json({ ok: true });
});

alertsRouter.delete('/events', (_req, res) => {
  vaultStore.clearAlertEvents();
  res.json({ ok: true });
});

alertsRouter.post('/webhooks', (req, res) => {
  try {
    const body = req.body as Omit<WebhookConfig, 'id' | 'createdAt'> & {
      id?: string;
    };
    const saved = vaultStore.saveWebhook(body);
    res.json({ webhook: vaultStore.toPublicWebhook(saved) });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to save webhook.',
    });
  }
});

alertsRouter.delete('/webhooks/:id', (req, res) => {
  vaultStore.deleteWebhook(req.params.id);
  res.json({ ok: true });
});

alertsRouter.post('/webhooks/:id/test', async (req, res) => {
  const wh = vaultStore.listWebhooks().find((w) => w.id === req.params.id);
  if (!wh) {
    res.status(404).json({ error: 'Webhook not found.' });
    return;
  }
  try {
    await alertService.testWebhook(wh);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Webhook test failed.',
    });
  }
});

// ---- AI Router ----
export const aiRouter = Router();
aiRouter.use(requireVaultUnlocked);

aiRouter.get('/config', (_req, res) => {
  res.json({ config: vaultStore.getPublicAiConfig() });
});

aiRouter.put('/config', (req, res) => {
  try {
    const config = vaultStore.updateAiConfig(req.body);
    res.json({ config });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update AI config.',
    });
  }
});

aiRouter.post('/test', async (req, res) => {
  try {
    const saved = vaultStore.getAiConfig();
    const override = req.body as Partial<typeof saved>;
    const merged = {
      ...saved,
      ...override,
      apiKey:
        override.apiKey && override.apiKey !== ''
          ? override.apiKey
          : saved.apiKey,
    };
    const reply = await aiService.testConnection(merged);
    res.json({ ok: true, reply });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'AI connection test failed.',
    });
  }
});

aiRouter.post('/suggest', async (req, res) => {
  try {
    const { serverId, prompt, language } = req.body as {
      serverId: string;
      prompt: string;
      language?: 'en' | 'ar';
    };
    const server = vaultStore.getServer(serverId);
    if (!server) {
      res.status(404).json({ error: 'Server not found.' });
      return;
    }
    const config = vaultStore.getAiConfig();
    const procs = metricsService.getLatestProcesses(serverId);
    const suggestion = await aiService.suggestCommand(
      config,
      prompt,
      server,
      procs,
      language || 'en',
    );
    res.json({ suggestion });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'AI suggestion failed.',
    });
  }
});

aiRouter.post('/diagnose-logs', async (req, res) => {
  try {
    const { serverId, processName, logs, language } = req.body as {
      serverId: string;
      processName: string;
      logs: string;
      language?: 'en' | 'ar';
    };
    const server = vaultStore.getServer(serverId);
    if (!server) {
      res.status(404).json({ error: 'Server not found.' });
      return;
    }
    const config = vaultStore.getAiConfig();
    const procs = metricsService.getLatestProcesses(serverId);
    const diagnosis = await aiService.analyzeLogs(
      config,
      processName || 'all',
      logs,
      server,
      procs,
      language || 'en',
    );
    res.json({ diagnosis });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Log diagnosis failed.',
    });
  }
});
