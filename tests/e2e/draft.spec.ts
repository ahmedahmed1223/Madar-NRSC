import { expect, test } from '@playwright/test';
import { openNav, signIn } from './helpers';

test('news fields survive an immediate reload, including embargo fields', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv');
  await openNav(page, 'الأخبار');
  await page.locator('button[title="تحرير الخبر"]').first().click();
  const title = page.getByPlaceholder('اكتب عنواناً جذاباً ودقيقاً يصف جوهر الحدث...');
  await title.fill('مسودة لا تضيع عند التحديث');
  await page.fill('#news-embargo', '2027-01-01T09:00');
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'استعادة المسودة الآن' }).click();
  await expect(title).toHaveValue('مسودة لا تضيع عند التحديث');
  await expect(page.locator('#news-embargo')).toHaveValue('2027-01-01T09:00');
  await close();
});
