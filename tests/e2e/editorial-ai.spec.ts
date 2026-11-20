import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

async function mockProviders(page: Page) {
  await page.route('**/api/v1/ai/status', route => route.fulfill({ json: {
    success: true, configured: true, defaultProvider: 'gemini', model: 'test-gemini',
    providers: [
      { id: 'gemini', model: 'test-gemini' }, { id: 'openai', model: 'test-openai' }, { id: 'openrouter', model: 'test-router' },
    ],
  } }));
}

test('the newsroom previews a proofreading result with the chosen provider before applying it', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'editor@akhbar.tv', { viewport: { width: 390, height: 900 } });
  try {
    await mockProviders(page);
    let input: Record<string, unknown> | undefined;
    await page.route('**/api/v1/ai/copilot', route => {
      input = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, data: { type: 'PROOFREAD', notes: ['تصويب أسلوبي'], correctionsCount: 1, polishedContent: '<p>صياغة محررة للمراجعة</p>' } } });
    });
    await page.goto('/news/new');
    const body = page.getByRole('textbox', { name: 'محتوى الخبر', exact: true });
    const source = 'نص الخبر الأصلي للمراجعة';
    await body.fill(source);
    await page.getByText('أدوات الخبر', { exact: true }).click();
    await page.getByRole('button', { name: 'المساعد الذكي', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'المساعد التحريري الذكي لغرفة الأخبار' });
    await expect(dialog.getByLabel('مزوّد الذكاء الاصطناعي')).toBeVisible({ timeout: 4_000 });
    await dialog.getByLabel('مزوّد الذكاء الاصطناعي').selectOption('openai');
    await dialog.getByRole('button', { name: 'التدقيق الأسلوبي' }).click();
    await dialog.getByLabel('توجيه تحريري اختياري').fill('صحّح الترقيم');
    await dialog.getByRole('button', { name: 'توليد المقترحات' }).click();
    await expect(dialog.getByText('صياغة محررة للمراجعة')).toBeVisible();
    expect(input).toMatchObject({ mode: 'PROOFREAD', provider: 'openai', instruction: 'صحّح الترقيم', content: expect.stringContaining(source) });
    await expect(body).toHaveText(source);
    await dialog.getByRole('button', { name: 'تطبيق النص المصوب' }).click();
    await expect(body).toHaveText('صياغة محررة للمراجعة');
  } finally { await close(); }
});

test('the episode copilot opens a question draft and treats guest names as suggestions', async ({ browser }) => {
  const { page, close } = await signIn(browser, 'producer@akhbar.tv');
  try {
    const { collections } = await (await page.request.get('/api/v1/data')).json();
    const episodeId = collections.episodes[0].id;
    const question = 'ما الأثر المتوقع على الأسر خلال العام المقبل؟';
    const guest = 'ضيف عام مقترح للتحقق';
    const idea = 'قارن السلال الغذائية في ثلاث مناطق';
    await mockProviders(page);
    await page.route('**/api/v1/ai/copilot', route => {
      const { mode, title, content } = route.request().postDataJSON();
      expect(content).toBe('التغيرات في تكلفة المعيشة');
      expect(title).toBe('موضوع للنشر بلا تفاصيل داخلية');
      const suggestion = mode === 'QUESTIONS' ? question : mode === 'GUESTS' ? guest : idea;
      return route.fulfill({ json: { success: true, data: { type: mode, suggestions: [{ title: suggestion, reason: 'زاوية اقتصادية للمناقشة' }] } } });
    });
    await page.goto(`/episodes/${episodeId}`);
    await page.getByRole('button', { name: /أسئلة الحوارات/ }).click();
    await expect(page.getByRole('button', { name: 'اقتراح أسئلة وأفكار' })).toBeVisible({ timeout: 4_000 });
    await page.getByRole('button', { name: 'اقتراح أسئلة وأفكار' }).click();
    const dialog = page.getByRole('dialog', { name: 'المساعد الذكي لإعداد الحلقة' });
    await dialog.getByLabel('عنوان الموضوع للمساعد').fill('موضوع للنشر بلا تفاصيل داخلية');
    await dialog.getByLabel('موجز الموضوع للمساعد').fill('التغيرات في تكلفة المعيشة');
    await dialog.getByRole('button', { name: 'توليد المقترحات' }).click();
    await expect(dialog.getByText(question, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'فتح مسودة سؤال' }).click();
    await expect(page.getByRole('textbox', { name: /نص السؤال/ })).toHaveValue(question);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('episode-questions')).not.toContainText(question);

    await page.getByRole('button', { name: /الضيوف والحجز/ }).click();
    await page.getByRole('button', { name: 'اقتراح ضيوف بالذكاء الاصطناعي' }).click();
    await dialog.getByLabel('عنوان الموضوع للمساعد').fill('موضوع للنشر بلا تفاصيل داخلية');
    await dialog.getByLabel('موجز الموضوع للمساعد').fill('التغيرات في تكلفة المعيشة');
    await dialog.getByRole('button', { name: 'توليد المقترحات' }).click();
    await expect(dialog.getByText(guest, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/تحقّق من الهوية/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'فتح مسودة سؤال' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'أفكار وزوايا' }).click();
    await dialog.getByRole('button', { name: 'توليد المقترحات' }).click();
    await expect(dialog.getByText(idea, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally { await close(); }
});
