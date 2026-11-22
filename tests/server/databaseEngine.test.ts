import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { NewsroomDatabase } from '../../src/server/db';
import { databaseEngineStatus, readDatabaseEngineState, scheduleDatabaseEngine, type DatabaseEngineConfig } from '../../src/server/databaseEngineState';
import { openConfiguredDatabase } from '../../src/server/openDatabase';
import { PostgresDatabase } from '../../src/server/postgres/driver';
import { seedDatabase } from '../../src/server/seed';
import { createTestServer, loginAgent } from '../helpers';

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'madar-engine-test-'));
const H = { 'X-NRCS-Client': 'web' };
const basicOptions: DatabaseEngineConfig = { defaultEngine: 'sqlite', postgresSchema: 'madar_test' };
const postgresUrl = process.env.POSTGRES_TEST_URL;

it('exposes engine settings only to database administrators and keeps SQLite as the default', async () => {
  const fixture = await createTestServer();
  try {
    const journalist = await loginAgent(fixture.app, 'journalist@akhbar.tv');
    await journalist.get('/api/v1/db/engine').expect(403);
    const administrator = await loginAgent(fixture.app, 'admin@akhbar.tv');
    const status = await administrator.get('/api/v1/db/engine').expect(200);
    expect(status.body.data).toMatchObject({ active: 'sqlite', postgresConfigured: false });
    await administrator.post('/api/v1/db/engine').set(H).send({ engine: 'postgresql' }).expect(409);
    expect(readDatabaseEngineState(fixture.dir, basicOptions).pending).toBeUndefined();
  } finally { fixture.close(); }
});

