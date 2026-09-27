import { describe, expect, it } from 'vitest';
import { isKnownScreen, parsePath, routeToPath, screenTitle } from '../../src/services/router';

describe('screen ⇄ address mapping', () => {
  it('gives every screen and item its own address', () => {
    expect(routeToPath({ nav: 'dashboard' })).toBe('/');
    expect(routeToPath({ nav: 'settings' })).toBe('/settings');
    expect(routeToPath({ nav: 'news-editor', newsId: 'nws-1' })).toBe('/news/nws-1');
    expect(routeToPath({ nav: 'news-editor' })).toBe('/news/new');
    expect(routeToPath({ nav: 'episode-workspace', episodeId: 'ep 2' })).toBe('/episodes/ep%202');
    expect(routeToPath({ nav: 'program-detail', programId: 'p1' })).toBe('/programs/p1');
    expect(routeToPath({ nav: 'bulletins', bulletinId: 'b1' })).toBe('/bulletins/b1');
    expect(routeToPath({ nav: 'bulletins' })).toBe('/bulletins');
    expect(routeToPath({ nav: 'diary', focusId: 'd1' })).toBe('/diary/d1');
    // Focus ids only belong in the address of screens that highlight them.
    expect(routeToPath({ nav: 'tasks', focusId: 't1' })).toBe('/tasks');
  });

  it('reads addresses back, round-tripping ids', () => {
    expect(parsePath('/')).toEqual({ view: 'dashboard', id: null });
    expect(parsePath('/news/nws-1')).toEqual({ view: 'news', id: 'nws-1' });
    expect(parsePath('/episodes/ep%202?x=1')).toEqual({ view: 'episodes', id: 'ep 2' });
    expect(parsePath('/bad/%E0%A4%A')).toEqual({ view: 'bad', id: '%E0%A4%A' });
    expect(isKnownScreen('settings')).toBe(true);
    expect(isKnownScreen('nope')).toBe(false);
  });

  it('titles the tab by item and screen', () => {
    expect(screenTitle('news-editor', 'عنوان')).toBe('عنوان · محرر الخبر · مدار');
    expect(screenTitle('settings')).toBe('الإعدادات · مدار');
  });
});
