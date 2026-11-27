import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NewsroomDatabase } from '../../src/server/db';

const key = randomBytes(32).toString('hex');
const rotatedKey = randomBytes(32).toString('hex');
const metaKey = 'storage.dropbox.credentials';
const credential = JSON.stringify({ creds: { refreshToken: 'existing-test-value' } });

describe('stored secrets', () => {
  let dataDir: string;
  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrcs-secrets-test-')); });
  afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

  function rawValue() {
    const raw = new Database(path.join(dataDir, 'newsroom.sqlite'), { readonly: true, fileMustExist: true });
    try { return raw.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(metaKey); }
    finally { raw.close(); }
  }

  it('migrates existing values in place and can rotate the key without losing them', () => {
    const initial = new NewsroomDatabase(dataDir);
    initial.setMeta(metaKey, credential);
    initial.close();
    expect(rawValue()).toEqual(credential);

    const locked = new NewsroomDatabase(dataDir, undefined, undefined, undefined, { key });
    try {
      expect(locked.getMeta(metaKey)).toEqual(credential);
      expect(rawValue()).toMatch(/^enc:v1:/);
    } finally { locked.close(); }
    expect(() => new NewsroomDatabase(dataDir)).toThrow(/STORED_SECRETS_KEY/);
    const encoded = rawValue();

    const rotated = new NewsroomDatabase(dataDir, undefined, undefined, undefined, { key: rotatedKey, previousKey: key });
    try {
      expect(rotated.getMeta(metaKey)).toEqual(credential);
      expect(rawValue()).not.toEqual(encoded);
    } finally { rotated.close(); }
    const reopened = new NewsroomDatabase(dataDir, undefined, undefined, undefined, { key: rotatedKey });
    try { expect(reopened.getMeta(metaKey)).toEqual(credential); }
    finally { reopened.close(); }
  });

  it('restores an encrypted authenticator secret with the previous key and protects it with the active key', async () => {
    const id = 'restore-test-user';
    const secret = 'JBSWY3DPEHPK3PXP';
    const initial = new NewsroomDatabase(dataDir, undefined, undefined, undefined, { key });
    let backup: string;
    try {
      initial.setPassword(id, 'restore@example.org', 'fixture-hash', false);
      initial.setTotp(id, secret, true);
      backup = (await initial.createBackup()).fileName;
    } finally { initial.close(); }

    const rotated = new NewsroomDatabase(dataDir, undefined, undefined, undefined, { key: rotatedKey, previousKey: key });
    try {
      rotated.setTotp(id, null, false);
      await rotated.restoreBackup(backup);
      expect(rotated.getCredentials(id)).toMatchObject({ totpEnabled: true, totpSecret: secret });
    } finally { rotated.close(); }

    const reopened = new NewsroomDatabase(dataDir, undefined, undefined, undefined, { key: rotatedKey });
    try { expect(reopened.getCredentials(id)?.totpSecret).toEqual(secret); }
    finally { reopened.close(); }
  });
});
