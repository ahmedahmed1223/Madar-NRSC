import { expect, it } from 'vitest';
import { sanitizeNewsListPreferences } from '../src/shared/newsListPreferences';
it('defaults to fifty results and all optional columns', () => {
  expect(sanitizeNewsListPreferences(null)).toEqual({ pageSize: 50, columns: ['category', 'priority', 'author', 'updatedAt'] });
});
it('accepts hiding every optional column and a supported page size', () => {
  expect(sanitizeNewsListPreferences({ pageSize: 25, columns: [] })).toEqual({ pageSize: 25, columns: [] });
});
it('filters untrusted preferences and duplicate columns', () => {
  expect(sanitizeNewsListPreferences({ pageSize: -1, columns: ['author', 'author', 'unknown'] })).toEqual({ pageSize: 50, columns: ['author'] });
});
