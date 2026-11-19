/**
 * The navigation rail: which sections exist, which screens each holds, and in what order a given
 * colleague sees them. «عملي» (my messages, tasks, cards and requests) always comes first; then the
 * colleague's own domain (newsroom, programmes, air, resources), and administration last for
 * everyone but managers. Shared by the sidebar and its tests.
 */
import { departmentIdOf } from './departments';

export type NavSectionId = 'work' | 'newsroom' | 'programs' | 'air' | 'resources' | 'admin' | 'help';

export interface NavSection {
  id: NavSectionId;
  label: string;
  /** Screens in display order. */
  items: string[];
}

export const NAV_SECTIONS: Record<NavSectionId, NavSection> = {
  work: { id: 'work', label: 'عملي', items: ['messages', 'tasks', 'cards', 'requests'] },
  newsroom: { id: 'newsroom', label: 'غرفة الأخبار', items: ['news', 'wires', 'breaking', 'bulletins', 'stories', 'diary'] },
  programs: { id: 'programs', label: 'البرامج', items: ['episodes', 'programs', 'calendar', 'guests'] },
  air: { id: 'air', label: 'الهواء والاستديو', items: ['on-air', 'studio-screen'] },
  resources: { id: 'resources', label: 'الوسائط والموارد', items: ['media', 'bookings', 'roster'] },
  admin: { id: 'admin', label: 'المتابعة والإدارة', items: ['workload', 'reports', 'audit', 'users', 'settings'] },
  help: { id: 'help', label: 'المساعدة', items: ['help', 'guide', 'whats-new'] },
};

type Domain = 'newsroom' | 'programs' | 'air' | 'resources';

/** Each job's own domain first, the rest by how often that job reaches for it. */
const DOMAIN_ORDER: Record<string, Domain[]> = {
  newsroom: ['newsroom', 'programs', 'resources', 'air'],
  programs: ['programs', 'air', 'newsroom', 'resources'],
  air: ['air', 'programs', 'newsroom', 'resources'],
  resources: ['resources', 'newsroom', 'programs', 'air'],
};

/** Roles whose daily work is following others: administration comes right after «عملي». */
const MANAGER_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MAIN_STATION_MANAGER', 'GENERAL_MANAGER', 'STATION_MANAGER']);

const ROLE_DOMAIN: Record<string, keyof typeof DOMAIN_ORDER> = {
  EDITOR: 'newsroom',
  JOURNALIST: 'newsroom',
  REPORTER: 'newsroom',
  REPORTS_EDITOR: 'newsroom',
  MONITOR: 'newsroom',
  QUALITY: 'newsroom',
  PRODUCER: 'programs',
  PREPARER: 'programs',
  PRESENTER: 'programs',
  DIRECTOR: 'air',
  CREW: 'air',
  MONTAGE: 'resources',
  MEDIA: 'resources',
};

/** For roles the app does not know (custom roles), the colleague's department says what they do. */
const DEPARTMENT_DOMAIN: Record<string, keyof typeof DOMAIN_ORDER> = {
  newsroom: 'newsroom',
  field: 'newsroom',
  monitoring: 'newsroom',
  quality: 'newsroom',
  reports: 'newsroom',
  production: 'programs',
  presenters: 'programs',
  direction: 'air',
  control: 'air',
  studio: 'air',
  audio: 'air',
  lighting: 'air',
  montage: 'resources',
  graphics: 'resources',
  archive: 'resources',
};

interface NavUser {
  role?: string;
  departmentId?: string;
  department?: string;
}

/** The sections a colleague sees, in order. */
export function sectionOrderFor(user: NavUser | null | undefined): NavSectionId[] {
  const role = user?.role || '';
  const domain = ROLE_DOMAIN[role] || DEPARTMENT_DOMAIN[departmentIdOf(user || null)] || 'newsroom';
  const domains = DOMAIN_ORDER[domain];
  return MANAGER_ROLES.has(role) ? ['work', 'admin', ...domains, 'help'] : ['work', ...domains, 'admin', 'help'];
}

/** The section that holds a screen (pages inside a screen follow it). */
export function sectionOfScreen(nav: string): NavSectionId | undefined {
  const screen = { 'news-editor': 'news', 'episode-workspace': 'episodes', 'program-detail': 'programs', program_detail: 'programs', database: 'settings', tests: 'settings', alerts: 'settings' }[nav] || nav;
  return (Object.keys(NAV_SECTIONS) as NavSectionId[]).find((id) => NAV_SECTIONS[id].items.includes(screen));
}

/** Sections folded the first time a colleague opens the app: everything after their two main domains. */
export function defaultFolded(order: NavSectionId[]): NavSectionId[] {
  const open = new Set<NavSectionId>(['work', ...order.filter((id) => id !== 'work' && id !== 'help').slice(0, 2)]);
  return order.filter((id) => !open.has(id));
}
