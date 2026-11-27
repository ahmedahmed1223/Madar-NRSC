import { strict as assert } from 'node:assert';
import { availableParallelism, platform } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import { createTestServer, loginAgent } from '../tests/helpers';

const pairs = 25;
const archiveCount = 5000;
const stations = ['غزة', 'بيروت', 'إسطنبول', 'الدوحة'].map((name, i) => ({ id: `benchmark-station-${i}`, name }));
const clientHeader = { 'X-NRCS-Client': 'web' };
const metrics = new Map<string, number[]>();

async function timed<T>(name: string, request: () => PromiseLike<T>) {
  const start = performance.now();
  try { return await request(); }
  finally {
    const samples = metrics.get(name) ?? [];
    samples.push(performance.now() - start);
    metrics.set(name, samples);
  }
}

if (process.env.TEST_DATABASE_ENGINE === 'postgresql') throw new Error('This benchmark uses an isolated temporary SQLite database');
const fixture = await createTestServer({ NEWS_ACTIVE_DAYS: '30' });
const delay = monitorEventLoopDelay({ resolution: 10 });
try {
  const { db, app } = fixture;
  const settings = db.getRow('settings', 'singleton')!;
  const editor = db.getCredentialsByEmail('editor@akhbar.tv')!;
  const reporter = db.getCredentialsByEmail('reporter@akhbar.tv')!;
  function addUser(kind: 'editor' | 'reporter', i: number) {
    const source = kind === 'editor' ? editor : reporter;
    const id = `benchmark-${kind}-${i}`;
    const email = `${id}@benchmark.invalid`;
    const stationId = stations[i % stations.length].id;
    const user = db.getRow('users', source.userId)!;
    db.writeRow('users', id, { ...user.d, id, email, stationId, fullName: id }, i, null);
    db.setPassword(id, email, source.passwordHash, false);
    return { id, email, stationId };
  }
  const accounts = db.transaction(() => {
    db.writeRow('settings', settings.id, { ...settings.d, stations }, settings.p, null);
    const accounts = Array.from({ length: pairs }, (_, i) => ({ editor: addUser('editor', i), reporter: addUser('reporter', i) }));
    for (let i = 0; i < archiveCount; i++) {
      const author = accounts[i % stations.length].reporter;
      const id = `benchmark-archived-news-${i}`;
      db.writeRow('news', id, { id, status: 'ARCHIVED', stationId: author.stationId, authorId: author.id,
        title: `مؤتمر المناخ ${i}`, summary: 'ملخص المادة الأرشيفية', content: 'مادة اصطناعية لقياس الأداء' }, i, null);
    }
    return accounts;
  });
  const sqlite = new Database(db.filePath, { fileMustExist: true });
  try {
    const past = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const backdated = sqlite.prepare("UPDATE entities SET updated_at = ? WHERE collection = 'news' AND id GLOB 'benchmark-archived-news-*'").run(past);
    assert.equal(backdated.changes, archiveCount);
  } finally { sqlite.close(); }

  delay.enable();
  const users = await Promise.all(accounts.map(async ({ editor, reporter }) => {
    const [writer, recipient] = await Promise.all([
      timed('login', () => loginAgent(app, editor.email)),
      timed('login', () => loginAgent(app, reporter.email)),
    ]);
    const [initialWriter, initialRecipient] = await Promise.all([
      timed('bootstrap', () => writer.get('/api/v1/data')),
      timed('bootstrap', () => recipient.get('/api/v1/data')),
    ]);
    assert.equal(initialWriter.status, 200);
    assert.equal(initialRecipient.status, 200);
    return { writer, recipient, recipientId: reporter.id, stationId: reporter.stationId, baseline: initialRecipient.body };
  }));
  const writes = await Promise.all(users.map(async ({ writer, recipientId }, i) => {
    const id = `benchmark-task-${i}`;
    const response = await timed('writeTask', () => writer.post('/api/v1/data/sync').set(clientHeader).send({ ops: [
      { c: 'tasks', id, op: 'upsert', d: { id, title: 'متابعة مادة للاختبار', status: 'TODO', assigneeId: recipientId } },
    ] }));
    assert.equal(response.status, 200);
    assert.equal(response.body.results[0]?.ok, true, JSON.stringify(response.body.results[0]));
    return id;
  }));
  await Promise.all(users.map(async ({ recipient, baseline, stationId }, i) => {
    const delta = await timed('readChanges', () => recipient.get('/api/v1/data/changes').query({ since: baseline.rev, access: baseline.access }));
    assert.equal(delta.status, 200);
    assert.equal(delta.body.changes.filter((row: { id: string }) => row.id === writes[i]).length, 1);
    const archive = await timed('archiveSearch', () => recipient.get('/api/v1/archive/news').query({ q: 'المناخ', station: stationId }));
    assert.equal(archive.status, 200);
    assert.equal(archive.body.data.total, archiveCount / stations.length);
  }));
  const actualWrites = db.listCollection('tasks').filter(row => row.id.startsWith('benchmark-task-'));
  assert.equal(actualWrites.length, writes.length);
  const results = Object.fromEntries([...metrics].map(([name, samples]) => {
    const ordered = [...samples].sort((a, b) => a - b);
    return [name, { requests: samples.length, p95Ms: Math.round(ordered[Math.ceil(samples.length * 0.95) - 1]) }];
  }));
  console.log(JSON.stringify({ engine: 'sqlite', node: process.version, platform: platform(), logicalConcurrency: availableParallelism(),
    accounts: pairs * 2, stations: stations.length, archiveItems: archiveCount, verifiedAssignments: actualWrites.length,
    eventLoopDelayP95Ms: Math.round(delay.percentile(95) / 1e6), rssMiB: Math.round(process.memoryUsage().rss / 2 ** 20), results }, null, 2));
} finally {
  delay.disable();
  fixture.close();
}
