import { describe, expect, it } from 'vitest';
import { isKnownScreen, notificationAddress, parsePath, routeToPath, sameScreenAddress, screenTitle } from '../../src/services/router';

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
    expect(routeToPath({ nav: 'tasks', focusId: 't1' })).toBe('/tasks/t1');
    expect(routeToPath({ nav: 'requests', focusId: 'r1' })).toBe('/requests/r1');
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
  it('round-trips an exact handover and the system monitor', () => {
    const route = routeToPath({ nav: 'roster', focusId: 'handover/shift:one' });
    expect(route).toBe('/roster/handover/shift%3Aone');
    expect(parsePath(route)).toEqual({ view: 'roster', id: 'handover/shift:one' });
    expect(parsePath('/roster/handover/%2Fprivate')).toEqual({ view: 'roster', id: 'handover' });
    expect(routeToPath({ nav: 'settings', focusId: 'monitor' })).toBe('/settings/monitor');
  });
  it('round-trips an exact episode segment and rejects malformed nested targets', () => {
    const episode = { nav: 'episode-workspace', episodeId: 'ep-2' };
    const path = routeToPath({ ...episode, episodeSegmentId: 'segment:two' });
    expect(path).toBe('/episodes/ep-2/segments/segment%3Atwo');
    expect(parsePath(path)).toEqual({ view: 'episodes', id: 'ep-2', episodeSegmentId: 'segment:two' });
    expect(parsePath('/episodes/ep-2/segments/%2Fprivate')).toEqual({ view: 'episodes', id: 'ep-2' });
    expect(parsePath('/episodes/ep-2/segments/segment-1/other')).toEqual({ view: 'episodes', id: 'ep-2' });
    expect(routeToPath({ ...episode, episodeSegmentId: '../private' })).toBe('/episodes/ep-2');
  });
  it('keeps the handover tab in the roster deep link', () => {
    expect(routeToPath({ nav: 'roster', focusId: 'handover' })).toBe('/roster/handover');
    expect(parsePath('/roster/handover')).toEqual({ view: 'roster', id: 'handover' });
  });

  it('restores the news form, programme filter, request segment and selected air show', () => {
    expect(parsePath(routeToPath({ nav: 'news-editor', newsBreaking: true }))).toEqual({ view: 'news', id: 'new', newsBreaking: true });
    expect(parsePath(routeToPath({ nav: 'episodes', episodeProgramId: 'prg-1' }))).toEqual({ view: 'episodes', id: null, episodeProgramId: 'prg-1' });
    expect(parsePath(routeToPath({ nav: 'requests', focusId: 'req-1', requestSegmentId: 'seg:1' }))).toEqual({ view: 'requests', id: 'req-1', requestSegmentId: 'seg:1' });
    for (const nav of ['on-air', 'studio-screen']) {
      expect(parsePath(routeToPath({ nav, airShowId: 'ep-101' }))).toEqual({ view: nav, id: 'ep-101' });
    }
    expect(sameScreenAddress('/news/new?breaking=1', '/news/new')).toBe(false);
    expect(sameScreenAddress('/settings?storage=gdrive-connected#section', '/settings')).toBe(true);
    expect(isKnownScreen('constructor')).toBe(false);
  });

  it('retains destination parameters when opening a notification link', () => {
    const target = encodeURIComponent('/news/new?breaking=1#headline');
    expect(notificationAddress(`/?open=${target}&campaign=desk&breaking=0`)).toBe('/news/new?breaking=1&campaign=desk#headline');
    expect(notificationAddress('/?open=%2F%2Fexample.com')).toBeUndefined();
    expect(notificationAddress('not a URL')).toBeUndefined();
  });
});
