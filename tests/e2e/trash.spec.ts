import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

test('administrator opens distinct program and guest bins and restores their records', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const fixtures = [
    { collection: 'programs', section: 'البرامج', field: 'name', title: 'برنامج اختبار الاستعادة' },
    { collection: 'guests', section: 'الضيوف', field: 'fullName', title: 'ضيف اختبار الاستعادة' },
  ].map(entry => ({ ...entry, id: `trash-${entry.collection}-${Date.now()}` }));
  const sync = (ops: unknown[]) => page.request.post('/api/v1/data/sync', {
    headers: { 'X-NRCS-Client': 'web' }, data: { ops },
  });
  const readCollections = async () => (await (await page.request.get('/api/v1/data')).json()).collections;

  try {
    const original = await readCollections();
    const entries = fixtures.map(({ collection, id, field, title }) => ({
      c: collection, id, op: 'upsert', d: { ...original[collection][0].d, id, [field]: title },
    }));
    const created = await (await sync(entries)).json();
    expect(created.results.every((result: { ok: boolean }) => result.ok)).toBe(true);
    const deleted = await (await sync(entries.map((entry, index) => ({
      ...entry, baseV: created.results[index].row.v,
      d: { ...entry.d, deletedAt: new Date().toISOString() },
    })))).json();
    expect(deleted.results.every((result: { ok: boolean }) => result.ok)).toBe(true);

    await openNav(page, 'سلة المحذوفات');
    const directory = page.getByRole('region', { name: 'سلة المحذوفات' });
    for (const fixture of fixtures) {
      await expect(directory.getByText(fixture.title, { exact: true })).toHaveCount(0);
      await expect(directory.getByRole('link', { name: 'محذوفات ' + fixture.section })).toBeVisible();
    }

    for (const fixture of fixtures) {
      await openNav(page, fixture.section);
      const name = 'محذوفات ' + fixture.section;
      await page.getByRole('link', { name }).click();
      const trash = page.getByRole('region', { name, exact: true });
      await expect(trash.getByText(fixture.title, { exact: true })).toBeVisible();
      const other = fixtures.find(entry => entry.id !== fixture.id)!;
      await expect(trash.getByText(other.title, { exact: true })).toHaveCount(0);
      await page.setViewportSize({ width: 375, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await trash.getByRole('button', { name: `استعادة ${fixture.title}` }).click();
      await expect(trash.getByRole('status')).toContainText(fixture.title);
      await expect(trash.getByRole('button', { name: `استعادة ${fixture.title}` })).toHaveCount(0);
      const updated = (await readCollections())[fixture.collection].find((row: { id: string }) => row.id === fixture.id);
      expect(updated.d.deletedAt).toBeNull();
      expect(updated.d[fixture.field]).toBe(fixture.title);
    }
    expect(admin.errors).toEqual([]);
  } finally {
    try {
      const current = await readCollections();
      const ops = fixtures.flatMap(({ collection, id }) => {
        const row = current?.[collection]?.find((entry: { id: string }) => entry.id === id);
        return row ? [{ c: collection, id, op: 'delete', baseV: row.v }] : [];
      });
      if (ops.length) expect((await sync(ops)).ok()).toBe(true);
    } finally {
      await admin.close();
    }
  }
});


test('news, program preparation, assignments and both task areas link to their own recycle bins', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  try {
    for (const [path, label] of [
      ['news', 'الأخبار'],
      ['episodes', 'الحلقات'],
      ['cards', 'التكليفات'],
      ['tasks', 'مهام العمل'],
      ['personal-tasks', 'المهام الشخصية'],
    ]) {
      await page.goto('/' + path);
      const title = 'محذوفات ' + label;
      await page.getByRole('link', { name: title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp('/trash/' + path + '$'));
      const section = page.getByRole('region', { name: title, exact: true });
      await expect(section.getByRole('combobox', { name: 'القسم' })).toHaveCount(0);
      await section.getByRole('link', { name: 'العودة إلى ' + label }).click();
      await expect(page).toHaveURL(new RegExp('/' + path + '$'));
    }
    expect(admin.errors).toEqual([]);
  } finally {
    await admin.close();
  }
});

test('administrator saves a separate retention period for each record type', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const settings = async () => (await (await page.request.get('/api/v1/data')).json()).collections.settings[0];
  const before = await settings();
  try {
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'البيانات');
    const form = page.getByRole('form', { name: 'مدد الاحتفاظ بالمحذوفات' });
    const news = form.getByRole('spinbutton', { name: 'الأخبار', exact: true });
    const programs = form.getByRole('spinbutton', { name: 'البرامج', exact: true });
    const files = form.getByRole('spinbutton', { name: 'ملفات الوسائط', exact: true });
    await expect(news).toHaveAttribute('placeholder', '30');
    await expect(programs).toHaveAttribute('placeholder', '30');
    await expect(files).toHaveAttribute('placeholder', '30');
    await news.fill('10');
    await programs.fill('60');
    await files.fill('0');
    await form.getByRole('button', { name: 'حفظ مدد الاحتفاظ' }).click();
    await page.getByRole('alertdialog', { name: 'تحديث مدد الحذف النهائي' }).getByRole('button', { name: 'حفظ المدد' }).click();
    await expect(form.getByRole('status')).toHaveText('حُفظت مدد الاحتفاظ بالمحذوفات.');
    expect((await settings()).d.trashRetentionDays).toEqual({ news: 10, programs: 60, media: 0 });
    await page.reload();
    await expect(news).toHaveValue('10');
    await expect(programs).toHaveValue('60');
    await expect(files).toHaveValue('0');
    expect(admin.errors).toEqual([]);
  } finally {
    try {
      const latest = await settings();
      if (latest.v !== before.v) {
        const cleanup = await page.request.post('/api/v1/data/sync', {
          headers: { 'X-NRCS-Client': 'web' },
          data: { ops: [{ c: 'settings', id: latest.id, baseV: latest.v, op: 'upsert', d: { ...latest.d, trashRetentionDays: before.d.trashRetentionDays } }] },
        });
        expect((await cleanup.json()).results[0].ok).toBe(true);
      }
    } finally {
      await admin.close();
    }
  }
});
