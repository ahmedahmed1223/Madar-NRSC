import React from 'react';
import {
  LayoutDashboard,
  Newspaper, FolderGit2,
  Flame,
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
  FlaskConical,
  Database,
  Star,
  X,
} from 'lucide-react';
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

  const navItems = [
    {
      id: 'dashboard',
      label: 'الرئيسية والتحكم',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'stories',
      label: 'القصص والملفات المركزية',
      icon: FolderGit2,
      badge: null,
    },
    {
      id: 'news',
      label: 'غرفة الأخبار والتقارير',
      icon: Newspaper,
      badge: newsBadge > 0 ? `${newsBadge} مراجعة` : null,
      badgeColor: 'bg-amber-100 text-amber-800',
    },
    {
      id: 'breaking',
      label: 'شريط الأخبار العاجلة',
      icon: Flame,
      badge: breakingCount > 0 ? `${breakingCount} عاجل` : null,
      badgeColor: 'bg-red-500 text-white animate-pulse',
    },
    {
      id: 'programs',
      label: 'البرامج التلفزيونية',
      icon: Tv,
      badge: null,
    },
    {
      id: 'program-detail',
      label: 'شاشة البرنامج والتقييم',
      icon: Star,
      badge: 'تقييم',
      badgeColor: 'bg-amber-100 text-amber-900 border border-amber-300 font-bold',
    },
    {
      id: 'episodes',
      label: 'حلقات البرامج',
      icon: Video,
      badge: null,
    },
    {
      id: 'guests',
      label: 'أرشيف وبنك الضيوف',
      icon: Users,
      badge: null,
    },
    {
      id: 'tasks',
      label: 'المهام التحريرية',
      icon: CheckSquare,
      badge: tasksBadge > 0 ? `${tasksBadge}` : null,
      badgeColor: 'bg-blue-100 text-blue-800',
    },
    {
      id: 'calendar',
      label: 'جدول البث والمواعيد',
      icon: Calendar,
      badge: null,
    },
    {
      id: 'media',
      label: 'مكتبة الوسائط والأرشيف',
      icon: ImageIcon,
      badge: null,
    },
    {
      id: 'reports',
      label: 'التقارير والإحصائيات',
      icon: BarChart3,
      badge: null,
    },
    {
      id: 'audit',
      label: 'سجل التدقيق والأمان',
      icon: ShieldCheck,
      badge: null,
    },
    {
      id: 'database',
      label: 'قاعدة بيانات SQLite',
      icon: Database,
      badge: 'SQL نشط',
      badgeColor: 'bg-indigo-900/60 text-indigo-300 font-mono text-[10px] border border-indigo-500/30',
    },
    {
      id: 'tests',
      label: 'فحص واختبار النظام',
      icon: FlaskConical,
      badge: '19 فحص',
      badgeColor: 'bg-emerald-100 text-emerald-800 font-mono',
    },
    {
      id: 'settings',
      label: 'إعدادات المحطة والنظام',
      icon: Settings,
      badge: null,
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
        className={`bg-slate-900 text-slate-300 border-l border-slate-800 flex flex-col transition-all duration-300 select-none
          fixed inset-y-0 right-0 z-50 md:relative md:z-20
          ${isMobileOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'}
          ${isCollapsed ? 'w-20' : 'w-64 sm:w-72'}
        `}
      >
        {/* Brand Header */}
        <div className="h-16 border-b border-slate-800 flex items-center justify-between px-4">
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-red-600 flex items-center justify-center text-white shadow-md shrink-0">
                <Radio className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="font-extrabold text-white text-sm block leading-tight tracking-tight">
                  منظومة الأخبار NRCS
                </span>
                <span className="text-[10px] text-slate-400 block leading-tight">
                  غرفة الأخبار وإعداد البرامج
                </span>
              </div>
            </div>
          )}

          {isCollapsed && (
            <div className="mx-auto w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-red-600 flex items-center justify-center text-white shadow-md">
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
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeIdentifier === item.id ||
            (item.id === 'news' && ['news_list', 'news_create', 'news_edit'].includes(activeIdentifier)) ||
            (item.id === 'episodes' && activeIdentifier === 'episode-workspace');

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
                <span className="absolute top-2 left-2 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Station Info */}
      {!isCollapsed && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span>إصدار المنظومة: v2.4.0</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              متصل
            </span>
          </div>
          <div className="truncate text-slate-300 font-medium">
            استوديو A1 الرئيسي - مركز البث
          </div>
        </div>
      )}
    </aside>
  </>
  );
};
