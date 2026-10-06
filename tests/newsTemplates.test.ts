import { expect, it } from 'vitest';
import { settingsError } from '../src/shared/settings';
import { INITIAL_SETTINGS } from '../src/services/mockData';
it('accepts named text templates', () => {
  expect(settingsError({ ...INITIAL_SETTINGS, newsTemplates: [{ id: 't1', name: 'خبر محلي', body: 'مقدمة\nتفاصيل\nمصدر' }] })).toBeNull();
});
it.each([{ templates: [{ id: 't1', name: '', body: 'نص' }] }, { templates: [{ id: 't1', name: 'خبر', body: '' }] },
  { templates: [{ id: 't1', name: 'خبر', body: 'نص' }, { id: 't2', name: 'خبر', body: 'نص آخر' }] }])('rejects invalid or duplicate templates', ({ templates }) => {
  expect(settingsError({ ...INITIAL_SETTINGS, newsTemplates: templates } as any)).toBeTruthy();
});
