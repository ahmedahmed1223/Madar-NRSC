import { expect, test } from '@playwright/test';
import { openNav, openSettingsSection, signIn } from './helpers';

test('selects an active Dropbox member from a second directory page', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const { page } = admin;
  const credentials = { appKey: 'samplekey', appSecret: 'sample-secret', refreshToken: 'test-team-refresh' };
  try {
    const status = (await (await page.request.get('/api/v1/storage/status')).json()).data;
    await page.route('**/api/v1/storage/dropbox/team-members', route => {
      const { cursor, ...submitted } = route.request().postDataJSON();
      expect(submitted).toEqual(credentials);
      const data = cursor === 'next-page'
        ? { members: [{ id: 'dbmid:reporter', name: 'Team Reporter' }] }
        : { members: [{ id: 'dbmid:editor', name: 'Team Editor' }], cursor: 'next-page' };
      return route.fulfill({ json: { success: true, data } });
    });
    await page.route('**/api/v1/storage/dropbox/connect', route => route.fulfill({ json: {
      success: true,
      data: { ...status, dropbox: { ...status.dropbox, connected: true, account: 'Team Reporter', accountMode: 'member' } },
    } }));
    await openNav(page, 'الإعدادات');
    await openSettingsSection(page, 'التخزين');
    const dropbox = page.getByRole('group', { name: 'Dropbox', exact: true });
    await dropbox.getByText('ربط Dropbox', { exact: true }).click();
    await dropbox.getByRole('radio', { name: 'لديّ Refresh token' }).check();
    await dropbox.getByRole('radio', { name: 'عضو من فريق Dropbox' }).check();
    await dropbox.getByLabel('App key', { exact: true }).fill(credentials.appKey);
    await dropbox.getByLabel('App secret', { exact: true }).fill(credentials.appSecret);
    await dropbox.getByLabel('Refresh token', { exact: true }).fill(credentials.refreshToken);
    await dropbox.getByRole('button', { name: 'عرض أعضاء الفريق النشطين' }).click();
    await expect(dropbox.getByRole('combobox', { name: 'عضو الفريق النشط' }).locator('option', { hasText: 'Team Editor' })).toHaveCount(1);
    await dropbox.getByRole('button', { name: 'عرض المزيد من الأعضاء' }).click();
    await dropbox.getByRole('combobox', { name: 'عضو الفريق النشط' }).selectOption({ label: 'Team Reporter' });
    await expect(dropbox.getByLabel('معرّف عضو الفريق')).toHaveValue('dbmid:reporter');
    const submission = page.waitForRequest(req => req.url().endsWith('/storage/dropbox/connect'));
    await dropbox.getByRole('button', { name: 'ربط', exact: true }).click();
    expect((await submission).postDataJSON()).toEqual({ ...credentials, accountMode: 'member', teamMemberId: 'dbmid:reporter' });
    await expect(dropbox.getByText(/بيانات الربط محفوظة.*Team Reporter/)).toBeVisible();
  } finally {
    await admin.close();
  }
});
