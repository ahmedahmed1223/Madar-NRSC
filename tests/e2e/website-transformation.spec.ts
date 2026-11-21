import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './helpers';

const VIEWPORTS = [320, 375, 390, 430, 768, 1024, 1440, 1920];
const WORKSPACES: ReadonlyArray<readonly [path: string, heading: string | RegExp]> = [
  ['/', /^مرحباً،/],
  ['/wires', 'المصادر'],
  ['/news', 'الأخبار'],
  ['/news/nws-1', 'تحرير الخبر'],
  ['/breaking', 'العاجل'],
  ['/bulletins', 'النشرات'],
  ['/bulletins/bul-demo-main', /^نشرة الثامنة/],
  ['/stories', 'التغطيات'],
  ['/diary', 'أجندة التغطية'],
  ['/programs', 'البرامج'],
  ['/programs/prg-1', 'المشهد السياسي'],
  ['/episodes', 'الحلقات'],
  ['/episodes/ep-101', /^قمة الاستثمار/],
  ['/calendar', 'جدول البث'],
  ['/guests', 'الضيوف'],
  ['/on-air', 'وضع الهواء'],
  ['/studio-screen', 'بانتظار بدء البث'],
  ['/media', 'مكتبة الوسائط'],
  ['/cards', 'التكليفات'],
  ['/requests', 'طلبات الأقسام'],
  ['/tasks', 'المهام'],
  ['/bookings', 'حجز الموارد'],
  ['/roster', 'جدول المناوبات'],
  ['/roster/handover', 'تسليم الوردية'],
  ['/workload', 'متابعة الفرق والتكاليف'],
  ['/reports', 'التقارير'],
  ['/audit', 'سجل التدقيق'],
  ['/users', 'المستخدمون والصلاحيات'],
  ['/settings', 'الإعدادات'],
  ['/settings/monitor', 'الإعدادات'],
  ['/help', 'المساعدة'],
  ['/guide', 'دليل الاستخدام'],
  ['/whats-new', 'ما الجديد'],
  ['/alerts', 'تنبيهاتي'],
  ['/messages', 'المراسلات'],
  ['/personal-notes', 'ملاحظاتي'],
];

test('workspace and detail routes render in RTL at eight widths without clipping the page', async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, close, errors } = await signIn(browser, 'admin@akhbar.tv');
  const failures = new Set<string>();
  const origin = new URL(page.url()).origin;
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= 400) failures.add(`${response.status()} ${url.pathname}`);
  });
  page.on('console', message => {
    const source = message.location().url;
    if (message.type() === 'error' && (!source || source.startsWith(origin))) failures.add(message.text());
  });

  try {
    for (const [route, heading] of WORKSPACES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const main = page.locator('#app-main');
      await expect(main.getByRole('heading', { name: heading, exact: typeof heading === 'string' }).first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.evaluate(() => document.fonts.ready);

      for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(async () => {
          // Give React's media-query subscribers a paint to switch layouts.
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          return [
            document.documentElement,
            document.querySelector('.app-scroll'),
            document.querySelector('#app-main'),
          ].map(el => el ? el.scrollWidth - el.clientWidth : 0);
        });
        expect.soft(Math.max(...overflow), `${route} at ${width}px, document/scroll area/main ${overflow.join('/')}`).toBeLessThanOrEqual(1);
      }
    }
    expect(errors).toEqual([]);
    expect([...failures]).toEqual([]);
  } finally {
    await close();
  }
});

test('a failed first data load can retry without signing in again', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 320, height: 700 } });
  const login = await context.request.post('/api/v1/auth/login', {
    headers: { 'X-NRCS-Client': 'web' },
    data: { email: 'reporter@akhbar.tv', password: DEMO_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const page = await context.newPage();
  let finishRequest!: () => void;
  const pending = new Promise<void>(resolve => { finishRequest = resolve; });
  await page.route('**/api/v1/data', async route => {
    await pending;
    await route.fulfill({ status: 503, json: { error: 'خدمة البيانات غير متاحة مؤقتاً' } });
  }, { times: 1 });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status')).toHaveText('جارٍ تحميل بيانات غرفة الأخبار...');
    finishRequest();
    await expect(page.getByRole('alert')).toHaveText('خدمة البيانات غير متاحة مؤقتاً');
    const retry = page.getByRole('button', { name: 'إعادة المحاولة' });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#app-main').getByRole('heading', { name: /^مرحباً،/ })).toBeVisible();
  } finally {
    finishRequest();
    await context.close();
  }
});