it('preserves the active SQLite database when an upload prevents a scheduled transfer', () => {
  const dir = root();
  const options = { ...basicOptions, postgresUrl: 'postgresql://127.0.0.1:1/not-used' };
  let db: NewsroomDatabase | undefined;
  try {
    db = openConfiguredDatabase(dir, options);
    const id = db.dbId;
    db.insertUpload({ id: 'missing-upload', storedName: 'missing.wav', originalName: 'missing.wav', mimeType: 'audio/wav',
      sizeBytes: 8, uploadedBy: 'test-user', createdAt: new Date().toISOString() });
    scheduleDatabaseEngine(dir, options, 'postgresql');
    db.close();
    db = openConfiguredDatabase(dir, options);
    expect(db.dbId).toBe(id);
    expect(db.getUpload('missing-upload')?.storedName).toBe('missing.wav');
    expect(databaseEngineStatus(readDatabaseEngineState(dir, options), options)).toMatchObject({
      active: 'sqlite', lastTransfer: { status: 'failed', engine: 'postgresql' },
    });
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(!postgresUrl)('does not initialize an unexpected PostgreSQL schema while reconnecting an existing installation', () => {
  const dir = root();
  const schema = `qa_unexpected_${randomBytes(5).toString('hex')}`;
  const inspector = new PostgresDatabase(postgresUrl!, { schema, acquireAppLock: false });
  try {
    expect(() => new NewsroomDatabase(dir, { engine: 'postgresql', schema }, postgresUrl, 'known-installation'))
      .toThrow('هوية القاعدة النشطة');
    expect(inspector.query('SELECT nspname FROM pg_namespace WHERE nspname = $1', [schema]).rowCount).toBe(0);
  } finally { inspector.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(!postgresUrl)('switches to real PostgreSQL and back with accounts, Arabic content, attachments and new writes', async () => {
  const dir = root();
  const options: DatabaseEngineConfig = { ...basicOptions, postgresUrl, postgresSchema: `qa_madar_${randomBytes(5).toString('hex')}` };
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, SEED_DEMO_DATA: 'true', BACKUP_INTERVAL_HOURS: '0',
    POSTGRES_URL: postgresUrl, POSTGRES_SCHEMA: options.postgresSchema });
  let db: NewsroomDatabase | undefined;
  try {
    db = openConfiguredDatabase(dir, options);
    await seedDatabase(db, config);
    const id = db.dbId;
    const audio = Buffer.from('temporary Arabic export QA audio fixture');
    fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploads', 'fixture.wav'), audio);
    db.insertUpload({ id: 'fixture-audio', storedName: 'fixture.wav', originalName: 'تقرير.wav', mimeType: 'audio/wav',
      sizeBytes: audio.length, uploadedBy: 'usr-1', createdAt: new Date().toISOString() });
    const article = { id: 'engine-story', title: 'أخبار القدس اليوم', summary: 'تقرير عربي من الميدان', content: 'تغطية مباشرة من القدس',
      status: 'PUBLISHED', createdAt: '2026-04-01T10:00:00Z', approvedAt: '2026-04-01T10:02:00Z' };
    db.writeRow('news', article.id, article, 4000, 'usr-1');
    db.transaction(() => {
      for (let index = 0; index < 145; index++) db.setMeta(`transfer-fixture:${index}`, `محتوى ${index}`);
    });
    const revision = db.currentRev();
    scheduleDatabaseEngine(dir, options, 'postgresql');
    expect(db.engine).toBe('sqlite');
    db.close();
    db = openConfiguredDatabase(dir, options);
    expect(db.engine).toBe('postgresql');
    expect(db.dbId).toBe(id);
    expect(db.currentRev()).toBe(revision);
    expect(db.getMeta('transfer-fixture:144')).toBe('محتوى 144');
    expect(db.getUpload('fixture-audio')?.originalName).toBe('تقرير.wav');
    expect(db.rankNewsArchive('2099-01-01', 'القدس', '', 30, 0).items.some(row => row.id === article.id)).toBe(true);
    expect(db.newsReportGroups('2026-01-01').some(row => (row.approvalMs || 0) >= 120000)).toBe(true);
    expect(db.newsReportRecords({ stations: [null], category: 'ALL', status: 'PUBLISHED', limit: 100, offset: 0 }))
      .toContainEqual(expect.objectContaining({ id: article.id, stationId: null }));
    expect(db.stats().engine).toContain('PostgreSQL');
    expect(() => db.archiveVocabulary('2099-01-01')).not.toThrow();
    expect(Array.isArray(db.assignedWorkIds('usr-3'))).toBe(true);
    const administrator = await loginAgent(createApp(db, config).app, 'admin@akhbar.tv');
    const data = await administrator.get('/api/v1/data').expect(200);
    expect(JSON.stringify(data.body.collections.news)).toContain('أخبار القدس اليوم');
    const backup = await db.createBackup();
    expect((await db.verifyBackup(backup.fileName)).valid).toBe(true);
    db.writeRow('news', article.id, { ...article, title: 'عنوان سيُستعاد' }, 4000, 'usr-1');
    const beforeRestore = db.currentRev();
    await db.restoreBackup(backup.fileName);
    expect(db.dbId).toBe(id);
    expect(db.currentRev()).toBeGreaterThan(beforeRestore);
    expect(db.getRow('news', article.id)?.d.title).toBe(article.title);
    db.writeRow('news', article.id, { ...article, title: 'تحديث القدس بعد النقل' }, 4000, 'usr-1');
    await administrator.post('/api/v1/db/engine').set(H).send({ engine: 'sqlite' }).expect(400);
    const scheduled = await administrator.post('/api/v1/db/engine').set(H).send({ engine: 'sqlite', localAirEnded: true }).expect(200);
    expect(scheduled.body.data.pending.engine).toBe('sqlite');
    db.close();
    db = openConfiguredDatabase(dir, options);
    expect(db.engine).toBe('sqlite');
    expect(db.dbId).toBe(id);
    expect(db.getRow('news', article.id)?.d.title).toBe('تحديث القدس بعد النقل');
    expect(fs.readFileSync(path.join(dir, 'uploads', 'fixture.wav'))).toEqual(audio);
    expect(fs.existsSync(path.join(dir, 'newsroom.sqlite'))).toBe(true);
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 90_000);
