import { expect, it } from 'vitest';
import { createTestServer } from '../helpers';
import { seedDatabase } from '../../src/server/seed';
it('upgrades stored system permissions without expanding custom roles', async () => {
  const server = await createTestServer();
  try {
    const editor = server.db.getRow('roles', 'role-editor')!;
    server.db.writeRow('roles', editor.id, { ...editor.d, permissions: editor.d.permissions.filter((p: string) => !p.startsWith('handover.')) }, editor.p, null);
    server.db.writeRow('roles', 'custom-editor', { ...editor.d, id: 'custom-editor', isSystemRole: false, permissions: ['news.view'] }, 100, null);
    for (const code of ['view', 'publish', 'manage']) server.db.setMeta(`perm_grant:handover.${code}`, '0');
    await seedDatabase(server.db, server.config);
    expect(server.db.getRow('roles', editor.id)!.d.permissions).toContain('handover.publish');
    expect(server.db.getRow('roles', 'custom-editor')!.d.permissions).toEqual(['news.view']);
  } finally { server.close(); }
});
