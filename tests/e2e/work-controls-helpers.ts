import { expect, type FrameLocator, type Page } from '@playwright/test';

export const headers = { 'X-NRCS-Client': 'web' };

export async function sync(page: Page, ops: Record<string, unknown>[]) {
  const response = await page.request.post('/api/v1/data/sync', { headers, data: { ops } });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.results).toHaveLength(ops.length);
  expect(result.results.filter((op: { ok: boolean }) => !op.ok)).toEqual([]);
}

/** A real sandboxed same-origin embed, not an HTML replica of the controls. */
export async function embed(page: Page, path: string): Promise<FrameLocator> {
  await page.route('**/__work-controls-embed', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    headers: { 'Permissions-Policy': 'clipboard-write=()' },
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
      <iframe title="مساحة العمل المضمنة" src="${path}"
        sandbox="allow-scripts allow-same-origin allow-forms"
        allow="clipboard-write 'none'"
        style="display:block;width:100%;height:90vh;border:0"></iframe>
      <textarea aria-label="لصق للتحقق"></textarea>
    </body></html>`,
  }));
  // WebKit does not implement Chromium's clipboard Permissions Policy. Make denial
  // deterministic in both engines; leave execCommand, selection and paste REAL.
  await page.context().addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new DOMException('Embed denies clipboard', 'NotAllowedError'); } },
    });
  });
  await page.goto('/__work-controls-embed');
  return page.frameLocator('iframe');
}

export async function pastedText(page: Page) {
  const target = page.getByRole('textbox', { name: 'لصق للتحقق' });
  await target.fill('');
  await target.focus();
  await page.keyboard.press('ControlOrMeta+V');
  return target;
}

export async function selectPersonalStatus(app: FrameLocator, value: 'DONE' | 'ALL', label: string) {
  const mobile = app.getByRole('combobox', { name: 'تصفية المهام الشخصية' });
  if (await mobile.isVisible()) await mobile.selectOption(value);
  else await app.getByRole('tab', { name: new RegExp(label) }).click();
}

/** Model the OS refusing the legacy copy operation without changing app code. */
export async function denyLegacyCopy(app: FrameLocator) {
  await app.locator('body').evaluate(() => {
    document.execCommand = () => false;
  });
}

/** Detect clipped controls as well as document-level horizontal scrolling. */
export async function fitsViewport(root: Page | FrameLocator) {
  const body = root.locator('body');
  await expect(body).toBeVisible();
  const overflow = await body.evaluate(element => {
    const width = document.documentElement.clientWidth;
    return {
      document: document.documentElement.scrollWidth - width,
      controls: [...element.querySelectorAll('button, input, select, textarea')]
        .filter(control => control.getClientRects().length && !control.closest('[aria-hidden="true"]'))
        .filter(control => {
          const box = control.getBoundingClientRect();
          return box.left < -1 || box.right > width + 1;
        }).map(control => control.getAttribute('aria-label') || control.textContent),
    };
  });
  expect(overflow).toEqual({ document: 0, controls: [] });
}
