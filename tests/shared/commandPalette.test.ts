import { describe, expect, it } from 'vitest';
import { matchScreens, pushRecent, sanitizeRecent, screenPermission, type RecentEntry } from '../../src/shared/commandPalette';

const entry = (id: string, kind: RecentEntry['kind'] = 'news'): RecentEntry => ({ kind, id, title: `عنوان ${id}`, openedAt: '2026-10-27T10:00:00.000Z' });

describe('recently opened records', () => {
  it('moves a reopened record to the front without duplicating it and caps the list', () => {
    const list = [entry('a'), entry('b'), entry('c')];
    expect(pushRecent(list, entry('b')).map((e) => e.id)).toEqual(['b', 'a', 'c']);
    expect(pushRecent(list, entry('b', 'task')).map((e) => `${e.kind}:${e.id}`)).toEqual(['task:b', 'news:a', 'news:b', 'news:c']);
    expect(pushRecent(list, entry('d'), 3).map((e) => e.id)).toEqual(['d', 'a', 'b']);
  });

  it('ignores malformed, unknown and duplicate stored values', () => {
    expect(sanitizeRecent(null)).toEqual([]);
    expect(sanitizeRecent('x')).toEqual([]);
    const stored = [entry('a'), { kind: 'secret', id: 'x', title: 't' }, { kind: 'news', id: '', title: 't' }, null, entry('a'), { kind: 'guest', id: 'g', title: 'ضيف' }];
    expect(sanitizeRecent(stored).map((e) => `${e.kind}:${e.id}`)).toEqual(['news:a', 'guest:g']);
    expect(sanitizeRecent(Array.from({ length: 20 }, (_, i) => entry(String(i))))).toHaveLength(8);
  });
});

describe('quick screens', () => {
  it('matches Arabic names and keywords and hides screens the user may not open', () => {
    const all = () => true;
    expect(matchScreens('الاعدادات', all).map((s) => s.nav)).toEqual(['settings']);
    expect(matchScreens('الورديات', all).map((s) => s.nav)).toEqual(['roster']);
    expect(matchScreens('الإعدادات', () => false)).toEqual([]);
    expect(matchScreens('', () => false).some((s) => s.nav === 'users')).toBe(false);
    expect(matchScreens('', all).length).toBeGreaterThan(20);
  });

  it('keeps the sidebar permissions for administration screens', () => {
    expect(screenPermission('settings')).toBe('system.settings');
    expect(screenPermission('audit')).toBe('audit.view');
    expect(screenPermission('news')).toBeUndefined();
  });
});
