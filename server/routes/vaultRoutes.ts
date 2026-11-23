import { Router } from 'express';
import { requireVaultUnlocked } from '../middleware/auth';
import { sshPool } from '../ssh/sshPool';
import { InvalidPasswordError } from '../vault/crypto';
import { vaultStore } from '../vault/vaultStore';

export const vaultRouter = Router();

vaultRouter.get('/status', (_req, res) => {
  res.json(vaultStore.getStatus());
});

vaultRouter.post('/setup', (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    const result = vaultStore.setup(password || '');
    res.json({
      ...vaultStore.getStatus(),
      token: result.token,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to setup vault.',
    });
  }
});

vaultRouter.post('/unlock', (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    const result = vaultStore.unlock(password || '');
    res.json({
      ...vaultStore.getStatus(),
      token: result.token,
    });
  } catch (err) {
    const status = err instanceof InvalidPasswordError ? 401 : 400;
    res.status(status).json({
      error: err instanceof Error ? err.message : 'Failed to unlock vault.',
    });
  }
});

vaultRouter.post('/lock', (_req, res) => {
  sshPool.disconnectAll();
  vaultStore.lock();
  res.json(vaultStore.getStatus());
});

vaultRouter.post('/change-password', requireVaultUnlocked, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    vaultStore.changePassword(currentPassword || '', newPassword || '');
    res.json({ ok: true });
  } catch (err) {
    const status = err instanceof InvalidPasswordError ? 401 : 400;
    res.status(status).json({
      error:
        err instanceof Error ? err.message : 'Failed to change password.',
    });
  }
});

vaultRouter.put('/settings', requireVaultUnlocked, (req, res) => {
  try {
    const { autoLockMinutes } = req.body as { autoLockMinutes?: number };
    vaultStore.updateSettings(Number(autoLockMinutes ?? 30));
    res.json(vaultStore.getStatus());
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : 'Failed to update settings.',
    });
  }
});
