import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import type { AppUpdateStatus } from '../../src/shared/appUpdates';

test('shows an available app update and dispatches only after explicit confirmation', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const status: AppUpdateStatus = {
      deployedVersion: '4.1.2',
      latest: { version: '9.10.0', url: 'https://github.com/ahmedahmed1223/Madar-NRSC/releases/tag/v9.10.0' },
      broadcastActive: true, deployment: 'github', requestedVersion: null,
    };
    await page.route('**/api/v1/updates', (route) => route.fulfill({ json: { data: status } }));
    const requests: unknown[] = [];
    await page.route('**/api/v1/updates/deploy', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 202, json: { success: true } });
    });
    await page.goto('/whats-new');
    const panel = page.getByRole('region', { name: 'تحديثات مدار' });
    const check = panel.getByRole('button', { name: 'فحص الإصدارات' });
    await check.click();
    const deploy = panel.getByRole('button', { name: 'طلب نشر الإصدار على الخادم' });
    await expect(panel.getByRole('status')).toContainText('v9.10.0');
    await expect(deploy).toBeDisabled();
    status.broadcastActive = false;
    await check.click();
    await deploy.click();
    const confirmation = page.getByRole('alertdialog', { name: 'طلب نشر مدار v9.10.0' });
    await confirmation.getByRole('button', { name: 'تراجع' }).click();
    expect(requests).toHaveLength(0);
    await deploy.click();
    await confirmation.getByRole('button', { name: 'أؤكد انتهاء البث وأطلب النشر' }).click();
    await expect(panel.getByRole('status')).toContainText('استلم نظام النشر الطلب');
    expect(requests).toEqual([{ version: '9.10.0', localAirEnded: true }]);
    expect(await panel.getByRole('link', { name: 'ملاحظات الإصدار على GitHub' }).getAttribute('href')).toBe(status.latest?.url);
  } finally { await close(); }
});

test('reloads the browser after a newer build is deployed even when the release feed is unavailable', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'journalist@akhbar.tv');
  try {
    const status: AppUpdateStatus = {
      deployedVersion: '9.10.0', latest: null, broadcastActive: false, deployment: null, requestedVersion: null,
    };
    await page.route('**/api/v1/updates', (route) => route.fulfill({ json: { data: status } }));
    await page.goto('/whats-new');
    const panel = page.getByRole('region', { name: 'تحديثات مدار' });
    await panel.getByRole('button', { name: 'فحص الإصدارات' }).click();
    await expect(panel).toContainText('تعذر الوصول إلى أحدث إصدار منشور');
    await expect(panel.getByRole('button', { name: 'طلب نشر الإصدار على الخادم' })).toHaveCount(0);
    await Promise.all([
      page.waitForEvent('load'),
      panel.getByRole('button', { name: 'تحميل الواجهة الجديدة' }).click(),
    ]);
    await expect(panel.getByRole('button', { name: 'فحص الإصدارات' })).toBeVisible();
  } finally { await close(); }
});

test('explains why a newer release has no deployment button on an unconfigured host', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'admin@akhbar.tv');
  try {
    const status: AppUpdateStatus = {
      deployedVersion: '4.1.4', latest: { version: '9.10.0', url: 'https://github.com/ahmedahmed1223/Madar-NRSC/releases/tag/v9.10.0' },
      broadcastActive: false, deployment: null, requestedVersion: null,
    };
    await page.route('**/api/v1/updates', route => route.fulfill({ json: { data: status } }));
    await page.goto('/whats-new');
    const panel = page.getByRole('region', { name: 'تحديثات مدار' });
    await panel.getByRole('button', { name: 'فحص الإصدارات' }).click();
    await expect(panel.getByRole('status')).toContainText('النشر من داخل مدار غير مهيأ على هذا الخادم');
    await expect(panel.getByRole('button', { name: 'طلب نشر الإصدار على الخادم' })).toHaveCount(0);
  } finally { await close(); }
});
