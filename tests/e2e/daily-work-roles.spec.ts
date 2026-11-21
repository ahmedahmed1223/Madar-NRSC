import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { REQUEST_TYPES } from '../../src/shared/production';

test('the editorial dashboard opens a story by keyboard', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  try {
    await page.getByRole('button', { name: 'مسودات قيد العمل', exact: false }).first().click();
    const story = page.getByRole('button', { name: /بطولات التنس العالمية/ });
    await expect(story).toBeVisible();
    await story.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/news\/nws-5(?:[/?#]|$)/);
  } finally {
    await close();
  }
});

test('manager overview moves keyboard focus to the selected detail on a narrow screen', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 320, height: 780 } });
  try {
    const overview = page.getByTestId('today-status');
    const metric = overview.getByRole('button', { name: /^نشرات وحلقات/ });
    await metric.focus();
    await page.keyboard.press('Enter');
    await expect(overview.getByRole('heading', { name: 'نشرات وحلقات اليوم' })).toBeFocused();
    expect(await overview.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(
      await overview.evaluate(element => element.clientWidth),
    );
  } finally {
    await close();
  }
});

for (const width of [390, 1440]) {
  test(`personal sections can be arranged and hidden (${width}px)`, async ({ browser }) => {
    const { page, close } = await signIn(browser, 'journalist@akhbar.tv', { viewport: { width, height: 900 } });
    const panel = page.getByTestId('my-work');
    await panel.getByRole('button', { name: 'تخصيص عملي' }).click();
    await panel.getByRole('button', { name: 'استعادة الترتيب الافتراضي' }).click();
    await expect(panel.getByRole('checkbox', { name: 'عرض أخباري قيد العمل' })).toBeChecked();
    await panel.getByRole('checkbox', { name: 'عرض أخباري قيد العمل' }).uncheck();
    await expect(panel.getByTestId('my-news')).toHaveCount(0);
    await panel.getByRole('button', { name: 'تقديم مهامي', exact: true }).click();
    const { user } = await (await page.request.get('/api/v1/auth/me')).json();
    await expect.poll(async () => {
      const { collections } = await (await page.request.get('/api/v1/data')).json();
      const preferences = collections.workspacePrefs.find((row: any) => row.id === user.id)?.d.workSections;
      return !!preferences?.hidden.includes('my-news') && preferences.order.indexOf('my-tasks') < preferences.order.indexOf('my-news');
    }).toBe(true);
    await page.reload();
    await expect(page.getByTestId('my-news')).toHaveCount(0);
    await expect(page.getByTestId('my-tasks')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('my-work').getByRole('button', { name: 'تخصيص عملي' }).click();
    await page.screenshot({ path: `test-results/daily-work-${width}.png`, fullPage: true });
    await close();
  });
}

test('assigned task opens its exact focused list and missing targets recover neutrally', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const userId = data.collections.users.find((row: any) => row.d.email === 'editor@akhbar.tv').id;
  const created = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'tasks', op: 'upsert', id: 'daily-focus-task', d: { id: 'daily-focus-task', title: 'Daily focused task', description: '', status: 'TODO', priority: 'NORMAL', assigneeId: userId, dueDate: '' } }] } });
  expect((await created.json()).results[0].ok).toBe(true);
  await page.reload();
  await page.getByTestId('my-tasks').getByRole('button', { name: 'Daily focused task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/daily-focus-task$/);
  await expect(page.getByRole('button', { name: 'عرض كل المهام' })).toBeVisible();
  await page.goto('/tasks/missing-target');
  await expect(page.getByText('العنصر المطلوب غير متاح؛ يمكنك متابعة العمل من القائمة.')).toBeVisible();
  await close();
});

test('custom permission overrides determine work sections instead of the default role name', async ({ browser }) => {
  const administrator = await signIn(browser, 'admin@akhbar.tv');
  const data = await (await administrator.page.request.get('/api/v1/data')).json();
  const original = data.collections.users.find((row: any) => row.d.email === 'journalist@akhbar.tv');
  const change = async (value: any, version: number) => administrator.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'users', op: 'upsert', id: original.id, d: value, baseV: version }] } });
  const updated = await (await change({ ...original.d, customPermissions: ['!news.create', 'news.review'] }, original.v)).json();
  expect(updated.results[0].ok).toBe(true);
  try {
    const journalist = await signIn(browser, 'journalist@akhbar.tv');
    await expect(journalist.page.getByTestId('my-news')).toHaveCount(0);
    await expect(journalist.page.getByTestId('my-review')).toBeVisible();
    await journalist.close();
  } finally {
    const latest = await (await administrator.page.request.get('/api/v1/data')).json();
    const current = latest.collections.users.find((row: any) => row.id === original.id);
    const restored = await (await change({
      ...current.d,
      customPermissions: original.d.customPermissions ?? [],
    }, current.v)).json();
    expect(restored.results[0]).toMatchObject({ ok: true });
    await administrator.close();
  }
});

