import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('guest and program counts stay complete after paging-sized bootstrap and search', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const suffix = Date.now().toString();
  const programId = `count-program-${suffix}`;
  const guestId = `count-guest-${suffix}`;
  const programName = `برنامج دقة ${suffix}`;
  const guestName = `ضيف دقة ${suffix}`;
  const createdRows: { c: string; id: string; v: number }[] = [];

  try {
    const initial = await (await page.request.get('/api/v1/data')).json();
    const sourceEpisode = initial.collections.episodes[0].d;
    const program = {
      id: programId,
      name: programName,
      shortName: programName,
      description: 'اختبار دقة العدد',
      coverImageUrl: '',
      typeId: 'pt-1',
      typeName: 'نشرة إخبارية',
      presenterId: 'usr-1',
      presenterName: 'محرر الاختبار',
      producerId: 'usr-1',
      producerName: 'محرر الاختبار',
      teamMembers: [],
      broadcastDays: ['الأحد'],
      broadcastTime: '20:00',
      durationMinutes: 50,
      channelName: 'قناة الاختبار',
      studioName: 'استوديو الاختبار',
      status: 'ACTIVE',
      episodesCount: 0,
      createdAt: new Date().toISOString(),
    };
    const guest = {
      id: guestId,
      fullName: guestName,
      avatarUrl: '/avatar.svg',
      organization: 'اختبار',
      jobTitle: 'محلل',
      specialty: 'اقتصاد',
      phone: '',
      email: '',
      totalAppearances: 0,
      createdAt: new Date().toISOString(),
    };
    const ops = [
      { c: 'programs', op: 'upsert', id: programId, d: program },
      { c: 'guests', op: 'upsert', id: guestId, d: guest },
      ...Array.from({ length: 120 }, (_, index) => {
        const id = `count-episode-${suffix}-${String(index).padStart(3, '0')}`;
        return {
          c: 'episodes',
          op: 'upsert',
          id,
          d: {
            ...sourceEpisode,
            id,
            title: `${programName} ${index + 1}`,
            programId,
            programName,
            episodeNumber: index + 1,
            broadcastDate: '2026-11-20',
            status: 'PLANNING',
            guests: [{
              id: guestId,
              guestId,
              guestName,
              connectionType: 'STUDIO',
              segmentTopic: 'اختبار العدد',
              arrivalStatus: 'CONFIRMED',
            }],
          },
        };
      }),
    ];
    const write = await page.request.post('/api/v1/data/sync', {
      headers: { 'X-NRCS-Client': 'web' },
      data: { ops },
    });
    expect(write.status()).toBe(200);
    const writeResult = await write.json();
    for (const result of writeResult.results) {
      if (result.ok && result.row) createdRows.push({ c: result.row.c, id: result.row.id, v: result.row.v });
    }
    expect(writeResult.results.every((result: any) => result.ok)).toBe(true);

    await page.reload();
    const bootstrap = await (await page.request.get('/api/v1/data')).json();
    expect(bootstrap.collections.episodes).toHaveLength(100);
    expect(bootstrap.windows.episodes.hasMore).toBe(true);

    await openNav(page, 'البرامج');
    await page.locator('#programs-search-input').fill(programName);
    await page.getByRole('button', { name: 'البطاقات', exact: true }).click();
    await expect(page.getByText('الحلقات (120)', { exact: true })).toBeVisible();

    await openNav(page, 'الضيوف');
    await page.locator('#guests-search-input').fill(guestName);
    await expect(page.getByText('عدد مرات الظهور: 120', { exact: true })).toBeVisible();
  } finally {
    try {
      if (createdRows.length) {
        const cleanup = await page.request.post('/api/v1/data/sync', {
          headers: { 'X-NRCS-Client': 'web' },
          data: {
            ops: [...createdRows].reverse().map(row => ({
              c: row.c,
              op: 'delete',
              id: row.id,
              baseV: row.v,
            })),
          },
        });
        expect(cleanup.status()).toBe(200);
        expect((await cleanup.json()).results.every((result: any) => result.ok)).toBe(true);
      }
    } finally {
      await close();
    }
  }
});
