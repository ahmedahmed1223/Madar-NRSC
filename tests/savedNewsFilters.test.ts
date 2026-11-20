import { expect, it } from 'vitest';
import { DEFAULT_NEWS_FILTER, sanitizeNewsFilterDefinition, savedNewsFilterError } from '../src/shared/savedNewsFilters';

const filter = (overrides = {}) => ({ schemaVersion: 1, name: 'My news', pinned: false, definition: { ...DEFAULT_NEWS_FILTER }, ...overrides });

it('accepts supported filters with boundary-length names and search', () => {
  expect(savedNewsFilterError(filter())).toBeNull();
  expect(savedNewsFilterError(filter({ name: 'n'.repeat(80), definition: { ...DEFAULT_NEWS_FILTER, searchQuery: 's'.repeat(200), activeTab: 'UNDER_REVIEW', onlyMine: true } }))).toBeNull();
});
it('preserves the existing Arabic category-name filter without silently resetting it', () => {
  expect(savedNewsFilterError(filter({ definition: { ...DEFAULT_NEWS_FILTER, selectedCategory: 'السياسة' } }))).toBeNull();
});
it('accepts older filters and preserves a valid source in newer ones', () => {
  expect(sanitizeNewsFilterDefinition(DEFAULT_NEWS_FILTER)).toEqual(DEFAULT_NEWS_FILTER);
  const definition = { ...DEFAULT_NEWS_FILTER, selectedSource: 'source-1' };
  expect(savedNewsFilterError(filter({ definition }))).toBeNull();
  expect(sanitizeNewsFilterDefinition(definition)).toEqual(definition);
  expect(savedNewsFilterError(filter({ definition: { ...definition, selectedSource: '../source' } }))).not.toBeNull();
});
it('rejects unknown fields and oversized names without accepting executable queries', () => {
  for (const value of [filter({ name: '' }), filter({ name: '   ' }), filter({ name: 'n'.repeat(81) }), filter({ query: 'SELECT *' }), filter({ schemaVersion: 2 })]) {
    expect(savedNewsFilterError(value)).not.toBeNull();
  }
  expect(savedNewsFilterError(filter({ definition: { ...DEFAULT_NEWS_FILTER, url: 'https://example.com' } }))).not.toBeNull();
});
it('rejects unsupported status priority dates and unsafe references', () => {
  for (const definition of [
    { activeTab: 'RUN_SCRIPT' }, { selectedPriority: 'UNKNOWN' }, { searchQuery: 's'.repeat(201) },
    { fromDate: '2026-02-30' }, { fromDate: '2026-10-11', toDate: '2026-10-10' },
    { authorId: '../secret' }, { selectedCategory: 'c'.repeat(129) }, { onlyMine: 'true' },
  ]) expect(savedNewsFilterError(filter({ definition: { ...DEFAULT_NEWS_FILTER, ...definition } }))).not.toBeNull();
});
