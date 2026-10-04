import { APP_NAME, APP_TAGLINE } from '../../shared/brand';
import { hasSeenWhatsNew, WHATS_NEW_SEEN_EVENT } from '../../services/whatsNewSeen';
import { departmentIdOf } from '../../shared/departments';
import { isApprover } from '../../shared/bulletins';
import { localDateString } from '../../shared/dates';
import { RbacService } from '../../services/rbacService';
import { dataStore } from '../../services/dataStore';
import { apiService } from '../../services/api';
import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Newspaper, FolderGit2,
  Flame,
  MonitorPlay,
  BookOpen,
  ArrowLeftRight,
  CalendarClock,
  Rss,
  Tv,
  Video,
  ListOrdered,
  Users,
  CheckSquare,
  Calendar,
  Image as ImageIcon,
  BarChart3,
  ShieldCheck,
  Settings,
  ChevronRight,
  ChevronLeft,
  Radio,
  Sparkles,
  UserCog,
  X, ListVideo, CalendarDays, CalendarRange } from 'lucide-react';
import { User } from '../../types';

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
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
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

  // On phones the closed menu is off-screen: keep it out of Tab order and screen readers.
  const [isSmallScreen, setIsSmallScreen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsSmallScreen(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isSmallScreen || !isMobileOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    // Focus moves into the menu; Escape closes it and focus returns to the menu button.
    asideRef.current?.querySelector<HTMLElement>('nav button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [isSmallScreen, isMobileOpen]);

  // Hide administration screens the signed-in user cannot use (the server enforces this too).
  const NAV_PERMISSIONS: Record<string, string> = {
    wires: 'news.view',
    audit: 'audit.view',
    users: 'users.view',
    settings: 'system.settings',
  };
  const canSeeNav = (id: string) => !currentUser || !NAV_PERMISSIONS[id] || RbacService.hasPermission(currentUser, NAV_PERMISSIONS[id]);

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
  const newsBadgeText = newsBadge > 0 ? `${newsBadge} مراجعة` : null;
  const navGroups: { label: string | null; items: { id: string; label: string; icon: any; badge: string | null; badgeColor?: string }[] }[] = [
    { label: null, items: [{ id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard, badge: null }] },
    {
      label: 'غرفة الأخبار',
      items: [
        { id: 'wires', label: 'البرقيات', icon: Rss, badge: null },
        { id: 'news', label: 'الأخبار', icon: Newspaper, badge: newsBadgeText, badgeColor: 'bg-amber-100 text-amber-800' },
        { id: 'breaking', label: 'العاجل', icon: Flame, badge: breakingCount > 0 ? `${breakingCount}` : null, badgeColor: 'bg-red-500 text-white' },
        { id: 'bulletins', label: 'النشرات', icon: ListVideo, badge: toApprove > 0 ? `${toApprove} اعتماد` : null, badgeColor: 'bg-emerald-100 text-emerald-800' },
        { id: 'stories', label: 'التغطيات', icon: FolderGit2, badge: null },
        { id: 'diary', label: 'أجندة التغطية', icon: CalendarDays, badge: diaryBadge > 0 ? `${diaryBadge}` : null, badgeColor: 'bg-sky-100 text-sky-800' },
      ],
    },
    {
      label: 'البرامج',
      items: [
        { id: 'programs', label: 'البرامج', icon: Tv, badge: null },
        { id: 'episodes', label: 'الحلقات', icon: Video, badge: null },
        { id: 'calendar', label: 'جدول البث', icon: Calendar, badge: null },
        { id: 'guests', label: 'الضيوف', icon: Users, badge: null },
      ],
    },
    {
      label: 'الهواء والاستديو',
      items: [
        { id: 'on-air', label: 'وضع الهواء', icon: Radio, badge: liveCount > 0 ? 'مباشر' : null, badgeColor: 'bg-red-600 text-white' },
        { id: 'studio-screen', label: 'شاشة الاستديو', icon: MonitorPlay, badge: null },
      ],
    },
    { label: 'الوسائط', items: [{ id: 'media', label: 'مكتبة الوسائط', icon: ImageIcon, badge: null }] },
    {
      label: 'الفريق',
      items: [
        { id: 'requests', label: 'طلبات الأقسام', icon: ArrowLeftRight, badge: requestsBadge > 0 ? `${requestsBadge}` : null, badgeColor: 'bg-violet-100 text-violet-800' },
        { id: 'tasks', label: 'المهام', icon: CheckSquare, badge: tasksBadge > 0 ? `${tasksBadge}` : null, badgeColor: 'bg-blue-100 text-blue-800' },
        { id: 'bookings', label: 'حجز الموارد', icon: CalendarRange, badge: null },
        { id: 'roster', label: 'المناوبات', icon: CalendarClock, badge: null },
      ],
    },
    {
      label: 'الإدارة',
      items: [
        { id: 'reports', label: 'التقارير', icon: BarChart3, badge: null },
        { id: 'audit', label: 'سجل التدقيق', icon: ShieldCheck, badge: null },
        { id: 'users', label: 'المستخدمون والصلاحيات', icon: UserCog, badge: null },
        { id: 'settings', label: 'الإعدادات', icon: Settings, badge: null },
      ],
    },
    {
      label: 'المساعدة',
      items: [
        { id: 'help', label: 'المساعدة', icon: BookOpen, badge: null },
        { id: 'whats-new', label: 'ما الجديد', icon: Sparkles, badge: whatsNewUnseen ? 'جديد' : null, badgeColor: 'bg-emerald-500 text-white' },
      ],
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 md:hidden transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        aria-label="القائمة الرئيسية"
        {...(isSmallScreen && !isMobileOpen ? { inert: true, 'aria-hidden': true } : {})}
        {...(isSmallScreen && isMobileOpen ? { role: 'dialog', 'aria-modal': true } : {})}
        className={`theme-fixed bg-slate-900 text-slate-300 border-l border-slate-800 flex flex-col transition-all duration-300 select-none
          fixed inset-y-0 right-0 z-50 md:relative md:z-20
          ${isMobileOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'}
          ${isCollapsed ? 'w-20' : 'w-64 sm:w-72'}
        `}
      >
        {/* Brand Header */}
        <div className="h-16 border-b border-slate-800 flex items-center justify-between px-4">
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-red-600 flex items-center justify-center text-white shadow-md shrink-0">
                <Radio className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="font-extrabold text-white text-sm block leading-tight tracking-tight">
                  {APP_NAME}
                </span>
                <span className="text-[10px] text-slate-400 block leading-tight">
                  {APP_TAGLINE}
                </span>
              </div>
            </div>
          )}

          {isCollapsed && (
            <div className="mx-auto w-8 h-8 rounded-xl bg-red-600 flex items-center justify-center text-white shadow-md">
              <Radio className="w-5 h-5" />
            </div>
          )}

          <div className="flex items-center gap-1">
            {/* Collapse button on desktop */}
            <button
              type="button"
              onClick={toggleCollapse}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors hidden md:block"
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
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors md:hidden"
                title="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => canSeeNav(item.id));
          if (!items.length) return null;
          return (
            <div key={group.label || 'home'} className="space-y-1" role="group" aria-label={group.label || 'الرئيسية'}>
              {group.label && !isCollapsed && (
                <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-slate-400 tracking-wide">{group.label}</div>
              )}
              {group.label && isCollapsed && <div className="mx-3 my-2 border-t border-slate-800" />}
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeIdentifier === item.id ||
            (item.id === 'news' && ['news_list', 'news_create', 'news_edit', 'news-editor'].includes(activeIdentifier)) ||
            (item.id === 'episodes' && activeIdentifier === 'episode-workspace') ||
            (item.id === 'programs' && ['program-detail', 'program_detail'].includes(activeIdentifier));

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all relative ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
              title={isCollapsed ? item.label : undefined}
              aria-label={isCollapsed ? (item.badge ? `${item.label} (${item.badge})` : item.label) : undefined}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />

              {!isCollapsed && (
                <>
                  <span className="flex-1 text-right truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                        item.badgeColor || 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}

              {/* Indicator dot if collapsed and has badge */}
              {isCollapsed && item.badge && (
                <span className="absolute top-2 left-2 w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
            </div>
          );
        })}
      </nav>

      {/* Footer: organisation, build version and live connection state */}
      {!isCollapsed && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400">
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
