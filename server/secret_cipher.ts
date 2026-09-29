/**
 * At-rest encryption for secret material (proxy passwords, site credentials)
 * persisted in settings.json. The Electron main process provisions a random
 * 32-byte master key per install, seals it with safeStorage (OS keychain /
 * DPAPI) and hands it to the engine process via NDM_SECRET_KEY. Standalone
 * engine runs without that env var fall back to plaintext — values written
 * while a key was present still round-trip because every ciphertext carries
 * an `enc:v1:` prefix.
 */
import crypto from 'crypto';

const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null | undefined;

function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = null;
  const raw = process.env.NDM_SECRET_KEY;
  if (raw) {
    try {
      const key = Buffer.from(raw, 'base64');
      if (key.length === 32) {
        cachedKey = key;
      } else {
        console.error('[SecretCipher] NDM_SECRET_KEY has unexpected length — secrets will be stored in plaintext.');
      }
    } catch (err) {
      console.error('[SecretCipher] Failed to parse NDM_SECRET_KEY — secrets will be stored in plaintext.', err);
    }
  }
  return cachedKey;
}

export function encryptionEnabled(): boolean {
  return getKey() !== null;
}

export function encryptSecret(value: string): string {
  const key = getKey();
  if (!key || !value || value.startsWith(PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) {
    console.error('[SecretCipher] Encrypted secret present but no master key — dropping it.');
    return '';
  }
  try {
    const blob = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const data = blob.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Wrong/rotated key (e.g. settings copied across machines): fail soft.
    console.error('[SecretCipher] Secret decryption failed — dropping it.');
    return '';
  }
}
