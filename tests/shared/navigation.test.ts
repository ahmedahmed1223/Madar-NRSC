import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, defaultFolded, sectionOfScreen, sectionOrderFor } from '../../src/shared/navigation';
import { ASSIGNABLE_SCREENS } from '../../src/shared/screens';
import { QUICK_SCREENS } from '../../src/shared/commandPalette';

describe('navigation rail', () => {
  it('puts «عملي» first for everyone and administration last for staff', () => {
    expect(sectionOrderFor({ role: 'REPORTER' })).toEqual(['work', 'newsroom', 'programs', 'resources', 'air', 'admin', 'help']);
    expect(sectionOrderFor({ role: 'DIRECTOR' })).toEqual(['work', 'air', 'programs', 'newsroom', 'resources', 'admin', 'help']);
    expect(sectionOrderFor({ role: 'MONTAGE' })).toEqual(['work', 'resources', 'newsroom', 'programs', 'air', 'admin', 'help']);
    expect(sectionOrderFor({ role: 'PREPARER' })[1]).toBe('programs');
  });

  it('brings administration up for managers', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MAIN_STATION_MANAGER', 'STATION_MANAGER']) expect(sectionOrderFor({ role }).slice(0, 2)).toEqual(['work', 'admin']);
  });

  it('uses the department for roles it does not know', () => {
    expect(sectionOrderFor({ role: 'CUSTOM_X', departmentId: 'montage' })[1]).toBe('resources');
    expect(sectionOrderFor({ role: 'CUSTOM_X', departmentId: 'control' })[1]).toBe('air');
    expect(sectionOrderFor(null)[1]).toBe('newsroom');
  });

  it('folds everything after the two main domains at first', () => {
    expect(defaultFolded(sectionOrderFor({ role: 'REPORTER' }))).toEqual(['resources', 'air', 'admin', 'help']);
    expect(defaultFolded(sectionOrderFor({ role: 'ADMIN' }))).toEqual(['programs', 'resources', 'air', 'help']);
  });

  it('places every screen in exactly one section, and knows where inner pages belong', () => {
    const placed = Object.values(NAV_SECTIONS).flatMap((s) => s.items);
    expect(new Set(placed).size).toBe(placed.length);
    for (const nav of ASSIGNABLE_SCREENS) expect(placed, nav).toContain(nav);
    for (const nav of placed) expect(QUICK_SCREENS.some((s) => s.nav === nav), nav).toBe(true);
    expect(sectionOfScreen('news-editor')).toBe('newsroom');
    expect(sectionOfScreen('episode-workspace')).toBe('programs');
    expect(sectionOfScreen('database')).toBe('admin');
    expect(sectionOfScreen('dashboard')).toBeUndefined();
  });
});
