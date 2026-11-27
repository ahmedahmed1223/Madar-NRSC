import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.use({ actionTimeout: 10_000 });

test('an earlier correction keeps the same line visible in the prompter', async ({ browser }) => {
  const readerSession = await signIn(browser, 'admin@akhbar.tv', { viewport: { width: 1440, height: 900 } });
  const { page } = readerSession;
  const id = `prompter-revision-${Date.now()}`;
  const storyId = `${id}-story`;
  const anchor = 'هذه الجملة الحالية عند خط القراءة.';
  const paragraphs = (prefix: string) => Array.from({ length: 15 }, (_, index) => `${prefix} ${index + 1}.`).join('\n');
  const script = [paragraphs('هذه فقرة سابقة من نص المذيع'), anchor, paragraphs('تأتي هذه الفقرة بعد الجملة الحالية')].join('\n');
  const correction = 'مقدمة أضيفت بعد بدء قراءة النص.';
  const correctedScript = `${Array.from({ length: 7 }, () => correction).join('\n')}\n${script}`;
  const headers = { 'X-NRCS-Client': 'web' };
  const editor = await signIn(browser, 'admin@akhbar.tv');
  try {
    const data = await (await page.request.get('/api/v1/data')).json();
    const seed = await page.request.post('/api/v1/data/sync', { headers, data: { ops: [
      { c: 'bulletins', op: 'upsert', id, d: { ...data.collections.bulletins[0].d, id, title: id, status: 'PLANNING', approvalSteps: [] } },
      { c: 'bulletinStories', op: 'upsert', id: storyId, d: {
        ...data.collections.bulletinStories[0].d, id: storyId, bulletinId: id, rank: 1000, slug: 'قصة التصحيح',
        script, type: 'READER', status: 'DRAFT', newsId: undefined, approvals: [], clipMediaId: undefined,
      } },
    ] } });
    expect((await seed.json()).results.every((item: any) => item.ok)).toBe(true);
    const openStory = async (target: typeof page) => {
      await target.goto(`/bulletins/${id}`);
      await target.getByRole('button', { name: 'فتح قصة التصحيح', exact: true }).click();
      return target.getByTestId('story-editor');
    };
    const approve = async (story: ReturnType<typeof page.getByTestId>) => {
      await story.getByRole('button', { name: /حفظ واعتماد للهواء|اعتمادي/ }).click();
      await expect(story).not.toBeVisible();
    };
    await approve(await openStory(page));
    await page.getByRole('button', { name: 'الملقن', exact: true }).click();
    const prompter = page.getByRole('dialog', { name: 'الملقّن', exact: true });
    const reader = prompter.getByRole('region', { name: 'نص الملقّن' });
    const position = (align = false) => reader.evaluate((element, input) => {
      const tree = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = tree.nextNode();
      while (node && !node.textContent?.includes(input.anchor)) node = tree.nextNode();
      if (!node?.textContent || !element.parentElement) throw new Error('The reading line is missing');
      const offset = node.textContent.indexOf(input.anchor);
      const glyph = document.createRange();
      glyph.setStart(node, offset);
      glyph.setEnd(node, offset + 1);
      const area = element.parentElement.getBoundingClientRect();
      const line = area.top + area.height / 3;
      if (input.align) element.scrollTop += glyph.getBoundingClientRect().top - line - 2;
      return { top: glyph.getBoundingClientRect().top - line, scroll: element.scrollTop };
    }, { anchor, align });

    const before = await position(true);
    expect(before.scroll).toBeGreaterThan(0);
    const edit = await openStory(editor.page);
    const draft = edit.getByPlaceholder(/النص كما سيقرؤه المذيع/);
    await draft.fill(correctedScript);
    await draft.press('Control+s');
    await expect(edit).not.toBeVisible();
    await expect(prompter.getByRole('status').filter({ hasText: 'النص المعتمد السابق' })).toBeVisible();
    await expect(reader).not.toContainText(correction);
    expect((await position()).scroll).toBe(before.scroll);
    await approve(await openStory(editor.page));
    await expect(reader).toContainText(correction);
    await expect(prompter.getByRole('status').filter({ hasText: 'حُدّث نص الملقّن' })).toBeVisible();
    await expect.poll(async () => Math.abs((await position()).top - before.top)).toBeLessThanOrEqual(3);
    expect((await position()).scroll).toBeGreaterThan(before.scroll);
  } finally {
    await Promise.allSettled([editor.page.context().close(), readerSession.page.context().close()]);
  }
});
