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
  newsBreaking?: boolean;
  episodeId?: string | null;
  episodeSegmentId?: string;
  programId?: string | null;
  bulletinId?: string | null;
  episodeProgramId?: string | null;
  requestSegmentId?: string;
  airShowId?: string | null;
  /** Item highlighted on a list screen (diary entry, booking, wire). */
  focusId?: string | null;
}

/** Screens whose list highlights an item given in the address. */
const FOCUS_SCREENS = new Set(['diary', 'bookings', 'wires', 'cards', 'tasks', 'personal-tasks', 'media', 'guide']);

const clean = (id: string) => encodeURIComponent(id);
const validId = (value?: string | null): value is string => !!value && ENTITY_ID_PATTERN.test(value);

/** Unwrap a push/email link while keeping the destination's query and fragment. */
export function notificationAddress(address: string): string | undefined {
  try {
    const localOrigin = 'https://madar.local';
    const envelope = new URL(address, localOrigin);
    const target = envelope.searchParams.get('open');
    if (!target?.startsWith('/') || target.startsWith('//')) return undefined;
    const destination = new URL(target, localOrigin);
    if (destination.origin !== localOrigin) return undefined;
    const originalKeys = new Set(destination.searchParams.keys());
    for (const [key, value] of envelope.searchParams) {
      if (key !== 'open' && !originalKeys.has(key)) destination.searchParams.append(key, value);
    }
    return destination.pathname + destination.search + (destination.hash || envelope.hash);
  } catch {
    return undefined;
  }
}

export function routeToPath(s: RouteState): string {
  switch (s.nav) {
    case 'dashboard':
      return '/';
    case 'news-editor':
      if (s.newsId) return `/news/${clean(s.newsId)}`;
      return s.newsBreaking ? '/news/new?breaking=1' : '/news/new';
    case 'episodes':
      return validId(s.episodeProgramId) ? `/episodes?program=${clean(s.episodeProgramId)}` : '/episodes';
    case 'requests': {
      const path = s.focusId ? `/requests/${clean(s.focusId)}` : '/requests';
      return validId(s.requestSegmentId) ? `${path}?segment=${clean(s.requestSegmentId)}` : path;
    }
    case 'on-air':
    case 'studio-screen':
      return validId(s.airShowId) ? `/${s.nav}/${clean(s.airShowId)}` : `/${s.nav}`;
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
export function parsePath(address: string): {
  view: string; id: string | null; episodeSegmentId?: string; newsBreaking?: boolean;
  episodeProgramId?: string; requestSegmentId?: string;
} {
  const withoutHash = address.split('#', 1)[0];
  const question = withoutHash.indexOf('?');
  const path = question < 0 ? withoutHash : withoutHash.slice(0, question);
  const [view = '', rawId = '', rawTarget = '', rawSegmentId = '', ...rest] = path.replace(/^\/+/, '').split('/');
  const id = decodePathPart(rawId);
  const params = new URLSearchParams(question < 0 ? '' : withoutHash.slice(question + 1));
  if (view === 'news' && id === 'new' && params.get('breaking') === '1') return { view, id, newsBreaking: true };
  const episodeProgramId = params.get('program');
  if (view === 'episodes' && !id && validId(episodeProgramId)) return { view, id: null, episodeProgramId };
  const requestSegmentId = params.get('segment');
  if (view === 'requests' && validId(requestSegmentId)) return { view, id: id || null, requestSegmentId };
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
  'personal-tasks': 'مهامي الشخصية',
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
  const screen = Object.hasOwn(TITLES, nav) ? TITLES[nav] : '';
  return [itemTitle, screen, APP_TITLE].filter(Boolean).join(' · ');
}

/** Screens the address may name; anything else falls back to the dashboard. */
export function isKnownScreen(view: string): boolean {
  return Object.hasOwn(TITLES, view) || view === 'program_detail';
}

/** Non-routing query parameters and anchors can coexist with a screen address. */
export function sameScreenAddress(current: string, target: string): boolean {
  if (current.split(/[?#]/, 1)[0] !== target.split(/[?#]/, 1)[0]) return false;
  const left = parsePath(current);
  const right = parsePath(target);
  return left.newsBreaking === right.newsBreaking &&
    left.episodeProgramId === right.episodeProgramId &&
    left.requestSegmentId === right.requestSegmentId;
}
