import { APP_NAME } from '../shared/brand';
import { ENTITY_ID_PATTERN } from '../shared/collections';
import { shiftHandoverPath } from '../shared/shiftHandovers';
import { messageEntryPath, publicMessageOrigin, splitMessageFocus } from '../shared/chat';

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
  episodeSegmentId?: string;
  programId?: string | null;
  bulletinId?: string | null;
  /** Item highlighted on a list screen (diary entry, booking, wire). */
  focusId?: string | null;
}

/** Screens whose list highlights an item given in the address. */
const FOCUS_SCREENS = new Set(['diary', 'bookings', 'wires', 'cards', 'messages', 'tasks', 'requests', 'media', 'guide']);

const clean = (id: string) => encodeURIComponent(id);

export function routeToPath(s: RouteState): string {
  switch (s.nav) {
    case 'dashboard':
      return '/';
    case 'news-editor':
      if (s.newsId) return `/news/${clean(s.newsId)}`;
      return '/news/new';
    case 'episode-workspace': {
      if (!s.episodeId) return '/episodes';
      const path = `/episodes/${clean(s.episodeId)}`;
      return s.episodeSegmentId && ENTITY_ID_PATTERN.test(s.episodeSegmentId) ? `${path}/segments/${clean(s.episodeSegmentId)}` : path;
    }
    case 'program-detail':
    case 'program_detail':
      return s.programId ? `/programs/${clean(s.programId)}` : '/programs';
    case 'bulletins':
      return s.bulletinId ? `/bulletins/${clean(s.bulletinId)}` : '/bulletins';
    case 'roster': {
      const target = s.focusId?.startsWith('handover/') ? s.focusId.slice('handover/'.length) : '';
      if (ENTITY_ID_PATTERN.test(target)) return shiftHandoverPath(target);
      return s.focusId === 'handover' ? '/roster/handover' : '/roster';
    }
    case 'settings':
      return s.focusId === 'monitor' ? '/settings/monitor' : '/settings';
    case 'messages': {
      const { channel, messageId } = splitMessageFocus(s.focusId);
      if (channel && messageId) return messageEntryPath(channel, messageId);
      return s.focusId ? `/messages/${clean(s.focusId)}` : '/messages';
    }
    default:
      if (FOCUS_SCREENS.has(s.nav) && s.focusId) return `/${s.nav}/${clean(s.focusId)}`;
      return `/${s.nav}`;
  }
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits an address into the screen and optional item id ("/news/abc" → news, abc). */
export function parsePath(pathname: string): { view: string; id: string | null; episodeSegmentId?: string } {
  const [view = '', rawId = '', rawTarget = '', rawSegmentId = '', ...rest] = pathname.split(/[?#]/, 1)[0].replace(/^\/+/, '').split('/');
  const id = decodePathPart(rawId);
  if (view === 'roster' && id === 'handover') {
    const target = decodePathPart(rawTarget);
    if (ENTITY_ID_PATTERN.test(target)) return { view, id: `handover/${target}` };
  }
  if (view === 'episodes' && id && rawTarget === 'segments' && !rest.some(Boolean)) {
    const episodeSegmentId = decodePathPart(rawSegmentId);
    if (ENTITY_ID_PATTERN.test(episodeSegmentId)) return { view, id, episodeSegmentId };
  }
  if (view === 'messages' && id && rawTarget === 'entry' && !rest.some(Boolean)) {
    const messageId = decodePathPart(rawSegmentId);
    if (publicMessageOrigin(id, messageId)) return { view, id: `${id}/entry/${messageId}` };
  }
  return { view: view || 'dashboard', id: id || null };
}

const TITLES: Record<string, string> = {
  dashboard: 'الرئيسية',
  wires: 'المصادر',
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
  messages: 'المراسلات',
  'personal-notes': 'ملاحظاتي',
  cards: 'التكليفات',
  workload: 'متابعة الفرق والتكاليف',
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
  alerts: 'تنبيهات المصادر',
  help: 'المساعدة',
  guide: 'دليل الاستخدام',
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
