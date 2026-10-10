import { expect, it } from 'vitest';
import { sanitizeWorkContext, sanitizeWorkSections } from '../src/shared/workContext';

it('bounds context and excludes content and selection', () => {
  const value = sanitizeWorkContext({ schemaVersion: 1, definition: { activeTab: 'UNDER_REVIEW', onlyMine: true }, page: 3, anchorId: 'news-1', body: 'secret', selectedIds: ['news-1'], modal: true });
  expect(value.page).toBe(3);
  expect(value.anchorId).toBe('news-1');
  expect(value.definition.activeTab).toBe('UNDER_REVIEW');
  expect(value.definition.onlyMine).toBe(true);
  expect(value).not.toHaveProperty('body');
  expect(value).not.toHaveProperty('selectedIds');
  expect(value).not.toHaveProperty('modal');
});
it('defaults unknown schemas and malformed context instead of restoring actions', () => {
  for (const raw of [null, [], 'invalid', { schemaVersion: 2, page: 20, anchorId: 'news-1' }]) {
    expect(sanitizeWorkContext(raw).page).toBe(0);
    expect(sanitizeWorkContext(raw).anchorId).toBeUndefined();
  }
  const value = sanitizeWorkContext({ schemaVersion: 1, page: Infinity, anchorId: '../bad', definition: { activeTab: 'BAD', searchQuery: 's'.repeat(201), onlyMine: 'true' } });
  expect(value.page).toBe(0);
  expect(value.anchorId).toBeUndefined();
  expect(value.definition.activeTab).toBe('ALL');
  expect(value.definition.searchQuery).toBe('');
  expect(value.definition.onlyMine).toBe(false);
});
it('deduplicates section order and defaults new sections without retaining unknown keys', () => {
  const value = sanitizeWorkSections({ order: ['my-tasks', 'my-news', 'my-tasks', 'bad'], hidden: ['my-news', 'bad', 'my-news'] });
  expect(value.order.slice(0, 2)).toEqual(['my-tasks', 'my-news']);
  expect(value.order).toContain('my-mentions');
  expect(new Set(value.order).size).toBe(value.order.length);
  expect(value.hidden).toEqual(['my-news']);
  expect(value.order).not.toContain('bad');
});
