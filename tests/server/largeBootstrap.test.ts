import { expect, it } from 'vitest';
import { createTestServer, loginAgent } from '../helpers';

const headers = { 'X-NRCS-Client': 'web' };

it('bootstraps a bounded guest window and serves later pages and full-history search', async () => {
  const server = await createTestServer();
  try {
    const bounds = server.db.positionBounds('guests');
    server.db.transaction(() => {
      for (let index = 0; index < 260; index += 1) {
        const id = `page-guest-${String(index).padStart(3, '0')}`;
        server.db.writeRow('guests', id, {
          id,
          fullName: index === 259 ? 'علامة البحث التاريخية' : `ضيف صفحة ${index}`,
          organization: 'اختبار',
          jobTitle: 'محلل',
          specialty: 'اقتصاد',
          phone: '+966555010101',
        }, bounds.min - index - 1, null);
      }
    });

    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const bootstrap = await journalist.get('/api/v1/data');
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.collections.guests).toHaveLength(100);
    expect(bootstrap.body.windows.guests.hasMore).toBe(true);
    expect(typeof bootstrap.body.windows.guests.cursor).toBe('string');
    expect(bootstrap.body.collections.guests[0].d.phone).toBeUndefined();

    const beforePage = server.db.listCollection('guests').map(row => row.id);
    server.db.writeRow('guests', 'page-guest-live', { id: 'page-guest-live', fullName: 'ضيف وصل الآن' }, bounds.min - 10000, null);
    const second = await journalist.get(`/api/v1/data/collections/guests?cursor=${encodeURIComponent(bootstrap.body.windows.guests.cursor)}&limit=100`);
    expect(second.status).toBe(200);
    expect(second.body.rows).toHaveLength(100);
    expect(second.body.hasMore).toBe(true);
    expect(second.body.rows[0].d.phone).toBeUndefined();
    const pagedIds = [...bootstrap.body.collections.guests, ...second.body.rows].map((row: any) => row.id);
    let next = second.body;
    while (next.hasMore) {
      const page = await journalist.get(`/api/v1/data/collections/guests?cursor=${encodeURIComponent(next.cursor)}&limit=100`);
      expect(page.status).toBe(200);
      next = page.body;
      pagedIds.push(...next.rows.map((row: any) => row.id));
    }
    expect(new Set(pagedIds).size).toBe(pagedIds.length);
    expect(pagedIds).toEqual(expect.arrayContaining(beforePage));

    const historicalSearch = await journalist.get('/api/v1/data/collections/guests?query=%D8%B9%D9%84%D8%A7%D9%85%D8%A9%20%D8%A7%D9%84%D8%A8%D8%AD%D8%AB%20%D8%A7%D9%84%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE%D9%8A');
    expect(historicalSearch.status).toBe(200);
    expect(historicalSearch.body.rows.map((row: any) => row.id)).toEqual(['page-guest-259']);
    expect(historicalSearch.body.rows[0].d.phone).toBeUndefined();

    const matchingQuery = encodeURIComponent('ضيف صفحة');
    const matchingFirst = await journalist.get(`/api/v1/data/collections/guests?query=${matchingQuery}`);
    expect(matchingFirst.body.rows).toHaveLength(100);
    expect(matchingFirst.body.hasMore).toBe(true);
    const matchingSecond = await journalist.get(`/api/v1/data/collections/guests?query=${matchingQuery}&cursor=${encodeURIComponent(matchingFirst.body.cursor)}`);
    expect(matchingSecond.body.rows).toHaveLength(100);
    expect(matchingSecond.body.hasMore).toBe(true);
    const matchingThird = await journalist.get(`/api/v1/data/collections/guests?query=${matchingQuery}&cursor=${encodeURIComponent(matchingSecond.body.cursor)}`);
    expect(matchingThird.body.rows).toHaveLength(59);
    expect(matchingThird.body.hasMore).toBe(false);
  } finally {
    server.close();
  }
});

it('does not expose rows or pagination state for an unreadable collection', async () => {
  const server = await createTestServer();
  try {
    const restrictedUser = await loginAgent(server.app, 'media@akhbar.tv');
    const page = await restrictedUser.get('/api/v1/data/collections/guests');
    expect(page.status).toBe(403);
    const summaries = await restrictedUser.get('/api/v1/data/episode-summaries');
    expect(summaries.status).toBe(200);
    expect(summaries.body.data).toEqual({ available: true, programCounts: {}, guestSummaries: {} });
  } finally {
    server.close();
  }
});

