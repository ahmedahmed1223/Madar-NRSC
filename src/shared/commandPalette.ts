import { matchesQuery } from './search';

/**
 * Quick-access data for the unified search (Ctrl+K): records the user opened recently, and the
 * screens and actions it can jump to without typing a full search.
 */

export type RecentKind = 'news' | 'program' | 'episode' | 'guest' | 'task';

export interface RecentEntry {
  kind: RecentKind;
  id: string;
  title: string;
  /** ISO time it was last opened from the search. */
  openedAt: string;
}

export const RECENT_LIMIT = 8;
const KINDS: RecentKind[] = ['news', 'program', 'episode', 'guest', 'task'];

/** Moves an entry to the front (replacing an older copy of the same record) and caps the list. */
export function pushRecent(list: RecentEntry[], entry: RecentEntry, limit = RECENT_LIMIT): RecentEntry[] {
  return [entry, ...list.filter((e) => !(e.kind === entry.kind && e.id === entry.id))].slice(0, limit);
}

/** Accepts only well-formed entries, so a corrupted or older browser value never breaks the dialog. */
export function sanitizeRecent(value: unknown, limit = RECENT_LIMIT): RecentEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: RecentEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const { kind, id, title, openedAt } = raw as Record<string, unknown>;
    if (!KINDS.includes(kind as RecentKind) || typeof id !== 'string' || !id || typeof title !== 'string') continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: kind as RecentKind, id, title: title.slice(0, 300), openedAt: typeof openedAt === 'string' ? openedAt : '' });
    if (out.length >= limit) break;
  }
  return out;
}

export interface QuickScreen {
  nav: string;
  label: string;
  /** Extra words people type for this screen. */
  keywords?: string;
  /** Permission needed to see it (the server enforces this too). */
  permission?: string;
}

/** Screens reachable from the search, in sidebar order. */
export const QUICK_SCREENS: QuickScreen[] = [
  { nav: 'dashboard', label: 'الرئيسية', keywords: 'لوحة القيادة عملي' },
  { nav: 'wires', label: 'البرقيات', keywords: 'وكالات rss', permission: 'news.view' },
  { nav: 'news', label: 'الأخبار', keywords: 'غرفة الأخبار' },
  { nav: 'breaking', label: 'العاجل', keywords: 'خبر عاجل' },
  { nav: 'bulletins', label: 'النشرات', keywords: 'رانداون النشرة' },
  { nav: 'stories', label: 'التغطيات' },
  { nav: 'diary', label: 'أجندة التغطية', keywords: 'الاحداث' },
  { nav: 'programs', label: 'البرامج' },
  { nav: 'episodes', label: 'الحلقات' },
  { nav: 'calendar', label: 'جدول البث', keywords: 'التقويم' },
  { nav: 'guests', label: 'الضيوف' },
  { nav: 'on-air', label: 'وضع الهواء', keywords: 'بث مباشر' },
  { nav: 'studio-screen', label: 'شاشة الاستديو' },
  { nav: 'media', label: 'مكتبة الوسائط', keywords: 'صور فيديو' },
  { nav: 'requests', label: 'طلبات الأقسام' },
  { nav: 'tasks', label: 'المهام' },
  { nav: 'bookings', label: 'حجز الموارد' },
  { nav: 'roster', label: 'المناوبات', keywords: 'الورديات' },
  { nav: 'reports', label: 'التقارير', keywords: 'احصائيات' },
  { nav: 'audit', label: 'سجل التدقيق', permission: 'audit.view' },
  { nav: 'users', label: 'المستخدمون والصلاحيات', keywords: 'الادوار', permission: 'users.view' },
  { nav: 'settings', label: 'الإعدادات', permission: 'system.settings' },
  { nav: 'help', label: 'المساعدة', keywords: 'دليل' },
  { nav: 'whats-new', label: 'ما الجديد', keywords: 'الاصدار' },
];

/** Permission a screen needs, shared by the sidebar and the search. */
export function screenPermission(nav: string): string | undefined {
  return QUICK_SCREENS.find((s) => s.nav === nav)?.permission;
}

/** Screens the user may open whose name or keywords match the query (all of them when it is empty). */
export function matchScreens(query: string, can: (permission: string) => boolean): QuickScreen[] {
  return QUICK_SCREENS.filter((s) => (!s.permission || can(s.permission)) && matchesQuery(query, s.label, s.keywords));
}
