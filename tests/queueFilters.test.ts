import { expect, it } from 'vitest';
import { readQueueFilter, writeQueueFilter, sanitizeQueueFilter } from '../src/shared/workContext';

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}

it('restores filters only for their account, screen and field', () => {
  const storage = memoryStorage();
  expect(writeQueueFilter(storage, 'a', 'tasks', 'query', 'تقرير')).toBe(true);
  expect(readQueueFilter(storage, 'a', 'tasks', 'query', '')).toBe('تقرير');
  expect(readQueueFilter(storage, 'b', 'tasks', 'query', '')).toBe('');
  expect(readQueueFilter(storage, 'a', 'requests', 'query', '')).toBe('');
  expect(readQueueFilter(storage, 'a', 'tasks', 'status', 'ALL')).toBe('ALL');
  expect(writeQueueFilter(storage, '', 'tasks', 'query', 'private')).toBe(false);
  expect(readQueueFilter(storage, '', 'tasks', 'query', '')).toBe('');
});

it('discards invalid and obsolete storage without breaking the queue', () => {
  const storage = memoryStorage();
  writeQueueFilter(storage, 'a', 'tasks', 'query', 'saved');
  const key = [...storage.entries.keys()][0];
  for (const value of ['{bad', 'null', '[]', '{"schemaVersion":2,"value":"saved"}', '{"value":"legacy"}', '{"schemaVersion":1,"value":true}']) {
    storage.entries.set(key, value);
    expect(readQueueFilter(storage, 'a', 'tasks', 'query', '')).toBe('');
  }
  const denied = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('full'); } };
  expect(readQueueFilter(denied, 'a', 'tasks', 'query', '')).toBe('');
  expect(writeQueueFilter(denied, 'a', 'tasks', 'query', 'text')).toBe(false);
});

it('validates booleans, text and current selectable options', () => {
  expect(sanitizeQueueFilter('true', false)).toBe(false);
  expect(sanitizeQueueFilter(true, false)).toBe(true);
  expect(sanitizeQueueFilter('x'.repeat(1001), '')).toBe('');
  expect(sanitizeQueueFilter('removed-user', 'ALL', ['active-user'])).toBe('ALL');
  expect(sanitizeQueueFilter('active-user', 'ALL', ['active-user'])).toBe('active-user');
  expect(sanitizeQueueFilter('old-department', 'NEWS', ['NEWS', 'SPORT'])).toBe('NEWS');
  // No authoritative options yet: do not erase a selection while an API request is loading.
  expect(sanitizeQueueFilter('member', 'ALL', undefined)).toBe('member');
  expect(sanitizeQueueFilter('member', 'ALL', [])).toBe('ALL');
});