it('returns complete guest and program counts without bootstrapping every episode', async () => {
  const server = await createTestServer();
  try {
    server.db.writeRow('programs', 'summary-program', {
      id: 'summary-program',
      name: 'برنامج الملخص',
      status: 'ACTIVE',
    }, -10_000, null);
    server.db.writeRow('guests', 'summary-guest', {
      id: 'summary-guest',
      fullName: 'ضيف الملخص',
      organization: 'اختبار',
      jobTitle: 'محلل',
      specialty: 'اقتصاد',
    }, -10_000, null);
    const guestBounds = server.db.positionBounds('guests');
    server.db.transaction(() => {
      for (let index = 0; index < 140; index += 1) {
        const id = `summary-search-guest-${String(index).padStart(3, '0')}`;
        server.db.writeRow('guests', id, {
          id,
          fullName: `ضيف بحث ${index}`,
          organization: 'اختبار',
          jobTitle: 'محلل',
          specialty: 'اقتصاد',
        }, guestBounds.min - index - 1, null);
      }
    });

    const bounds = server.db.positionBounds('episodes');
    server.db.transaction(() => {
      for (let index = 0; index < 140; index += 1) {
        const id = `summary-episode-${String(index).padStart(3, '0')}`;
        server.db.writeRow('episodes', id, {
          id,
          title: `حلقة بحث ملخص ${index}`,
          programId: 'summary-program',
          programName: 'برنامج الملخص',
          broadcastDate: `2026-11-${String((index % 25) + 1).padStart(2, '0')}`,
          guests: [{ guestId: 'summary-guest' }],
        }, bounds.min - index - 1, null);
      }
      server.db.writeRow('episodes', 'summary-deleted-episode', {
        id: 'summary-deleted-episode',
        programId: 'summary-program',
        guests: [{ guestId: 'summary-guest' }],
        deletedAt: '2026-11-25T00:00:00.000Z',
      }, bounds.min - 1_000, null);
    });

    const journalist = await loginAgent(server.app, 'journalist@akhbar.tv');
    const bootstrap = await journalist.get('/api/v1/data');
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.collections.episodes).toHaveLength(100);
    expect(bootstrap.body.windows.episodes.hasMore).toBe(true);
    expect(bootstrap.body.collections.guests).toHaveLength(100);
    expect(bootstrap.body.windows.guests.hasMore).toBe(true);

    const summaries = await journalist.get('/api/v1/data/episode-summaries');
    expect(summaries.status).toBe(200);
    expect(summaries.body.data.programCounts['summary-program']).toBe(140);
    expect(summaries.body.data.guestSummaries['summary-guest']).toMatchObject({
      totalAppearances: 140,
      lastAppearanceDate: '2026-11-25',
      monthlyAppearanceCounts: { '2026-11': 140 },
      appearanceHistory: expect.any(Array),
    });
    expect(summaries.body.data.guestSummaries['summary-guest'].appearanceHistory).toHaveLength(5);

    const page = await journalist.get(
      `/api/v1/data/collections/episodes?cursor=${encodeURIComponent(bootstrap.body.windows.episodes.cursor)}&limit=100`,
    );
    expect(page.status).toBe(200);
    const search = await journalist.get('/api/v1/data/collections/episodes?query=حلقة%20بحث%20ملخص&limit=100');
    expect(search.status).toBe(200);
    expect(search.body.rows).toHaveLength(100);
    const guestPage = await journalist.get(
      `/api/v1/data/collections/guests?cursor=${encodeURIComponent(bootstrap.body.windows.guests.cursor)}&limit=100`,
    );
    expect(guestPage.status).toBe(200);
    const guestSearch = await journalist.get('/api/v1/data/collections/guests?query=ضيف%20بحث&limit=100');
    expect(guestSearch.status).toBe(200);
    expect(guestSearch.body.rows).toHaveLength(100);
    const afterBrowsing = await journalist.get('/api/v1/data/episode-summaries');
    expect(afterBrowsing.body.data.programCounts['summary-program']).toBe(140);
    expect(afterBrowsing.body.data.guestSummaries['summary-guest'].totalAppearances).toBe(140);
  } finally {
    server.close();
  }
});

it('keeps assigned-only task scope in both bootstrap and full-history search', async () => {
  const server = await createTestServer();
  try {
    const reporter = server.db.getRow('users', 'usr-6')!;
    server.db.writeRow('users', reporter.id, { ...reporter.d, role: 'SUPPORT_SERVICES' }, reporter.p, null);
    server.db.writeRow('tasks', 'scope-task-own', { id: 'scope-task-own', title: 'مهمة ضمن النطاق', assigneeId: reporter.id, status: 'TODO' }, -2, null);
    server.db.writeRow('tasks', 'scope-task-hidden', { id: 'scope-task-hidden', title: 'مهمة خارج النطاق', assigneeId: 'usr-2', status: 'TODO' }, -1, null);
    const agent = await loginAgent(server.app, 'reporter@akhbar.tv');

    const bootstrap = await agent.get('/api/v1/data');
    expect(bootstrap.body.collections.tasks.map((row: any) => row.id)).toContain('scope-task-own');
    expect(bootstrap.body.collections.tasks.map((row: any) => row.id)).not.toContain('scope-task-hidden');

    const search = await agent.get('/api/v1/data/collections/tasks?query=%D9%85%D9%87%D9%85%D8%A9');
    expect(search.body.rows.map((row: any) => row.id)).toContain('scope-task-own');
    expect(search.body.rows.map((row: any) => row.id)).not.toContain('scope-task-hidden');
  } finally {
    server.close();
  }
});

