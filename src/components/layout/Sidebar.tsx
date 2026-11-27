import { APP_ICON_URL, APP_NAME, APP_TAGLINE } from '../../shared/brand';
import { hasSeenWhatsNew, WHATS_NEW_SEEN_EVENT } from '../../services/whatsNewSeen';
import { departmentIdOf } from '../../shared/departments';
import { isApprover } from '../../shared/bulletins';
import { localDateString } from '../../shared/dates';
import { unreadByChannel } from '../../shared/chat';
import { RbacService } from '../../services/rbacService';
import { dataStore } from '../../services/dataStore';
import { apiService } from '../../services/api';
import React, { useEffect, useRef, useState } from 'react';
import { NAV_SECTIONS, defaultFolded, sectionOfScreen, sectionOrderFor, type NavSectionId } from '../../shared/navigation';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  badge: string | null;
  badgeColor?: string;
  /** What waits there, summed on a folded section. */
  count?: number;
}
import {
  LayoutDashboard,
  Newspaper,
  FolderGit2,
  Flame,
  MonitorPlay,
  BookOpen,
  BookOpenText,
  ArrowLeftRight,
  ClipboardList,
  MessagesSquare,
  Scale,
  CalendarClock,
  Rss,
  Tv,
  Video,
  Users,
  CheckSquare,
  Calendar,
  Image as ImageIcon,
  BarChart3,
  ShieldCheck,
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Radio,
  Sparkles,
  UserCog,
  X,
  ListVideo,
  CalendarDays,
  CalendarRange,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { EditorialTask, Episode, NewsItem, User } from '../../types';
import { cardsAwaitingMyDecision, isManagerRole, reviewableNews } from '../../shared/managerToday';
import { stationsOf } from '../../shared/stations';
import { trapTab } from '../../shared/focus';

/**
 * The rail's counts are personal: my open tasks, the stories I can actually review (none for
 * someone who does not review), and episodes ready for air.
 */
export function personalBadgeCounts(user: User | null | undefined, news: NewsItem[] = [], tasks: EditorialTask[] = [], episodes: Episode[] = []) {
  if (!user) return { news: 0, tasks: 0, episodes: 0 };
  const canReview = RbacService.hasPermission(user, 'news.review') || RbacService.hasPermission(user, 'news.approve');
  const stationOf = new Map(apiService.getUsers().map((u) => [u.id, u.stationId]));
  return {
    news: reviewableNews(news, user, { canReview, stations: stationsOf(apiService.getSettings()), stationOf: (id) => stationOf.get(id) }).length,
    tasks: tasks.filter((t) => (t.assigneeId || t.assignedToId) === user.id && !['COMPLETED', 'DONE', 'CANCELLED'].includes(t.status)).length,
    episodes: episodes.filter((e) => e.status === 'READY_FOR_BROADCAST').length,
  };
}

export type AppView =
  | 'DASHBOARD'
  | 'NEWS_LIST'
  | 'NEWS_CREATE'
  | 'NEWS_EDIT'
  | 'STORIES'
  | 'BREAKING_NEWS'
  | 'PROGRAMS'
  | 'PROGRAM_DETAIL'
  | 'EPISODES'
  | 'EPISODE_WORKSPACE'
  | 'GUESTS'
  | 'TASKS'
  | 'CALENDAR'
  | 'MEDIA'
  | 'REPORTS'
  | 'AUDIT_LOGS'
  | 'USERS'
  | 'TESTS'
  | 'SETTINGS'
  | 'DATABASE';

export interface SidebarProps {
  currentView?: AppView | string;
  onNavigate?: (view: any) => void;
  activeNav?: string;
  onSelectNav?: (navId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  breakingCount?: number;
  pendingReviewCount?: number;
  pendingTasksCount?: number;
  currentUser?: User;
  badgeCounts?: {
    news?: number;
    tasks?: number;
    episodes?: number;
  };
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  activeNav,
  onSelectNav,
  isCollapsed: controlledCollapsed,
  onToggleCollapse: controlledToggle,
  isMobileOpen = false,
  onCloseMobile,
  breakingCount = 0,
  pendingReviewCount = 0,
  pendingTasksCount = 0,
  currentUser,
  badgeCounts,
}) => {
  const [internalCollapsed, setInternalCollapsed] = React.useState(false);
  const toggleCollapse = controlledToggle || (() => setInternalCollapsed(!internalCollapsed));

  // Determine current active navigation identifier (normalize to lowercase for matching)
  const activeIdentifier = (activeNav || currentView || 'dashboard').toString().toLowerCase();

  const handleNavigate = (key: string) => {
    if (onSelectNav) {
      onSelectNav(key);
    }
    if (onNavigate) {
      onNavigate(key.toUpperCase() as AppView);
    }
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const newsBadge = badgeCounts?.news ?? pendingReviewCount;
  const tasksBadge = badgeCounts?.tasks ?? pendingTasksCount;

  const [isOnline, setIsOnline] = useState(true);
  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'sync-status') setIsOnline(evt.online);
      }),
    []
  );
  const organizationName = apiService.getSettings()?.organizationName || '';

  // On phones and narrow tablets, the closed menu stays out of Tab order and screen readers.
  const [isSmallScreen, setIsSmallScreen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(width < 64rem)').matches);
  const isCollapsed = !isSmallScreen && (controlledCollapsed ?? internalCollapsed);
  useEffect(() => {
    const mq = window.matchMedia('(width < 64rem)');
    const on = () => setIsSmallScreen(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const asideRef = useRef<HTMLElement>(null);
  const closeMobileRef = useRef(onCloseMobile);
  closeMobileRef.current = onCloseMobile;
  useEffect(() => {
    if (!isMobileOpen) return;
    if (!isSmallScreen) {
      closeMobileRef.current?.();
      return;
    }
    const drawer = asideRef.current;
    const opener = document.querySelector<HTMLButtonElement>('[aria-controls="workspace-navigation"]');
    drawer?.querySelector<HTMLElement>('[aria-label="إغلاق القائمة"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !drawer) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMobileRef.current?.();
      } else {
        trapTab(e, drawer);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      requestAnimationFrame(() => {
        if (opener?.getClientRects().length && (document.activeElement === document.body || drawer?.contains(document.activeElement))) opener.focus({ preventScroll: true });
      });
    };
  }, [isSmallScreen, isMobileOpen]);

  // Hide administration screens the signed-in user cannot use (the server enforces this too).
  const canSeeNav = (id: string) => {
    return !currentUser || RbacService.canOpenScreen(currentUser, id);
  };

  // Open requests waiting on my department.
  const myDepartment = currentUser ? departmentIdOf(currentUser) : null;
  const requestsBadge = myDepartment
    ? apiService.getRequests().filter((r) => r.departmentId === myDepartment && (r.status === 'OPEN' || r.status === 'ACCEPTED')).length
    : 0;
  const [whatsNewUnseen, setWhatsNewUnseen] = useState(() => !!currentUser && !hasSeenWhatsNew(currentUser.id));
  useEffect(() => {
    const update = () => setWhatsNewUnseen(!!currentUser && !hasSeenWhatsNew(currentUser.id));
    update();
    window.addEventListener(WHATS_NEW_SEEN_EVENT, update);
    return () => window.removeEventListener(WHATS_NEW_SEEN_EVENT, update);
  }, [currentUser?.id]);
  const liveCount = apiService.getOnAirStates().filter((s) => s.status === 'LIVE').length;
  // Bulletin stories waiting for my approval (as the bulletin's editor or a chief editor).
  const bulletinActor = currentUser
    ? { id: currentUser.id, canApprove: RbacService.hasPermission(currentUser, 'bulletins.approve'), canEdit: RbacService.hasPermission(currentUser, 'bulletins.edit'), role: currentUser.role }
    : null;
  const today = localDateString();
  const myBulletins = bulletinActor ? apiService.getBulletins().filter((b) => b.date >= today && b.status !== 'DONE' && isApprover(b, bulletinActor)).map((b) => b.id) : [];
  const bulletinById = new Map(apiService.getBulletins().map((b) => [b.id, b]));
  const toApprove = myBulletins.length
    ? apiService.getBulletinStories().filter((s) => s.status === 'READY' && !s.killed && myBulletins.includes(s.bulletinId) && isApprover(bulletinById.get(s.bulletinId), bulletinActor!, s)).length
    : 0;
  // Upcoming diary events assigned to me (today onwards).
  const diaryBadge = currentUser ? apiService.getDiary().filter((e) => e.date >= today && e.coverage !== 'SKIP' && e.assigneeIds.includes(currentUser.id)).length : 0;
  // Unread direct and group messages, and unread messages in the open channels I have visited.
  const messagesBadge = currentUser ? [...unreadByChannel(apiService.getMessages(), apiService.getChatReads(), currentUser.id).values()].reduce((sum, n) => sum + n, 0) : 0;
  // Open production-card steps assigned to me, and for managers the cards awaiting my decision (I own them; blocked or late).
  const allCards = currentUser ? apiService.getCards().filter((c) => !c.deletedAt) : [];
  const mySteps = currentUser ? allCards.filter((c) => c.status === 'OPEN').reduce((n, c) => n + c.steps.filter((s) => s.assigneeId === currentUser.id && s.status !== 'DONE' && s.status !== 'SKIPPED').length, 0) : 0;
  const myDecisions = currentUser && isManagerRole(currentUser.role) ? cardsAwaitingMyDecision(allCards, currentUser.id).length : 0;
  const cardsBadge = mySteps + myDecisions;
  const newsBadgeText = newsBadge > 0 ? `${newsBadge} مراجعة` : null;
  // What waits for me reads in the signal colour; broadcast red is kept for breaking news and live air.
  const WAITING = 'bg-blue-600 text-white';
  const ON_AIR = 'bg-red-600 text-white';

  /** Every screen of the rail with its label, icon and the count that waits there. */
  const ITEMS: Record<string, NavItem> = {
    dashboard: { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard, badge: null },
    messages: { id: 'messages', label: 'المراسلات', icon: MessagesSquare, badge: messagesBadge > 0 ? `${messagesBadge > 99 ? '99+' : messagesBadge}` : null, badgeColor: WAITING, count: messagesBadge },
    tasks: { id: 'tasks', label: 'المهام', icon: CheckSquare, badge: tasksBadge > 0 ? `${tasksBadge}` : null, badgeColor: WAITING, count: tasksBadge },
    'personal-tasks': { id: 'personal-tasks', label: 'مهامي الشخصية', icon: CheckSquare, badge: null },
    cards: { id: 'cards', label: 'التكليفات', icon: ClipboardList, badge: cardsBadge > 0 ? `${cardsBadge}` : null, badgeColor: WAITING, count: cardsBadge },
    requests: { id: 'requests', label: 'طلبات الأقسام', icon: ArrowLeftRight, badge: requestsBadge > 0 ? `${requestsBadge}` : null, badgeColor: WAITING, count: requestsBadge },
    news: { id: 'news', label: 'الأخبار', icon: Newspaper, badge: newsBadgeText, badgeColor: WAITING, count: newsBadge },
    wires: { id: 'wires', label: 'المصادر', icon: Rss, badge: null },
    breaking: { id: 'breaking', label: 'العاجل', icon: Flame, badge: breakingCount > 0 ? `${breakingCount}` : null, badgeColor: ON_AIR, count: breakingCount },
    bulletins: { id: 'bulletins', label: 'النشرات', icon: ListVideo, badge: toApprove > 0 ? `${toApprove} اعتماد` : null, badgeColor: WAITING, count: toApprove },
    stories: { id: 'stories', label: 'التغطيات', icon: FolderGit2, badge: null },
    diary: { id: 'diary', label: 'أجندة التغطية', icon: CalendarDays, badge: diaryBadge > 0 ? `${diaryBadge}` : null, badgeColor: WAITING, count: diaryBadge },
    episodes: { id: 'episodes', label: 'الحلقات', icon: Video, badge: null },
    programs: { id: 'programs', label: 'البرامج', icon: Tv, badge: null },
    calendar: { id: 'calendar', label: 'جدول البث', icon: Calendar, badge: null },
    guests: { id: 'guests', label: 'الضيوف', icon: Users, badge: null },
    'on-air': { id: 'on-air', label: 'وضع الهواء', icon: Radio, badge: liveCount > 0 ? 'مباشر' : null, badgeColor: ON_AIR, count: liveCount },
    'studio-screen': { id: 'studio-screen', label: 'شاشة الاستديو', icon: MonitorPlay, badge: null },
    wallboard: { id: 'wallboard', label: 'شاشة غرفة الأخبار', icon: MonitorPlay, badge: null },
    media: { id: 'media', label: 'مكتبة الوسائط', icon: ImageIcon, badge: null },
    bookings: { id: 'bookings', label: 'حجز الموارد', icon: CalendarRange, badge: null },
    roster: { id: 'roster', label: 'المناوبات', icon: CalendarClock, badge: null },
    workload: { id: 'workload', label: 'متابعة الفرق والتكاليف', icon: Scale, badge: null },
    reports: { id: 'reports', label: 'التقارير', icon: BarChart3, badge: null },
    trash: { id: 'trash', label: 'سلة المحذوفات', icon: Trash2, badge: null },
    audit: { id: 'audit', label: 'سجل التدقيق', icon: ShieldCheck, badge: null },
    users: { id: 'users', label: 'المستخدمون والصلاحيات', icon: UserCog, badge: null },
    settings: { id: 'settings', label: 'الإعدادات', icon: Settings, badge: null },
    help: { id: 'help', label: 'المساعدة', icon: BookOpen, badge: null },
    guide: { id: 'guide', label: 'دليل الاستخدام', icon: BookOpenText, badge: null },
    'whats-new': { id: 'whats-new', label: 'ما الجديد', icon: Sparkles, badge: whatsNewUnseen ? 'جديد' : null, badgeColor: 'bg-white/10 text-slate-100' },
    'personal-notes': { id: 'personal-notes', label: 'ملاحظاتي', icon: NotebookPen, badge: null },
  };

  // Sections follow the colleague's role; each folds, and the fold is remembered on this device.
  const order = sectionOrderFor(currentUser);
  const foldKey = `madar-nav-folded:${currentUser?.id || 'anon'}`;
  const [folded, setFolded] = useState<Set<NavSectionId>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(foldKey) || 'null');
      if (Array.isArray(saved)) return new Set(saved as NavSectionId[]);
    } catch {
      // Unreadable or blocked storage: start from the defaults.
    }
    return new Set(defaultFolded(order));
  });
  const toggleSection = (id: NavSectionId) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(foldKey, JSON.stringify([...next]));
      } catch {
        // Lasts for this visit.
      }
      return next;
    });
  const activeSection = sectionOfScreen(activeIdentifier);
  const programmesHidden = !!currentUser && !RbacService.canUseModule(currentUser, 'programmes');
  const navGroups = order.map((id) => ({
    ...NAV_SECTIONS[id],
    label: id === 'programs' && programmesHidden ? 'جدول البث والضيوف' : NAV_SECTIONS[id].label,
    entries: NAV_SECTIONS[id].items.map((item) => ITEMS[item]).filter(Boolean),
  }));

  const navButton = (item: NavItem) => {
    const Icon = item.icon;
    const isActive =
      activeIdentifier === item.id ||
      (item.id === 'news' && ['news_list', 'news_create', 'news_edit', 'news-editor'].includes(activeIdentifier)) ||
      (item.id === 'episodes' && activeIdentifier === 'episode-workspace') ||
      (item.id === 'programs' && ['program-detail', 'program_detail'].includes(activeIdentifier)) ||
      (item.id === 'settings' && ['database', 'tests', 'alerts'].includes(activeIdentifier));
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavigate(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`nav-item w-full flex items-center gap-3 px-3 min-h-10 rounded-md text-xs font-semibold transition-colors relative ${
          isActive ? 'nav-item-active text-white' : 'text-slate-300 hover:text-white hover:bg-white/5'
        }`}
        title={isCollapsed ? item.label : undefined}
        aria-label={isCollapsed ? (item.badge ? `${item.label} (${item.badge})` : item.label) : undefined}
      >
        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400'}`} aria-hidden="true" />
        {!isCollapsed && (
          <>
            {/* The count sits right after its label, so the two read as one. */}
            <span className="min-w-0 text-right truncate">{item.label}</span>
            {item.badge && (
              <span className={`-ms-1 text-2xs px-1.5 min-w-5 text-center leading-5 rounded-full font-bold shrink-0 tabular-nums ${item.badgeColor || 'bg-slate-800 text-slate-300'}`}>{item.badge}</span>
            )}
          </>
        )}
        {isCollapsed && item.badge && <span aria-hidden="true" className={`absolute top-2 left-2 w-2 h-2 rounded-full ${item.badgeColor === ON_AIR ? 'bg-red-500' : 'bg-blue-400'}`} />}
      </button>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        id="workspace-navigation"
        aria-label="القائمة الرئيسية"
        {...(isSmallScreen && !isMobileOpen ? { inert: true, 'aria-hidden': true } : {})}
        {...(isSmallScreen && isMobileOpen ? { role: 'dialog', 'aria-modal': true } : {})}
        className={`theme-fixed bg-slate-950 text-slate-300 border-s border-white/5 flex shrink-0 flex-col transition-transform duration-200 ease-out select-none
          fixed inset-y-0 right-0 z-50 lg:relative lg:z-20
          ${isMobileOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full lg:translate-x-0'}
          ${isCollapsed ? 'w-20' : 'w-64 sm:w-72'} max-w-[calc(100vw-3rem)]
        `}
      >
        {/* Brand Header */}
        <div className="min-h-16 shrink-0 border-b border-white/10 flex items-center justify-between gap-1 px-4">
          {!isCollapsed && <div className="flex items-center gap-2.5 overflow-hidden">
              <img src={APP_ICON_URL} alt="" width={32} height={32} className="size-8 rounded-md shrink-0" />
              <div className="truncate">
                <span className="font-sans font-bold text-white text-sm block leading-tight">
                  {APP_NAME}
                </span>
                <span className="text-2xs text-slate-400 block leading-tight">
                  {APP_TAGLINE}
                </span>
              </div>
          </div>}

          {isCollapsed && (
            <img src={APP_ICON_URL} alt="" width={32} height={32} className="mx-auto size-8 rounded-md hidden lg:block" />
          )}

          <div className="flex items-center gap-1">
            {/* Collapse button on desktop */}
            <button
              type="button"
              onClick={toggleCollapse}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors hidden lg:block"
              title={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
              aria-label={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
            >
              {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>

            {/* Close button on mobile */}
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="min-h-11 min-w-11 inline-grid place-items-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors lg:hidden"
                title="إغلاق القائمة"
                aria-label="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" aria-label="التنقل">
        {canSeeNav('dashboard') && navButton(ITEMS.dashboard)}
        {navGroups.map((group) => {
          const items = group.entries.filter((item) => canSeeNav(item.id));
          if (!items.length) return null;
          // The section of the open screen never hides it.
          const open = isCollapsed || !folded.has(group.id) || activeSection === group.id;
          const waiting = items.reduce((sum, item) => sum + (item.count || 0), 0);
          const listId = `nav-section-${group.id}`;
          return (
            <div key={group.id} className="pt-2" role="group" aria-label={group.label}>
              {isCollapsed ? (
                <div className="mx-3 my-1.5 border-t border-slate-800" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleSection(group.id)}
                  aria-expanded={open}
                  aria-controls={listId}
                  className="w-full flex items-center gap-2 px-3 min-h-8 rounded-lg text-2xs font-bold text-slate-400 hover:text-slate-100 hover:bg-white/5"
                >
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? '' : 'rotate-90'}`} aria-hidden="true" />
                  <span className="flex-1 text-right">{group.label}</span>
                  {!open && waiting > 0 && (
                    <span className="min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-3xs font-bold tabular-nums leading-5">{waiting > 99 ? '99+' : waiting}</span>
                  )}
                </button>
              )}
              {open && (
                <div id={listId} className="space-y-0.5 mt-0.5">
                  {items.map(navButton)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer: organisation, build version and live connection state */}
      {!isCollapsed && (
        <div className="p-3 border-t border-white/5 text-2xs text-slate-400">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span>الإصدار: v{__APP_VERSION__}</span>
            <span className={`flex items-center gap-1 ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {isOnline ? 'متصل' : 'غير متصل'}
            </span>
          </div>
          <div className="truncate text-slate-300 font-medium">{organizationName}</div>
        </div>
      )}
    </aside>
  </>
  );
};
