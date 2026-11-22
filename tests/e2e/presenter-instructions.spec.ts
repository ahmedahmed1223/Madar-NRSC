import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

async function trackCueTones(page: Page) {
  await page.addInitScript(() => {
    const observed = window as Window & { cueTestToneCount?: number };
    observed.cueTestToneCount = 0;
    class TestAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      async resume() {}
      createOscillator() {
        return {
          frequency: { value: 0 }, connect: (target: unknown) => target,
          start: () => { observed.cueTestToneCount = (observed.cueTestToneCount || 0) + 1; }, stop() {},
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext });
  });
}

const cueTones = (page: Page) => page.evaluate(() => (window as Window & { cueTestToneCount?: number }).cueTestToneCount);

test('director instructions reach fullscreen prompter and studio independently', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@akhbar.tv');
  const presenter = await signIn(browser, 'presenter@akhbar.tv');
  const studio = await signIn(browser, 'crew@akhbar.tv');
  try {
    const mirror = await admin.page.context().newPage();
    await trackCueTones(presenter.page);
    await trackCueTones(studio.page);
    await trackCueTones(mirror);
    const initial = await (await admin.page.request.get('/api/v1/data')).json();
    const bulletin = initial.collections.bulletins.find((row: { d: { deletedAt?: string } }) => !row.d.deletedAt).d;
    const id = `instruction-test-${Date.now()}`;
    const record = { ...bulletin, id, title: 'بروفة توجيه المذيع', status: 'PLANNING' };
    const created = await admin.page.request.post('/api/v1/data/sync', { headers: { 'X-NRCS-Client': 'web' }, data: { ops: [{ c: 'bulletins', op: 'upsert', id, d: record }] } });
    expect((await created.json()).results[0].ok).toBe(true);

    await presenter.page.goto(`/bulletins/${id}`);
    await presenter.page.getByRole('button', { name: 'الملقن', exact: true }).click();
    const modal = presenter.page.getByRole('dialog', { name: 'الملقّن', exact: true });
    await modal.getByRole('button', { name: 'ملء الشاشة (F)', exact: true }).click();
    await expect.poll(() => presenter.page.evaluate(() => document.fullscreenElement?.getAttribute('aria-label'))).toBe('الملقّن');
    const sound = modal.getByRole('button', { name: 'صوت التوجيهات' });
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');

    await studio.page.goto(`/studio-screen/${id}`);
    const wall = studio.page.getByTestId('studio-wall');
    await mirror.goto(`/studio-screen/${id}`);
    const mirrorWall = mirror.getByTestId('studio-wall');
    for (const display of [wall, mirrorWall]) {
      await expect(display.getByRole('button', { name: 'صوت التوجيهات' })).toHaveCount(0);
    }
    await admin.page.goto(`/on-air/${id}`);
    await admin.page.getByLabel('المذيع المستهدف').selectOption('usr-5');
    await admin.page.getByRole('button', { name: 'اختصر خلال 30 ث', exact: true }).click();

    const banner = modal.getByTestId('presenter-instruction');
    await expect(banner).toContainText('اختصر خلال 30 ث');
    await expect(wall.getByTestId('presenter-instruction')).toContainText('اختصر خلال 30 ث');
    await expect(mirrorWall.getByTestId('presenter-instruction')).toContainText('اختصر خلال 30 ث');
    await expect.poll(() => cueTones(presenter.page)).toBe(1);
    expect(await cueTones(studio.page)).toBe(0);
    expect(await cueTones(mirror)).toBe(0);
    await banner.getByRole('button', { name: 'تم الاستلام' }).click();
    await expect(banner).toHaveCount(0);
    await expect(wall.getByTestId('presenter-instruction')).toBeVisible();

    await admin.page.context().setOffline(true);
    await expect(admin.page.getByRole('button', { name: 'انتقل للضيف', exact: true })).toBeDisabled();
    await admin.page.context().setOffline(false);
  } finally {
    await studio.page.context().close();
    await presenter.page.context().close();
    await admin.page.context().close();
  }
});
