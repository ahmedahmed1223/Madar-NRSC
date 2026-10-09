import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function journal() {
  expect(fs.existsSync(path.resolve('src/server/errorJournal.ts'))).toBe(true);
  return import('../../src/server/errorJournal');
}
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-journal-')); directories.push(dir); return dir; }
const entry = (message = 'unhandled error') => ({ id: crypto.randomUUID(), at: new Date().toISOString(), message });

it('persists sanitized bounded errors across restart and returns immutable snapshots', async () => {
  const { ErrorJournal } = await journal(); const dir = directory();
  const first = await ErrorJournal.open(dir);
  for (let i = 0; i < 110; i++) first.append(entry());
  first.append(entry('password=secret'));
  await first.close();
  const second = await ErrorJournal.open(dir);
  expect(second.snapshot().entries).toHaveLength(100);
  expect(second.snapshot().entries[0].message).toBe('server error');
  second.snapshot().entries[0].message = 'mutated';
  expect(second.snapshot().entries[0].message).toBe('server error');
  expect(fs.readFileSync(path.join(dir, 'errors.jsonl'), 'utf8')).not.toContain('secret');
  await second.close();
});

it('tolerates malformed and truncated journal lines and rejects forged IDs', async () => {
  const { ErrorJournal } = await journal(); const dir = directory(); const good = entry();
  fs.writeFileSync(path.join(dir, 'errors.jsonl'), JSON.stringify(good) + '\n' + JSON.stringify({ ...entry(), id: 'untrusted', path: 'secret' }) + '\n{bad\n{"partial":');
  const opened = await ErrorJournal.open(dir);
  expect(opened.snapshot().entries).toEqual([good]);
  opened.append(entry()); await opened.close();
  const again = await ErrorJournal.open(dir); expect(again.snapshot().entries).toHaveLength(2); await again.close();
});

it('rotates at one MiB and keeps only four archives', async () => {
  const { ErrorJournal } = await journal(); const dir = directory();
  const opened = await ErrorJournal.open(dir);
  for (let i = 0; i < 6; i++) {
    // Emulate a full active file without enqueueing thousands of records.
    fs.writeFileSync(path.join(dir, 'errors.jsonl'), ' '.repeat(1048576));
    opened.append(entry()); await opened.flush();
  }
  expect(fs.readdirSync(dir).sort()).toEqual(['errors.1.jsonl', 'errors.2.jsonl', 'errors.3.jsonl', 'errors.4.jsonl', 'errors.jsonl']);
  for (const file of fs.readdirSync(dir)) expect(fs.statSync(path.join(dir, file)).size).toBeLessThanOrEqual(1048576);
  await opened.close();
});

it('degrades without rejecting requests on disk failure and queue overflow', async () => {
  const { ErrorJournal } = await journal(); const opened = await ErrorJournal.open(directory());
  const append = vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(new Error('disk full'));
  opened.append(entry()); await opened.flush();
  expect(opened.health()).toBe('degraded'); append.mockRestore();
  for (let i = 0; i < 1100; i++) opened.append(entry());
  await opened.close(); expect(opened.snapshot().entries).toHaveLength(100);
});

it('generates request correlation IDs instead of trusting incoming headers', async () => {
  const server = await createTestServer();
  try {
    const admin = await loginAgent(server.app, 'admin@akhbar.tv');
    const response = await admin.get('/api/v1/db/diagnostics').set('X-Request-ID', 'supplied-secret');
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['x-request-id']).not.toBe('supplied-secret');
    vi.spyOn(server.db, 'createBackup').mockRejectedValueOnce(new Error('private'));
    const failed = await admin.post('/api/v1/db/backups').set('X-NRCS-Client', 'web');
    const errors = await admin.get('/api/v1/db/errors');
    expect(errors.body.data.entries[0].id).toBe(failed.headers['x-request-id']);
  } finally { server.close(); }
});
