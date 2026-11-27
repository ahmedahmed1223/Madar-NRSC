import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { TransferStore } from './databaseTransfer';

export const storedSecretKeyFormat = /^[a-f0-9]{64}$/i;
const protectedMetaKeys = ['storage.dropbox.credentials', 'storage.gdrive.credentials', 'vapid_keys'];
const prefix = 'enc:v1:';

export interface StoredSecretsOptions {
  key?: string;
  previousKey?: string;
}

function parseKey(value: string | undefined) {
  if (!value) return undefined;
  if (!storedSecretKeyFormat.test(value)) throw new Error('STORED_SECRETS_KEY must contain 32 bytes encoded as hexadecimal');
  return Buffer.from(value, 'hex');
}

export class StoredSecrets {
  private readonly key: Buffer | undefined;
  private readonly previousKey: Buffer | undefined;

  constructor(options: StoredSecretsOptions = {}) {
    this.key = parseKey(options.key);
    this.previousKey = parseKey(options.previousKey);
    if (this.previousKey && !this.key) throw new Error('STORED_SECRETS_PREVIOUS_KEY requires STORED_SECRETS_KEY');
  }

  encodeMeta(key: string, value: string) {
    return protectedMetaKeys.includes(key) ? this.encode(`meta:${key}`, value) : value;
  }

  decodeMeta(key: string, value: string) {
    return protectedMetaKeys.includes(key) ? this.decode(`meta:${key}`, value).value : value;
  }

  encodeTotp(userId: string, value: string | null) {
    return value === null ? null : this.encode(`totp:${userId}`, value);
  }

  decodeTotp(userId: string, value: string | null) {
    return value === null ? null : this.decode(`totp:${userId}`, value).value;
  }

  private encode(context: string, value: string) {
    if (!this.key || value === '') return value;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return prefix + [nonce, cipher.getAuthTag(), encrypted].map(bytes => bytes.toString('base64url')).join(':');
  }

  private decode(context: string, value: string) {
    if (!value.startsWith(prefix)) return { value, renew: !!this.key && value !== '' };
    const [nonce, tag, encrypted, extra] = value.slice(prefix.length).split(':');
    if (nonce?.length !== 16 || tag?.length !== 22 || !encrypted || extra !== undefined) throw new Error('Invalid encrypted newsroom secret');
    for (const [index, key] of [this.key, this.previousKey].entries()) {
      if (!key) continue;
      try {
        const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'), { authTagLength: 16 });
        cipher.setAAD(Buffer.from(context));
        cipher.setAuthTag(Buffer.from(tag, 'base64url'));
        const plain = Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]);
        return { value: plain.toString('utf8'), renew: index !== 0 };
      } catch { /* The configured previous key may unlock an older database or backup. */ }
    }
    throw new Error('Cannot decrypt newsroom secrets. Check STORED_SECRETS_KEY and STORED_SECRETS_PREVIOUS_KEY.');
  }

  /** Inspect every protected value at startup or on a temporary backup; atomically rotate when enabled. */
  migrate(database: TransferStore, verifyOnly = false) {
    return database.transaction(() => {
      let changed = false;
      const meta = database.prepare('SELECT key, value FROM meta WHERE key IN (?, ?, ?)')
        .all(...protectedMetaKeys) as { key: string; value: string }[];
      const setMeta = database.prepare('UPDATE meta SET value = ? WHERE key = ?');
      for (const { key, value } of meta) {
        const decoded = this.decode(`meta:${key}`, value);
        if (!verifyOnly && decoded.renew) {
          setMeta.run(this.encodeMeta(key, decoded.value), key);
          changed = true;
        }
      }
      const users = database.prepare('SELECT user_id, totp_secret FROM user_credentials WHERE totp_secret IS NOT NULL')
        .all() as { user_id: string; totp_secret: string }[];
      const setTotp = database.prepare('UPDATE user_credentials SET totp_secret = ? WHERE user_id = ?');
      for (const { user_id, totp_secret } of users) {
        const decoded = this.decode(`totp:${user_id}`, totp_secret);
        if (!verifyOnly && decoded.renew) {
          setTotp.run(this.encodeTotp(user_id, decoded.value), user_id);
          changed = true;
        }
      }
      return changed;
    })();
  }
}
