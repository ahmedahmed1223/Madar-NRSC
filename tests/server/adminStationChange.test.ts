import { afterEach, expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';
import type { ModuleAccessSettings } from '../../src/shared/moduleAccess';

const H = { 'X-NRCS-Client': 'web' };
let server: Awaited<ReturnType<typeof createTestServer>> | undefined;
afterEach(() => { server?.close(); server = undefined; });

async function setup(email: string, origin: string, linked: boolean, moduleAccess?: ModuleAccessSettings) {
  server = await createTestServer();
  const { db, app } = server;
  const settings = db.getRow('settings', 'singleton')!;
  db.writeRow('settings', settings.id, {
    ...settings.d, moduleAccess,
    stations: [
      { id: 'gaza', name: 'غزة', isMain: true },
      { id: 'beirut', name: 'بيروت', linkedIds: linked ? ['istanbul'] : [] },
      { id: 'istanbul', name: 'إسطنبول', linkedIds: linked ? ['beirut'] : [] },
    ],
  }, settings.p, null);
  const record = db.listCollection('users').find(entry => entry.d.email === email)!;
  db.writeRow('users', record.id, { ...record.d, stationId: origin }, record.p, null);
  const account = db.getRow('users', record.id)!;
  const agent = await loginAgent(app, email);
  const change = (patch: Record<string, unknown>) => {
    const current = db.getRow('users', account.id)!;
    return agent.post('/api/v1/data/sync').set(H).send({
      ops: [{ c: 'users', op: 'upsert', id: account.id, baseV: current.v, d: { ...current.d, ...patch } }],
    });
  };
  return { account, change, db };
}

it.each(['admin@akhbar.tv', 'director@akhbar.tv'])('allows %s to change their own station within existing access', async email => {
  const { account, change, db } = await setup(email, 'gaza', true);
  const allowed = await change({ stationId: 'beirut' }).expect(200);
  expect(allowed.body.results[0].ok).toBe(true);
  expect(db.getRow('users', account.id)?.d.stationId).toBe('beirut');
  const blocked = await change({ stationId: 'istanbul', isActive: false }).expect(200);
  expect(blocked.body.results[0].code).toBe('FORBIDDEN');
  expect(db.getRow('users', account.id)?.d.stationId).toBe('beirut');
});

it('protects a station assignment that would widen an administrator’s station scope', async () => {
  const { change } = await setup('director@akhbar.tv', 'beirut', false);
  const result = await change({ stationId: 'istanbul' }).expect(200);
  expect(result.body.results[0].code).toBe('FORBIDDEN');
  expect(result.body.results[0].message).toContain('يوسّع نطاق المحطات');
});

it('protects module restrictions when a system administrator changes station', async () => {
  const { change } = await setup('admin@akhbar.tv', 'beirut', true, {
    news: { mode: 'everyone', scopes: [{ stationId: 'beirut', mode: 'disabled' }] },
  });
  const result = await change({ stationId: 'istanbul' }).expect(200);
  expect(result.body.results[0].code).toBe('FORBIDDEN');
  expect(result.body.results[0].message).toContain('إتاحة الوحدات');
});

it('keeps a legacy account’s effective department when station names overlap', async () => {
  const { account, change, db } = await setup('director@akhbar.tv', 'beirut', true);
  const settings = db.getRow('settings', 'singleton')!;
  db.writeRow('settings', settings.id, { ...settings.d, departments: [
    { id: 'desk-beirut', name: 'مكتب المتابعة', stationIds: ['beirut'] },
    { id: 'desk-istanbul', name: 'مكتب المتابعة', stationIds: ['istanbul'] },
  ] }, settings.p, null);
  db.writeRow('users', account.id, { ...account.d, departmentId: undefined, department: 'مكتب المتابعة' }, account.p, null);
  const result = await change({ stationId: 'istanbul' }).expect(200);
  expect(result.body.results[0].code).toBe('FORBIDDEN');
  expect(result.body.results[0].message).toContain('قسم حسابك');
});

it.each(['gaza', null])('protects card governance when a linked branch moves to %s', async stationId => {
  const { change } = await setup('director@akhbar.tv', 'beirut', true);
  const result = await change({ stationId }).expect(200);
  expect(result.body.results[0].code).toBe('FORBIDDEN');
  expect(result.body.results[0].message).toContain('إدارة التكليفات');
});

it('keeps the home-station restriction for an administrator who can work on cards but cannot manage them', async () => {
  const { account, change, db } = await setup('director@akhbar.tv', 'beirut', true);
  db.writeRow('users', account.id, { ...account.d, customPermissions: ['!cards.manage'] }, account.p, null);
  const result = await change({ stationId: 'istanbul' }).expect(200);
  expect(result.body.results[0].code).toBe('FORBIDDEN');
  expect(result.body.results[0].message).toContain('استلام خطوات التكليفات');
});

it('keeps station-filtered material under its original policy even when the administrator can read both stations', async () => {
  const { account, change, db } = await setup('director@akhbar.tv', 'beirut', true, {
    media: { mode: 'everyone', scopes: [{ stationId: 'beirut', mode: 'selected', audiences: [{ roleIds: ['role-admin'] }] }] },
  });
  db.writeRow('media', 'station-dependent-media', { id: 'station-dependent-media', ownerId: account.id, title: 'مادة مرتبطة بمحطة المالك' }, -1, null);
  const result = await change({ stationId: 'istanbul' }).expect(200);
  expect(result.body.results[0].code).toBe('FORBIDDEN');
  expect(result.body.results[0].message).toContain('إتاحة الوحدات');
});