it('keeps large-room bootstrap, paging and writes below stable local budgets', async () => {
  const server = await createTestServer();
  try {
    const groups = ['episodes', 'guests', 'tasks'] as const;
    for (const collection of groups) {
      const bounds = server.db.positionBounds(collection);
      server.db.transaction(() => {
        for (let index = 0; index < 1000; index += 1) {
          const id = `perf-${collection}-${String(index).padStart(4, '0')}`;
          const data = collection === 'guests'
            ? { id, fullName: `خبير أداء ${index}`, organization: 'غرفة أخبار', jobTitle: 'محلل', specialty: 'اقتصاد' }
            : collection === 'tasks'
              ? { id, title: `مهمة أداء ${index}`, status: 'TODO', priority: 'NORMAL', assigneeId: 'usr-2', createdAt: '2026-01-01T00:00:00.000Z' }
              : { id, title: `حلقة أداء ${index}`, programName: 'نشرة المساء', episodeNumber: index + 1, broadcastDate: '2026-01-01', status: 'PLANNING' };
          server.db.writeRow(collection, id, data, bounds.min - index - 1, null);
        }
      });
    }

    const roles = ['admin@akhbar.tv', 'journalist@akhbar.tv', 'media@akhbar.tv'];
    const measurements: Record<string, { medianMs: number; medianBytes: number; windowCounts: Record<string, number> }> = {};
    for (const email of roles) {
      const agent = await loginAgent(server.app, email);
      const samples: { ms: number; bytes: number; counts: Record<string, number> }[] = [];
      for (let repeat = 0; repeat < 5; repeat += 1) {
        const started = performance.now();
        const response = await agent.get('/api/v1/data');
        expect(response.status).toBe(200);
        samples.push({
          ms: performance.now() - started,
          bytes: Buffer.byteLength(JSON.stringify(response.body)),
          counts: Object.fromEntries(groups.map(collection => [collection, response.body.collections[collection]?.length || 0])),
        });
        for (const collection of groups) {
          expect(response.body.collections[collection]?.length || 0).toBeLessThanOrEqual(100);
          expect(response.body.windows[collection]).toBeDefined();
        }
      }
      const sortedMs = samples.map(sample => sample.ms).sort((a, b) => a - b);
      const sortedBytes = samples.map(sample => sample.bytes).sort((a, b) => a - b);
      measurements[email] = {
        medianMs: Math.round(sortedMs[2]),
        medianBytes: sortedBytes[2],
        windowCounts: samples[2].counts,
      };
      expect(measurements[email].medianMs).toBeLessThan(5000);
      expect(measurements[email].medianBytes).toBeLessThan(400_000);
    }
    console.info('large-room bootstrap measurements', JSON.stringify(measurements));

    const editor = await loginAgent(server.app, 'editor@akhbar.tv');
    const editorBootstrap = await editor.get('/api/v1/data');
    const episodeCursor = encodeURIComponent(editorBootstrap.body.windows.episodes.cursor);
    const readSamples: number[] = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      const started = performance.now();
      const response = await editor.get(`/api/v1/data/collections/episodes?cursor=${episodeCursor}&limit=100`);
      expect(response.status).toBe(200);
      expect(response.body.rows).toHaveLength(100);
      readSamples.push(performance.now() - started);
    }
    readSamples.sort((a, b) => a - b);
    expect(readSamples[2]).toBeLessThan(3000);

    const writeSamples: number[] = [];
    for (let batch = 0; batch < 3; batch += 1) {
      const ops = Array.from({ length: 10 }, (_, index) => {
        const id = `perf-write-${batch}-${index}`;
        return { c: 'guests', op: 'upsert', id, d: { id, fullName: `ضيف قياس ${batch}-${index}`, organization: 'اختبار' } };
      });
      const started = performance.now();
      const response = await editor.post('/api/v1/data/sync').set(headers).send({ ops });
      expect(response.status).toBe(200);
      expect(response.body.results.every((result: any) => result.ok)).toBe(true);
      writeSamples.push(performance.now() - started);
    }
    writeSamples.sort((a, b) => a - b);
    expect(writeSamples[1]).toBeLessThan(3000);
    console.info('large-room operation medians', JSON.stringify({
      pageReadMs: Math.round(readSamples[2]),
      tenRowWriteBatchMs: Math.round(writeSamples[1]),
    }));
  } finally {
    server.close();
  }
});
