import { expect, it } from 'vitest';
import { workContextPage, readWorkContext, writeWorkContext, sanitizeWorkContext, sanitizeWorkSections } from '../src/shared/workContext';

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

it('restores legacy metadata without copying content and partitions users and tabs', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  entries.set('nrcs_news_context:user-a:ALL', JSON.stringify({ activeTab: 'UNDER_REVIEW', searchQuery: 'headline', page: 2, body: 'private' }));
  expect(readWorkContext(storage, 'user-a', 'ALL').definition.searchQuery).toBe('headline');
  expect(readWorkContext(storage, 'user-b', 'ALL').definition.searchQuery).toBe('');
  expect(readWorkContext(storage, 'user-a', 'BREAKING').definition.activeTab).toBe('BREAKING');
  expect(writeWorkContext(storage, 'user-a', 'ALL', { schemaVersion: 1, page: 1, definition: { onlyMine: true }, body: 'private' })).toBe(true);
  expect(entries.get('nrcs_news_context:user-a:ALL')).not.toContain('private');
});
it('recovers from malformed or refused storage and rejects obsolete schemas', () => {
  const broken = { getItem: () => '{bad', setItem: () => { throw new Error('blocked'); } };
  expect(readWorkContext(broken, 'user-a', 'ALL').page).toBe(0);
  expect(writeWorkContext(broken, 'user-a', 'ALL', { schemaVersion: 1 })).toBe(false);
  const unknown = { getItem: () => JSON.stringify({ schemaVersion: 2, page: 99, activeTab: 'PUBLISHED' }) };
  expect(readWorkContext(unknown, 'user-a', 'ALL').page).toBe(0);
});
it('finds an anchor on its new page and falls back to the top when it disappears', () => {
  const context = sanitizeWorkContext({ schemaVersion: 1, page: 20, anchorId: 'news-c' });
  expect(workContextPage(context, ['news-a', 'news-c', 'news-b'], 1)).toBe(1);
  expect(workContextPage(context, ['news-a', 'news-b'], 1)).toBe(0);
  expect(workContextPage(context, [], 10)).toBe(0);
  expect(workContextPage({ ...context, anchorId: undefined }, ['news-a', 'news-b'], 1)).toBe(1);
});
