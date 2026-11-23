import { Router } from 'express';
import { ServerConfig, ServerInput } from '@shared/types';
import { requireVaultUnlocked } from '../middleware/auth';
import { metricsService } from '../services/metricsService';
import { pm2Service } from '../services/pm2Service';
import { demoBackend } from '../ssh/demoBackend';
import { parseLocalSshConfig } from '../ssh/sshConfigParser';
import { sshPool } from '../ssh/sshPool';
import { vaultStore } from '../vault/vaultStore';

export const serverRouter = Router();

serverRouter.use(requireVaultUnlocked);

serverRouter.get('/', (_req, res) => {
  const servers = vaultStore.listServers().map((s) => {
    const pub = vaultStore.toPublicServer(s);
    const snapshot = metricsService.getSnapshot(s);
    pub.connectionStatus = snapshot.connectionStatus;
    pub.lastError = snapshot.lastError;
    if (snapshot.host) {
      pub.osLabel = snapshot.host.osName;
    }
    return pub;
  });
  res.json({ servers });
});

serverRouter.get('/ssh-config', (_req, res) => {
  try {
    const candidates = parseLocalSshConfig();
    res.json({ candidates });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to read ~/.ssh/config',
    });
  }
});

serverRouter.post('/demo', (_req, res) => {
  try {
    const server = vaultStore.addServer({
      name: 'prod-eu-node-01 (Demo)',
      host: '10.0.14.22',
      port: 22,
      username: 'deploy',
      authMethod: 'privateKey',
      privateKeyPath: '~/.ssh/id_ed25519_demo',
      environment: 'production',
      pm2Mode: 'direct',
      defaultCwd: '/home/deploy/app',
      notes: 'Built-in sandbox server simulating real Linux host + 5 PM2 processes.',
      isDemo: true,
    });
    demoBackend.connect();
    void metricsService.pollServer(server.id);
    const pub = vaultStore.toPublicServer(server);
    pub.connectionStatus = 'connected';
    res.json({ server: pub });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create demo server.',
    });
  }
});

serverRouter.post('/test', async (req, res) => {
  try {
    const input = req.body as Partial<ServerInput> & { existingId?: string };
    const existing = input.existingId
      ? vaultStore.getServer(input.existingId)
      : undefined;

    const candidate: ServerConfig = {
      id: existing?.id || 'probe-test',
      name: input.name || existing?.name || 'Probe',
      host: input.host || existing?.host || '',
      port: Number(input.port ?? existing?.port ?? 22),
      username: input.username || existing?.username || 'root',
      authMethod: input.authMethod || existing?.authMethod || 'privateKey',
      privateKeyPath: input.privateKeyPath ?? existing?.privateKeyPath,
      privateKeyContent:
        input.privateKeyContent && input.privateKeyContent !== ''
          ? input.privateKeyContent
          : existing?.privateKeyContent,
      passphrase:
        input.passphrase && input.passphrase !== ''
          ? input.passphrase
          : existing?.passphrase,
      password:
        input.password && input.password !== ''
          ? input.password
          : existing?.password,
      environment: input.environment || existing?.environment || 'production',
      pm2Mode: input.pm2Mode || existing?.pm2Mode || 'direct',
      pm2TargetUser: input.pm2TargetUser ?? existing?.pm2TargetUser,
      sudoPassword:
        input.sudoPassword && input.sudoPassword !== ''
          ? input.sudoPassword
          : existing?.sudoPassword,
      pm2Path: input.pm2Path ?? existing?.pm2Path,
      pm2Home: input.pm2Home ?? existing?.pm2Home,
      defaultCwd: input.defaultCwd ?? existing?.defaultCwd,
      isDemo: existing?.isDemo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await pm2Service.detectEnvironment(candidate, true);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      reachable: false,
      error: err instanceof Error ? err.message : 'Probe failed.',
    });
  }
});

serverRouter.post('/', (req, res) => {
  try {
    const input = req.body as ServerInput;
    if (!input.name || !input.host || !input.username) {
      res.status(400).json({ error: 'Name, host, and username are required.' });
      return;
    }
    const created = vaultStore.addServer(input);
    const pub = vaultStore.toPublicServer(created);
    pub.connectionStatus = created.isDemo ? 'connected' : 'disconnected';
    res.json({ server: pub });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create server.',
    });
  }
});

serverRouter.put('/:id', (req, res) => {
  try {
    const updated = vaultStore.updateServer(req.params.id, req.body);
    if (!updated.isDemo) {
      sshPool.disconnect(updated.id);
    }
    const pub = vaultStore.toPublicServer(updated);
    pub.connectionStatus = updated.isDemo
      ? demoBackend.getStatus()
      : sshPool.getStatus(updated.id).status;
    res.json({ server: pub });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to update server.',
    });
  }
});

serverRouter.delete('/:id', (req, res) => {
  const server = vaultStore.getServer(req.params.id);
  if (server && !server.isDemo) {
    sshPool.disconnect(server.id);
  }
  metricsService.clearServerState(req.params.id);
  vaultStore.deleteServer(req.params.id);
  res.json({ ok: true });
});

serverRouter.post('/:id/connect', async (req, res) => {
  const server = vaultStore.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  try {
    if (server.isDemo) {
      demoBackend.connect();
    } else {
      await sshPool.connect(server);
    }
    const snapshot = await metricsService.pollServer(server.id);
    res.json({ snapshot });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'SSH connection failed.',
    });
  }
});

serverRouter.post('/:id/disconnect', (req, res) => {
  const server = vaultStore.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  if (server.isDemo) {
    demoBackend.disconnect();
  } else {
    sshPool.disconnect(server.id);
  }
  res.json({ snapshot: metricsService.getSnapshot(server) });
});

serverRouter.get('/:id/telemetry', (req, res) => {
  const server = vaultStore.getServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  res.json({ snapshot: metricsService.getSnapshot(server) });
});

serverRouter.post('/:id/demo/simulate-crash', async (req, res) => {
  const server = vaultStore.getServer(req.params.id);
  if (!server || !server.isDemo) {
    res.status(400).json({ error: 'Crash simulation is only for Demo servers.' });
    return;
  }
  const { processName } = req.body as { processName?: string };
  const crashed = demoBackend.simulateCrash(processName);
  const snapshot = await metricsService.pollServer(server.id);
  res.json({ crashed, snapshot });
});
