import { describe, expect, it } from 'vitest';
import { QUICK_SCREENS } from '../../src/shared/commandPalette';
import { ALL_PERMISSIONS, DEFAULT_ROLE_DEFINITIONS } from '../../src/shared/rbac';
import { ASSIGNABLE_SCREENS, canOpenScreen, roleOpensScreen, screensError } from '../../src/shared/screens';
import { DEPARTMENTS } from '../../src/shared/departments';
import { REQUEST_TYPES } from '../../src/shared/production';

const role = (code: string) => DEFAULT_ROLE_DEFINITIONS.find((r) => r.roleCode === code)!;
const canOf = (code: string) => (permission: string) => role(code).permissions.includes(permission);

describe('screens a role opens', () => {
  it('opens everything when the role has no list, and only its list otherwise', () => {
    expect(roleOpensScreen(undefined, 'users')).toBe(true);
    expect(roleOpensScreen({}, 'episodes')).toBe(true);
    expect(roleOpensScreen({ screens: ['media'] }, 'media')).toBe(true);
    expect(roleOpensScreen({ screens: ['media'] }, 'episodes')).toBe(false);
    expect(roleOpensScreen({ screens: [] }, 'news')).toBe(false);
  });

  it('keeps the home page, help and personal alerts open to everyone', () => {
    for (const nav of ['dashboard', 'help', 'whats-new', 'alerts']) expect(roleOpensScreen({ screens: [] }, nav)).toBe(true);
  });

  it('lets pages inside a screen follow that screen', () => {
    expect(roleOpensScreen({ screens: ['news'] }, 'news-editor')).toBe(true);
    expect(roleOpensScreen({ screens: ['media'] }, 'news-editor')).toBe(false);
    expect(roleOpensScreen({ screens: ['episodes'] }, 'episode-workspace')).toBe(true);
    expect(roleOpensScreen({ screens: ['programs'] }, 'program-detail')).toBe(true);
    expect(roleOpensScreen({ screens: ['settings'] }, 'database')).toBe(true);
  });

  it('still needs the permission of the screen, and never locks the system administrator out', () => {
    expect(canOpenScreen('users', { screens: ['users'] }, () => false)).toBe(false);
    expect(canOpenScreen('users', { screens: ['users'] }, () => true)).toBe(true);
    expect(canOpenScreen('users', { screens: [] }, () => true)).toBe(false);
    expect(canOpenScreen('users', { screens: [] }, () => true, true)).toBe(true);
    expect(canOpenScreen('database', {}, (p) => p !== 'system.settings')).toBe(false);
  });

  it('strictly restricts tests diagnostics screen to SUPER_ADMIN or system.database_manage', () => {
    expect(canOpenScreen('tests', role('SUPER_ADMIN'), canOf('SUPER_ADMIN'), true)).toBe(true);
    expect(canOpenScreen('tests', { screens: [] }, (p) => p === 'system.database_manage')).toBe(true);
    expect(canOpenScreen('tests', { screens: ['settings'] }, (p) => p === 'system.settings' || p === 'system.self_healing')).toBe(false);
    expect(canOpenScreen('tests', role('MAIN_STATION_MANAGER'), canOf('MAIN_STATION_MANAGER'))).toBe(false);
    expect(canOpenScreen('tests', role('EDITOR'), canOf('EDITOR'))).toBe(false);
    expect(canOpenScreen('tests', role('JOURNALIST'), canOf('JOURNALIST'))).toBe(false);
  });

  it('validates a stored list', () => {
    expect(screensError(undefined)).toBeNull();
    expect(screensError(['news', 'media'])).toBeNull();
    expect(screensError(['news', 'news'])).not.toBeNull();
    expect(screensError(['nowhere'])).not.toBeNull();
    expect(screensError('news')).not.toBeNull();
  });

  it('only offers screens that exist in the app', () => {
    const known = new Set(QUICK_SCREENS.map((s) => s.nav));
    for (const nav of ASSIGNABLE_SCREENS) expect(known.has(nav), nav).toBe(true);
  });
});

describe('default roles', () => {
  it('have unique codes and ids, known permissions and known screens', () => {
    expect(new Set(DEFAULT_ROLE_DEFINITIONS.map((r) => r.roleCode)).size).toBe(DEFAULT_ROLE_DEFINITIONS.length);
    expect(new Set(DEFAULT_ROLE_DEFINITIONS.map((r) => r.id)).size).toBe(DEFAULT_ROLE_DEFINITIONS.length);
    const permissions = new Set(ALL_PERMISSIONS.map((p) => p.code));
    for (const r of DEFAULT_ROLE_DEFINITIONS) {
      expect(r.isSystemRole).toBe(true);
      for (const p of r.permissions) expect(permissions.has(p), `${r.roleCode}: ${p}`).toBe(true);
      expect(screensError(r.screens), r.roleCode).toBeNull();
    }
  });

  it('cover the jobs of a station', () => {
    for (const code of ['SUPER_ADMIN', 'MAIN_STATION_MANAGER', 'STATION_MANAGER', 'EDITOR', 'JOURNALIST', 'DIRECTOR', 'PREPARER', 'MONTAGE', 'QUALITY', 'MONITOR', 'REPORTS_EDITOR']) expect(role(code), code).toBeTruthy();
  });

  it('show each job the pages of its work only', () => {
    const opens = (code: string, nav: string) => canOpenScreen(nav, role(code), canOf(code));
    expect(opens('MONTAGE', 'media')).toBe(true);
    expect(opens('MONTAGE', 'requests')).toBe(true);
    expect(opens('MONTAGE', 'cards')).toBe(true);
    expect(opens('MONTAGE', 'wires')).toBe(false);
    expect(opens('MONTAGE', 'guests')).toBe(false);
    expect(opens('MONTAGE', 'users')).toBe(false);
    expect(opens('QUALITY', 'news')).toBe(true);
    expect(opens('QUALITY', 'on-air')).toBe(false);
    expect(opens('MONITOR', 'wires')).toBe(true);
    expect(opens('MONITOR', 'episodes')).toBe(false);
    expect(opens('DIRECTOR', 'on-air')).toBe(true);
    expect(opens('DIRECTOR', 'wires')).toBe(false);
    expect(opens('STATION_MANAGER', 'workload')).toBe(true);
    expect(opens('STATION_MANAGER', 'users')).toBe(true);
    expect(opens('STATION_MANAGER', 'settings')).toBe(false);
    // The main station manager follows every station; a station manager only their own scope.
    expect(role('MAIN_STATION_MANAGER').permissions).toContain('workload.view_all');
    expect(role('STATION_MANAGER').permissions).not.toContain('workload.view_all');
    expect(opens('EDITOR', 'episodes')).toBe(true);
  });

  it('never list a screen whose permission the role lacks', () => {
    for (const r of DEFAULT_ROLE_DEFINITIONS) {
      for (const nav of r.screens || []) expect(canOpenScreen(nav, r, (p) => r.permissions.includes(p)), `${r.roleCode}: ${nav}`).toBe(true);
    }
  });
});

describe('departments of a station', () => {
  it('include montage, monitoring, quality and reports, each reachable by a request', () => {
    const ids = DEPARTMENTS.map((d) => d.id);
    for (const id of ['montage', 'monitoring', 'quality', 'reports']) {
      expect(ids).toContain(id);
      expect(REQUEST_TYPES.some((t) => t.departmentId === id), id).toBe(true);
    }
    expect(REQUEST_TYPES.every((t) => (ids as string[]).includes(t.departmentId))).toBe(true);
  });
});
