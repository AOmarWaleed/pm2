import { NextFunction, Request, Response } from 'express';
import { vaultStore } from '../vault/vaultStore';

const LOCAL_ORIGIN_REGEX = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Non-browser local callers or same-origin requests without Origin header
  return LOCAL_ORIGIN_REGEX.test(origin);
}

export function validateOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  if (!isAllowedLocalOrigin(origin)) {
    res.status(403).json({
      error: 'Forbidden: Cross-origin access from non-local origins is blocked.',
    });
    return;
  }
  next();
}

export function requireVaultUnlocked(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const state = vaultStore.getState();
  if (state !== 'unlocked') {
    res.status(423).json({
      error: 'Vault is locked.',
      state,
    });
    return;
  }

  const headerToken = req.headers['x-vault-token'];
  const queryToken =
    typeof req.query.token === 'string' ? req.query.token : undefined;
  const token =
    typeof headerToken === 'string' ? headerToken : queryToken;

  if (!vaultStore.isValidToken(token)) {
    res.status(401).json({
      error: 'Invalid or expired vault session token.',
    });
    return;
  }

  vaultStore.touchActivity();
  next();
}
