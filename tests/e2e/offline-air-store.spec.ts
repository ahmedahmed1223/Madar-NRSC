import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('encrypted storage survives reload and failed refresh without leaking scripts', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const data = await (await page.request.get('/api/v1/data')).json();
    const id = data.collections.bulletins[0].id;
    const packet = (await (await page.request.get(`/api/v1/air-offline/packet/${id}`)).json()).packet;
    expect(packet).toBeTruthy();
    await page.evaluate(async packet => {
      const store = await import('/offline-store-test.js' as string);
      await store.savePacket(packet, 'device-secret');
      const result = await store.unlockPacket(packet.packetId, 'device-secret');
      await store.saveLocalState(packet.packetId, result.key, { selected: 1 });
    }, packet);
    await page.reload();
    const result = await page.evaluate(async packet => {
      const store = await import('/offline-store-test.js' as string);
      const unlocked = await store.unlockPacket(packet.packetId, 'device-secret');
      let wrongSecret = false;
      try { await store.unlockPacket(packet.packetId, 'wrong-secret'); } catch { wrongSecret = true; }
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (() => { throw new DOMException('quota', 'QuotaExceededError'); }) as any;
      let failed = false;
      try { await store.savePacket({ ...packet, packetId: 'failed-refresh' }, 'device-secret'); } catch { failed = true; }
      indexedDB.open = open;
      const preserved = await store.unlockPacket(packet.packetId, 'device-secret');
      const metadata = await store.listPacketMetadata();
      await store.purgeUser('different-user');
      const retained = await store.listPacketMetadata();
      await store.purgeUser(packet.userId);
      return { local: unlocked.local, wrongSecret, failed, same: JSON.stringify(preserved.packet) === JSON.stringify(unlocked.packet), metadata, retained: retained.length, empty: (await store.listPacketMetadata()).length };
    }, packet);
    expect(result.local).toEqual({ selected: 1 });
    expect(result.wrongSecret).toBe(true); expect(result.failed).toBe(true); expect(result.same).toBe(true);
    expect(result.metadata[0]).not.toHaveProperty('show'); expect(result.metadata[0]).not.toHaveProperty('script');
    expect(result.retained).toBe(1); expect(result.empty).toBe(0);
  } finally { await close(); }
});
