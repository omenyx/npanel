import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

function getSecret(): string {
  const secret =
    process.env.NPANEL_CREDENTIALS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('missing_secret');
    }
    return 'npanel_dev_secret';
  }
  return secret;
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'npanel_secretbox', 32);
}

export function encryptString(plaintext: string): string {
  const secret = getSecret();
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString(
    'base64',
  )}`;
}

export function decryptString(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('invalid_secretbox');
  }
  const secret = getSecret();
  const key = deriveKey(secret);
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const ciphertext = Buffer.from(parts[3] ?? '', 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
