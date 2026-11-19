import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type request from 'supertest';
import { createTestServer, loginAgent } from '../helpers';
import { seedDatabase } from '../../src/server/seed';
import { DEFAULT_ROLE_DEFINITIONS } from '../../src/shared/rbac';

let server: Awaited<ReturnType<typeof createTestServer>>;
const H = { 'X-NRCS-Client': 'web' };
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(() => server.close());

const sync = (agent: request.Agent, ops: any[]) => agent.post('/api/v1/data/sync').set(H).send({ ops });
const liveEpisode = () => server.db.listCollection('episodes').find((e) => !e.d.deletedAt)!;
const softDelete = (row: { id: string; d: any; v: number }) => ({ c: 'episodes', op: 'upsert', id: row.id, d: { ...row.d, deletedAt: new Date().toISOString() }, baseV: row.v });

/** Logs in a demo account after giving it another system role. */
async function loginAs(userId: string, email: string, role: string) {
  const u = server.db.getRow('users', userId)!;
  server.db.writeRow('users', userId, { ...u.d, role, customRoleId: undefined, customPermissions: [] }, u.p, null);
  return loginAgent(server.app, email);
}

describe('episodes.delete', () => {
  it('is its own permission: producers and managers have it, preparers and directors do not', () => {
    const has = (code: string) => DEFAULT_ROLE_DEFINITIONS.find((r) => r.roleCode === code)!.permissions.includes('episodes.delete');
    for (const code of ['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'PRODUCER', 'MAIN_STATION_MANAGER']) expect(has(code), code).toBe(true);
    for (const code of ['PREPARER', 'DIRECTOR', 'PRESENTER', 'JOURNALIST', 'VIEWER', 'CREW']) expect(has(code), code).toBe(false);
    // Preparers and directors still edit episodes.
    for (const code of ['PREPARER', 'DIRECTOR']) expect(DEFAULT_ROLE_DEFINITIONS.find((r) => r.roleCode === code)!.permissions).toContain('episodes.edit');
  });

  it('a preparer and a director can edit an episode but not delete it', async () => {
    const preparer = await loginAs('usr-3', 'journalist@akhbar.tv', 'PREPARER');
    let ep = liveEpisode();
    const edit = await sync(preparer, [{ c: 'episodes', op: 'upsert', id: ep.id, d: { ...ep.d, description: 'تعديل المعدّة' }, baseV: ep.v }]);
    expect(edit.body.results[0].ok).toBe(true);
    ep = server.db.getRow('episodes', ep.id)! as any;
    const denied = await sync(preparer, [softDelete(ep as any)]);
    expect(denied.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const hard = await sync(preparer, [{ c: 'episodes', op: 'delete', id: ep.id }]);
    expect(hard.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const director = await loginAs('usr-10', 'crew@akhbar.tv', 'DIRECTOR');
    const cur = server.db.getRow('episodes', ep.id)! as any;
    const denied2 = await sync(director, [softDelete(cur)]);
    expect(denied2.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(server.db.getRow('episodes', ep.id)!.d.deletedAt).toBeFalsy();
  });

  it('a producer deletes an episode; restoring needs the same permission', async () => {
    const producer = await loginAgent(server.app, 'producer@akhbar.tv');
    const ep = liveEpisode() as any;
    const ok = await sync(producer, [softDelete(ep)]);
    expect(ok.body.results[0].ok).toBe(true);
    const deleted = server.db.getRow('episodes', ep.id)! as any;
    expect(deleted.d.deletedAt).toBeTruthy();

    const preparer = await loginAs('usr-3', 'journalist@akhbar.tv', 'PREPARER');
    const restore = (row: any) => ({ c: 'episodes', op: 'upsert', id: row.id, d: { ...row.d, deletedAt: undefined }, baseV: row.v });
    const denied = await sync(preparer, [restore(deleted)]);
    expect(denied.body.results[0]).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const back = await sync(producer, [restore(server.db.getRow('episodes', ep.id)!)]);
    expect(back.body.results[0].ok).toBe(true);
  });

  it('is granted once to stored system roles that predate it, not to preparers', async () => {
    const { db } = server;
    const strip = (code: string) => {
      const row = db.listCollection('roles').find((r) => r.d.roleCode === code)!;
      db.writeRow('roles', row.id, { ...row.d, permissions: row.d.permissions.filter((p: string) => p !== 'episodes.delete') }, row.p, null);
      return row.id;
    };
    const producerId = strip('PRODUCER');
    const preparerId = strip('PREPARER');
    db.setMeta('perm_grant:episodes.delete', '0');
    await seedDatabase(db, server.config);
    expect(db.getRow('roles', producerId)!.d.permissions).toContain('episodes.delete');
    expect(db.getRow('roles', preparerId)!.d.permissions).not.toContain('episodes.delete');
  });
});
