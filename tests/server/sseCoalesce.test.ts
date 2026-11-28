import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { changeBus, createRevCoalescer, SSE_REV_COALESCE_MS } from '../../src/server/sync';
import { createTestServer, DEMO_PASSWORD, listen } from '../helpers';

describe('SSE changeBus rev coalescing', () => {
  it('coalesces rapid rev pushes into a single flush with the latest rev and cancels cleanly', () => {
    vi.useFakeTimers();
    try {
      const flushed: number[] = [];
      const coalescer = createRevCoalescer((rev) => flushed.push(rev), SSE_REV_COALESCE_MS);

      for (let i = 1; i <= 50; i++) coalescer.push(100 + i);
      expect(flushed).toEqual([]);

      vi.advanceTimersByTime(SSE_REV_COALESCE_MS - 1);
      expect(flushed).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(flushed).toEqual([150]);

      // Subsequent burst flushes independently with latest value.
      coalescer.push(151);
      coalescer.push(152);
      vi.advanceTimersByTime(SSE_REV_COALESCE_MS);
      expect(flushed).toEqual([150, 152]);

      // Cancelling before timer fires drops pending flush without leaking timers.
      coalescer.push(200);
      coalescer.cancel();
      vi.advanceTimersByTime(SSE_REV_COALESCE_MS * 2);
      expect(flushed).toEqual([150, 152]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('over live /api/v1/data/stream HTTP connection', () => {
    let srv: Awaited<ReturnType<typeof createTestServer>>;
    let httpSrv: Awaited<ReturnType<typeof listen>>;
    let cookie: string;

    beforeAll(async () => {
      srv = await createTestServer();
      httpSrv = await listen(srv.app);
      const loginRes = await fetch(`${httpSrv.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' },
        body: JSON.stringify({ email: 'editor@akhbar.tv', password: DEMO_PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    });

    afterAll(async () => {
      await httpSrv.close();
      srv.close();
    });

    it('coalesces 50 rapid changeBus rev emissions into a single SSE rev event with the latest rev', async () => {
      const controller = new AbortController();
      const res = await fetch(`${httpSrv.baseUrl}/api/v1/data/stream`, {
        headers: { Cookie: cookie },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      const readUntil = async (predicate: (text: string) => boolean, timeoutMs = 2000) => {
        const deadline = Date.now() + timeoutMs;
        while (!predicate(buffer)) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error(`Timed out waiting for SSE data. Buffer:\n${buffer}`);
          const chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE read timeout')), remaining)),
          ]);
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      };

      // Wait for initial handshake rev event.
      await readUntil((text) => text.includes('event: rev\n'));
      const afterHandshake = buffer.length;

      // Emit a burst of 50 rapid revisions.
      const baseRev = 10_000;
      for (let i = 1; i <= 50; i++) {
        changeBus.emit('rev', baseRev + i);
      }

      // Wait for the coalesced event to arrive (within 80ms + margin).
      await readUntil((text) => text.slice(afterHandshake).includes(`data: ${baseRev + 50}\n\n`), 1000);

      // Give a brief window to confirm no extra stray rev events arrive.
      await new Promise((r) => setTimeout(r, SSE_REV_COALESCE_MS + 40));

      const burstPayload = buffer.slice(afterHandshake);
      const revEvents = [...burstPayload.matchAll(/event: rev\ndata: (\d+)\n\n/g)].map((m) => Number(m[1]));
      expect(revEvents).toEqual([baseRev + 50]);

      controller.abort();
      await reader.cancel().catch(() => undefined);
    });
  });
});
