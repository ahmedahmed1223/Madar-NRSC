/**
 * Which screens a role opens. A role's permissions decide what its holders may do with the data
 * (the server enforces that); its screen list decides which pages their workspace shows, so a
 * montage editor or a quality reviewer sees the pages of their job and nothing else.
 *
 * A role without a list opens every screen its permissions allow.
 */
import { QUICK_SCREENS, screenPermission } from './commandPalette';
import type { RoleDefinition } from './rbac';

/** Screens grouped as in the sidebar, for the role editor. */
export const SCREEN_GROUPS: { label: string; navs: string[] }[] = [
  { label: 'غرفة الأخبار', navs: ['wires', 'news', 'breaking', 'bulletins', 'stories', 'diary'] },
  { label: 'البرامج', navs: ['programs', 'episodes', 'calendar', 'guests'] },
  { label: 'الهواء والاستديو', navs: ['on-air', 'studio-screen'] },
  { label: 'الوسائط', navs: ['media'] },
  { label: 'الفريق', navs: ['messages', 'cards', 'requests', 'tasks', 'bookings', 'roster'] },
  { label: 'الإدارة', navs: ['workload', 'reports', 'audit', 'users', 'settings'] },
];

export const ASSIGNABLE_SCREENS: string[] = SCREEN_GROUPS.flatMap((g) => g.navs);

/** Open to everyone: the home page, personal settings and help (the user guide included). */
const ALWAYS_OPEN = new Set(['dashboard', 'help', 'guide', 'whats-new', 'alerts', 'personal-notes', 'personal-tasks']);

/** Pages inside another screen follow that screen. */
const PARENT_SCREEN: Record<string, string> = {
  'news-editor': 'news',
  'episode-workspace': 'episodes',
  'program-detail': 'programs',
  program_detail: 'programs',
  database: 'settings',
  tests: 'settings',
};

export const screenLabel = (nav: string) => QUICK_SCREENS.find((s) => s.nav === nav)?.label || nav;

/** Whether the role's screen list lets its holders open this screen. */
export function roleOpensScreen(role: Pick<RoleDefinition, 'screens'> | undefined, nav: string): boolean {
  const screen = PARENT_SCREEN[nav] || nav;
  if (ALWAYS_OPEN.has(screen) || !Array.isArray(role?.screens)) return true;
  return role!.screens!.includes(screen);
}

/** Whether a user opens a screen: the permission the screen needs, and their role's screen list. */
export function canOpenScreen(nav: string, role: Pick<RoleDefinition, 'screens'> | undefined, can: (permission: string) => boolean, isSuperAdmin = false): boolean {
  const permission = screenPermission(nav) ?? screenPermission(PARENT_SCREEN[nav] || '');
  if (permission && !can(permission)) return false;
  return isSuperAdmin || roleOpensScreen(role, nav);
}

export function screensError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > ASSIGNABLE_SCREENS.length) return 'قائمة صفحات الدور غير صالحة';
  if (value.some((nav) => typeof nav !== 'string' || !ASSIGNABLE_SCREENS.includes(nav)) || new Set(value).size !== value.length) return 'قائمة صفحات الدور تحوي صفحة غير معروفة أو مكررة';
  return null;
}
