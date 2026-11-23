import crypto from 'node:crypto';

export interface EncryptedVaultPayload {
  version: 1;
  kdf: 'scrypt';
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class InvalidPasswordError extends Error {
  constructor(message = 'Invalid master password or corrupted vault.') {
    super(message);
    this.name = 'InvalidPasswordError';
  }
}

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

export function encryptVault(
  plaintext: string,
  password: string,
): EncryptedVaultPayload {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT_PARAMS);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptVault(
  payload: EncryptedVaultPayload,
  password: string,
): string {
  if (
    !payload ||
    payload.version !== 1 ||
    payload.kdf !== 'scrypt' ||
    !payload.salt ||
    !payload.iv ||
    !payload.authTag ||
    !payload.ciphertext
  ) {
    throw new InvalidPasswordError('Malformed encrypted vault file.');
  }

  try {
    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const key = crypto.scryptSync(password, salt, 32, SCRYPT_PARAMS);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new InvalidPasswordError();
  }
}