test('operational readiness warnings remain visible despite a hidden-section preference', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const data = await (await page.request.get('/api/v1/data')).json();
  const adminId = data.collections.users.find((row: any) => row.d.email === 'admin@akhbar.tv').id;
  const timezone = data.collections.settings[0].d.defaultTimezone.split(/[\s(]/)[0];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn' }).format(new Date());
  const seed = data.collections.episodes[0].d;
  const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'episodes', op: 'upsert', id: 'work-warning-episode', d: { ...seed, id: 'work-warning-episode', title: 'Work readiness warning', status: 'DRAFT', broadcastDate: today, rundown: [], guests: [] } }] } });
  expect((await response.json()).results[0].ok).toBe(true);
  await page.evaluate(id => localStorage.setItem(`madar-work-sections:${id}`, JSON.stringify({ hidden: ['my-episodes'] })), adminId);
  await page.reload();
  await expect(page.getByTestId('my-episodes')).toBeVisible();
  await page.getByTestId('my-work').getByRole('button', { name: 'تخصيص عملي' }).click();
  await expect(page.getByRole('checkbox', { name: 'عرض الحلقات القادمة وجاهزيتها' })).toBeDisabled();
  await expect(page.getByText('يتضمن تنبيهات تشغيلية ولا يمكن إخفاؤه الآن').first()).toBeVisible();
  await page.getByTestId('my-episodes').getByRole('button', { name: /Work readiness warning/ }).click();
  await expect(page).toHaveURL(/\/episodes\/work-warning-episode$/);
  await close();
});

test('department request rows open the exact request and unavailable targets fall back', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'requests', op: 'upsert', id: 'daily-focus-request', d: { type: REQUEST_TYPES[0].id, title: 'Daily focused request', details: 'Prepare the material', priority: 'NORMAL' } }] } });
  expect((await response.json()).results[0].ok).toBe(true);
  await page.reload();
  await page.getByTestId('my-sent-requests').getByRole('button', { name: /Daily focused request/ }).click();
  await expect(page).toHaveURL(/\/requests\/daily-focus-request$/);
  await expect(page.getByRole('button', { name: 'عرض جميع الطلبات', exact: true })).toBeVisible();
  await expect(page.locator('main article')).toHaveCount(1);
  await page.goto('/requests/missing-target');
  await expect(page.getByText('العنصر المطلوب غير متاح؛ يمكنك متابعة العمل من القائمة.')).toBeVisible();
  await close();
});

test('returned bulletin work opens the exact story rather than only its bulletin', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  const send = async (ops: any[]) => {
    const response = await page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops } });
    for (const result of (await response.json()).results) expect(result.ok).toBe(true);
  };
  const data = await (await page.request.get('/api/v1/data')).json();
  const timezone = data.collections.settings[0].d.defaultTimezone.split(/[\s(]/)[0];
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn' }).format(new Date());
  await send([{ c: 'bulletins', op: 'upsert', id: 'daily-story-bulletin', d: { title: 'Daily work bulletin', date, startTime: '23:00', plannedSeconds: 600, kind: 'MAIN', status: 'DRAFT', anchors: [] } }]);
  await send([{ c: 'bulletinStories', op: 'upsert', id: 'daily-work-story', d: { bulletinId: 'daily-story-bulletin', slug: 'Daily returned story', type: 'READER', status: 'DRAFT', rank: 0, script: 'Copy to check', returnNote: 'Recheck this copy' } }]);
  await page.reload();
  await page.getByTestId('my-bulletins').getByRole('button', { name: /Daily returned story/ }).click();
  await expect(page).toHaveURL(/\/bulletins\/daily-story-bulletin$/);
  await expect(page.getByTestId('story-editor')).toBeVisible();
  await close();
});
