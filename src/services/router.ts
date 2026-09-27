import { APP_NAME } from '../shared/brand';

/**
 * Screen ⇄ URL mapping for the browser History API: every screen has its own address
 * (/news/<id>, /episodes/<id>, /bulletins/<id>, /settings …), so Back/Forward, reloads,
 * bookmarks and shared links land on the same screen.
 */

export interface RouteState {
  nav: string;
  newsId?: string | null;
  /** The news editor is open on a new story. */
  newsNew?: boolean;
  episodeId?: string | null;
  programId?: string | null;
  bulletinId?: string | null;
  /** Item highlighted on a list screen (diary entry, booking, wire). */
  focusId?: string | null;
}

/** Screens whose list highlights an item given in the address. */
const FOCUS_SCREENS = new Set(['diary', 'bookings', 'wires']);

const clean = (id: string) => encodeURIComponent(id);

export function routeToPath(s: RouteState): string {
  switch (s.nav) {
    case 'dashboard':
      return '/';
    case 'news-editor':
      if (s.newsId) return `/news/${clean(s.newsId)}`;
      return '/news/new';
    case 'episode-workspace':
      return s.episodeId ? `/episodes/${clean(s.episodeId)}` : '/episodes';
    case 'program-detail':
    case 'program_detail':
      return s.programId ? `/programs/${clean(s.programId)}` : '/programs';
    case 'bulletins':
      return s.bulletinId ? `/bulletins/${clean(s.bulletinId)}` : '/bulletins';
    default:
      if (FOCUS_SCREENS.has(s.nav) && s.focusId) return `/${s.nav}/${clean(s.focusId)}`;
      return `/${s.nav}`;
  }
}

/** Splits an address into the screen and optional item id ("/news/abc" → news, abc). */
export function parsePath(pathname: string): { view: string; id: string | null } {
  const [view = '', id = ''] = pathname.replace(/^\/+/, '').split(/[/?#]/);
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // keep as typed
  }
  return { view: view || 'dashboard', id: decoded || null };
}

const TITLES: Record<string, string> = {
  dashboard: 'الرئيسية',
  wires: 'البرقيات',
  news: 'الأخبار',
  'news-editor': 'محرر الخبر',
  breaking: 'العاجل',
  bulletins: 'النشرات',
  stories: 'التغطيات',
  diary: 'أجندة التغطية',
  programs: 'البرامج',
  'program-detail': 'البرنامج',
  episodes: 'الحلقات',
  'episode-workspace': 'مساحة عمل الحلقة',
  calendar: 'جدول البث',
  guests: 'الضيوف',
  'on-air': 'وضع الهواء',
  'studio-screen': 'شاشة الاستديو',
  media: 'مكتبة الوسائط',
  requests: 'طلبات الأقسام',
  tasks: 'المهام',
  bookings: 'حجز الموارد',
  roster: 'المناوبات',
  reports: 'التقارير',
  audit: 'سجل التدقيق',
  users: 'المستخدمون والصلاحيات',
  settings: 'الإعدادات',
  database: 'قاعدة البيانات',
  tests: 'الاختبارات',
  alerts: 'تنبيهات البرقيات',
  help: 'المساعدة',
  'whats-new': 'ما الجديد',
};

export const APP_TITLE = APP_NAME;

/** Browser tab title: the item's name when known, then the screen, then the app. */
export function screenTitle(nav: string, itemTitle?: string | null): string {
  const screen = TITLES[nav] || '';
  return [itemTitle, screen, APP_TITLE].filter(Boolean).join(' · ');
}

/** Screens the address may name; anything else falls back to the dashboard. */
export function isKnownScreen(view: string): boolean {
  return view in TITLES || view === 'program_detail';
}
