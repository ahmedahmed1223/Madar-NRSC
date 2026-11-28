import { canRequestBreaking } from '../../shared/newsWorkflow';
import { TopbarClock } from './TopbarClock';
import { Avatar } from '../common/Avatar';
import { ThemeToggle } from '../common/ThemeToggle';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { notify } from '../../services/notify';
import {
  BellRing,
  Search,
  Bell,
  Plus,
  ChevronDown,
  FileText,
  Tv,
  Video,
  CheckSquare,
  Menu,
  ShieldCheck,
  Lock,
  Keyboard,
  KeyRound,
  LogOut,
  MessageSquare,
  ClipboardList,
  Flame,
} from 'lucide-react';
import { findUserRole } from '../../shared/rbac';
import { connectionFeedback } from '../../shared/saveFeedback';
import { User, AppNotification } from '../../types';
import { ApiService } from '../../services/api';
import { intercomCommand, intercomState, routeChanged } from '../../services/uiEvents';
import { TwoFactorModal } from '../auth/TwoFactorModal';
import { NotificationInbox } from './NotificationInbox';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { groupNotifications, isNotificationSnoozed, notificationInboxPath } from '../../shared/notificationInbox';
import { requiresNotificationAcknowledgment } from '../../shared/notifications';
import { useNotificationSnoozes } from '../../hooks/useNotificationSnoozes';

const EMPTY_NOTIFICATIONS: AppNotification[] = [];

interface TopbarProps {
  currentUser: User;
  onLogout?: () => void;
  onChangePassword?: () => void;
  onOpenSearch?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenShortcuts?: () => void;
  onCreateNews?: () => void;
  onCreateProgram?: () => void;
  onCreateEpisode?: () => void;
  onCreateTask?: () => void;
  onCreateCard?: () => void;
  onNavigate?: (view: string) => void;
  unreadNotificationsCount?: number;
  onToggleMobileMenu?: () => void;
  isMobileMenuOpen?: boolean;
  isLiveLockActive?: boolean;
  onToggleLiveLock?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentUser,
  onLogout = () => {},
  onChangePassword = () => {},
  onOpenSearch,
  onOpenCommandPalette,
  onOpenShortcuts,
  onCreateNews,
  onCreateProgram,
  onCreateEpisode,
  onCreateTask,
  onCreateCard,
  onNavigate,
  unreadNotificationsCount,
  onToggleMobileMenu,
  isMobileMenuOpen = false,
  isLiveLockActive = false,
  onToggleLiveLock = () => {},
}) => {
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ pending: dataStore.pendingCount(), online: true });
  const [isTwoFactorOpen, setIsTwoFactorOpen] = useState(false);
  const userId = currentUser.id;
  const [notificationState, setNotificationState] = useState({ userId, items: EMPTY_NOTIFICATIONS });
  const notifications = notificationState.userId === userId ? notificationState.items : EMPTY_NOTIFICATIONS;
  const { entries, now, update: updateSnooze, storageFailed } = useNotificationSnoozes(userId);
  const snoozesRef = useRef(entries);
  snoozesRef.current = entries;
  const inbox = useMemo(() => groupNotifications(notifications, userId, entries, now), [notifications, userId, entries, now]);
  const bellButton = useRef<HTMLButtonElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const pathFor = (notice: AppNotification) => notificationInboxPath(notice.linkUrl, (screen) => RbacService.canOpenScreen(currentUserRef.current, screen));
  const handleSearchClick = onOpenCommandPalette || onOpenSearch || (() => {});

  useEffect(() => {
    const mine = ApiService.getMyNotifications();
    setNotificationState({ userId, items: mine });
    setIsNotifOpen(false);
    // Do not repeat notices already loaded for this account when opening the app.
    const announced = new Set(mine.map((n) => n.id));
    return dataStore.subscribe((evt) => {
      if (evt.type === 'sync-status') setSyncStatus({ pending: evt.pending, online: evt.online });
      if (evt.type !== 'data-changed' || !evt.collections.includes('notifications')) return;
      if (currentUserRef.current.id !== userId || ApiService.getCurrentUser().id !== userId) return;
      const mine = ApiService.getMyNotifications();
      setNotificationState({ userId, items: mine });
      // Arrivals from the server while the app is open are announced once, with a way to open them.
      const fresh = evt.remote ? mine.filter((n) => !n.isRead && !announced.has(n.id)) : [];
      mine.forEach((n) => announced.add(n.id));
      const here = window.location.pathname;
      const receivedAt = Date.now();
      const worth = fresh.filter((n) => pathFor(n) !== here && !isNotificationSnoozed(n, snoozesRef.current, receivedAt));
      const ordinary = worth.filter((n) => !n.urgent);
      if (ordinary.length > 3) notify({ type: 'info', title: `${ordinary.length} إشعارات جديدة`, message: 'افتح الجرس لقراءتها.' });
      worth.filter((n) => n.urgent || ordinary.length <= 3).forEach((n) => {
        notify({
          type: n.urgent ? 'warning' : 'info',
          title: n.title,
          message: n.message,
          duration: n.urgent ? 12000 : 7000,
          action: pathFor(n) ? {
            label: 'فتح',
            run: () => {
              const path = pathFor(n);
              if (!path || currentUserRef.current.id !== userId || ApiService.getCurrentUser().id !== userId) return;
              if (!requiresNotificationAcknowledgment(n)) ApiService.markNotificationRead(n.id);
              navigateRef.current?.(path);
            },
          } : undefined,
        });
      });
    });
  }, [userId]);

  const canToggleLock = RbacService.hasPermission(currentUser, 'rundown.lock_override');
  const can = (permission: string) => RbacService.hasPermission(currentUser, permission);
  const canOpen = (screen: string) => RbacService.canOpenScreen(currentUser, screen);

  const createActions = [
    { label: 'خبر صحفي جديد', icon: FileText, run: canOpen('news-editor') && can('news.create') ? onCreateNews : undefined },
    { label: 'خبر عاجل', icon: Flame, run: onNavigate && canOpen('news-editor') && canRequestBreaking(can) ? () => onNavigate('/news/new?breaking=1') : undefined },
    { label: 'تكليف', icon: ClipboardList, run: canOpen('cards') && can('cards.manage') && RbacService.acceptsNewAssignments(currentUser) ? onCreateCard : undefined },
    { label: 'برنامج تلفزيوني جديد', icon: Tv, run: canOpen('programs') && can('programs.manage') ? onCreateProgram : undefined },
    { label: 'حلقة برنامج جديدة', icon: Video, run: canOpen('episodes') && can('episodes.create') ? onCreateEpisode : undefined },
    { label: 'مهمة تحريرية جديدة', icon: CheckSquare, run: canOpen('tasks') && can('tasks.create_assign') ? onCreateTask : undefined },
  ].filter(action => action.run);

  // Floating menus close on Esc and whenever the screen changes.
  const [chat, setChat] = useState(intercomState.last || { open: false, unread: 0 });
  useEffect(() => intercomState.on(setChat), []);
  useEffect(() => {
    const closeAll = () => {
      setIsNotifOpen(false);
      setIsUserMenuOpen(false);
      setIsCreateMenuOpen(false);
    };
    const offRoute = routeChanged.on(closeAll);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=alertdialog]')) {
        const expandedButton = [bellButton, createButton, accountButton].find(ref => ref.current?.getAttribute('aria-expanded') === 'true');
        expandedButton?.current?.focus();
        closeAll();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      offRoute();
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const { unreadCount, unreadUrgent } = inbox;
  const closeInbox = () => {
    setIsNotifOpen(false);
    bellButton.current?.focus();
  };

  const handleMarkAllRead = () => {
    ApiService.markAllNotificationsRead();
    setNotificationState({ userId, items: ApiService.getMyNotifications() });
  };

  // The role's own name as defined in «المستخدمون والصلاحيات» (one name everywhere), else the job title.
  const roleName = findUserRole(currentUser, RbacService.getRoleDefinitions())?.nameAr?.split(' (')[0] || currentUser.jobTitle;

  return (
    <header className="app-topbar workspace-topbar no-print bg-white border-b border-slate-200 sticky top-0 z-30">
      {/* Right side (RTL Start): Station Live Clock & Search */}
      <div className="workspace-toolbar-group">
        {/* Mobile menu trigger */}
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="workspace-icon-button lg:hidden"
            title="فتح القائمة الرئيسية"
            aria-label="فتح القائمة الرئيسية"
            aria-controls="workspace-navigation"
            aria-expanded={isMobileMenuOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Station clock + shared on-air lock (enforced by the server for every user) */}
        {isLiveLockActive && (
          <span className="sm:hidden p-1.5 rounded-lg bg-red-50 text-red-600" role="status" aria-label="قفل البث المباشر مفعّل" title="قفل البث المباشر مفعّل">
            <Lock className="w-4 h-4" />
          </span>
        )}
        <TopbarClock timezone={ApiService.getSettings()?.defaultTimezone} locked={isLiveLockActive} canToggle={canToggleLock} onToggle={onToggleLiveLock} />

        {/* Real synchronisation status with the server */}
        <div
          className={`hidden 2xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-2xs font-bold border whitespace-nowrap max-w-[16rem] truncate ${
            !syncStatus.online
              ? 'bg-red-50 text-red-700 border-red-200'
              : syncStatus.pending > 0
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}
          title="حالة المزامنة مع الخادم"
          role="status"
        >
          <span className={`w-2 h-2 rounded-full ${!syncStatus.online ? 'bg-red-500' : syncStatus.pending > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          {connectionFeedback(typeof navigator === 'undefined' || navigator.onLine, syncStatus.online, syncStatus.pending)}
        </div>

        {/* Compact sync indicator for narrower screens */}
        <span
          role="status"
          title={connectionFeedback(typeof navigator === 'undefined' || navigator.onLine, syncStatus.online, syncStatus.pending)}
          aria-label={!syncStatus.online ? 'غير متصل بالخادم' : syncStatus.pending > 0 ? 'جارٍ المزامنة' : 'متصل بالخادم'}
          className={`max-[390px]:sr-only 2xl:hidden w-2.5 h-2.5 rounded-full shrink-0 ${!syncStatus.online ? 'bg-red-500 animate-pulse' : syncStatus.pending > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
        />

        {/* Mobile Search Button */}
        <button
          type="button"
          onClick={handleSearchClick}
          aria-label="البحث السريع (Ctrl + K)"
          className="workspace-icon-button xl:hidden"
          title="البحث السريع"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Global Search Button (Desktop) */}
        <button
          type="button"
          onClick={handleSearchClick}
          aria-label="البحث السريع (Ctrl + K)"
          title="البحث السريع (Ctrl + K)"
          className="hidden xl:flex min-h-10 shrink-0 items-center gap-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors border border-slate-200"
        >
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <span className="2xl:hidden">بحث…</span>
          <span className="hidden 2xl:inline">بحث في غرفة الأخبار</span>
          <kbd className="hidden 2xl:inline whitespace-nowrap bg-white px-1.5 py-0.5 rounded-md border border-slate-300 text-2xs font-mono text-slate-500" dir="ltr">
            Ctrl + K
          </kbd>
        </button>
      </div>

      {/* Left side (RTL End): Quick Actions, Notifications, Role Switcher */}
      <div className="workspace-toolbar-group">
        {/* PWA Workstation Install Prompt */}
        <PWAInstallButton />

        {/* Quick Create Dropdown */}
        {createActions.length > 0 && <div className="sm:relative" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsCreateMenuOpen(false);
        }}>
          <button
            ref={createButton}
            type="button"
            onClick={() => {
              setIsUserMenuOpen(false);
              setIsNotifOpen(false);
              setIsCreateMenuOpen(open => !open);
            }}
            aria-label="إنشاء جديد"
            aria-expanded={isCreateMenuOpen}
            aria-controls={isCreateMenuOpen ? 'workspace-create-actions' : undefined}
            className="flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] sm:px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden 2xl:inline">إنشاء جديد</span>
            <span className="hidden xl:inline 2xl:hidden">جديد</span>
            <ChevronDown className="w-3 h-3 opacity-80 hidden xl:block" />
          </button>

          {isCreateMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsCreateMenuOpen(false)} />
              <div id="workspace-create-actions" className="workspace-popover sm:w-60" role="group" aria-label="خيارات الإنشاء">
                {createActions.map(({ label, icon: Icon, run }) => (
                  <button key={label} type="button" className="workspace-popover-item" onClick={() => {
                    setIsCreateMenuOpen(false);
                    createButton.current?.focus();
                    run?.();
                  }}>
                    <Icon className="size-4 shrink-0 text-blue-700" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>}

        {canOpen('messages') && <button
          type="button"
          onClick={() => {
            setIsNotifOpen(false);
            intercomCommand.emit('toggle');
          }}
          aria-label={chat.unread > 0 ? `المحادثة الداخلية (${chat.unread} رسالة جديدة)` : 'المحادثة الداخلية'}
          aria-expanded={chat.open}
          title="المحادثة الداخلية بين الأقسام"
          className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5 sm:px-2 rounded-lg transition-colors relative ${chat.open ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'}`}
        >
          <MessageSquare className="w-5 h-5" />
          <span className="hidden lg:inline text-xs font-semibold whitespace-nowrap">محادثة الأقسام</span>
          {chat.unread > 0 && (
            <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-blue-600 text-white rounded-full text-3xs leading-4 text-center font-bold tabular-nums">
              {chat.unread > 9 ? '9+' : chat.unread}
            </span>
          )}
        </button>}

        {/* Notifications Button */}
        <div>
          <button
            ref={bellButton}
            type="button"
            onClick={() => {
              if (!isNotifOpen) intercomCommand.emit('close');
              setIsCreateMenuOpen(false);
              setIsUserMenuOpen(false);
              setIsNotifOpen(open => !open);
            }}
            aria-label={unreadCount > 0 ? `الإشعارات (${unreadCount} غير مقروء)` : 'الإشعارات'}
            aria-expanded={isNotifOpen}
            aria-controls={isNotifOpen ? 'notification-inbox' : undefined}
            className="workspace-icon-button relative"
            title="الإشعارات التحريرية"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span aria-hidden="true" data-testid="notification-unread-count" dir="ltr" className={`absolute -end-0.5 top-0.5 min-w-4 rounded-full px-1 text-center text-2xs font-bold leading-4 tabular-nums text-white ring-2 ring-white ${unreadUrgent ? 'bg-red-700' : 'bg-blue-700'}`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {isNotifOpen && <NotificationInbox
            inbox={inbox}
            userId={userId}
            storageFailed={storageFailed}
            onClose={closeInbox}
            onMarkAllRead={handleMarkAllRead}
            onMarkRead={(id) => {
              ApiService.markNotificationRead(id);
              setNotificationState({ userId, items: ApiService.getMyNotifications() });
            }}
            onSnooze={updateSnooze}
            pathFor={pathFor}
            onNavigate={(path) => {
              closeInbox();
              onNavigate?.(path);
            }}
          />}
        </div>

        <ThemeToggle className="workspace-theme max-sm:static" />

        {/* Keyboard Shortcuts Trigger Button */}
        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="hidden 2xl:flex p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-transparent hover:border-slate-200"
            title="اختصارات لوحة المفاتيح (?)"
            aria-label="اختصارات لوحة المفاتيح"
          >
            <Keyboard className="w-5 h-5" />
          </button>
        )}

        {/* Signed-in user menu */}
        <div className="sm:relative" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsUserMenuOpen(false);
        }}>
          <button
            type="button"
            ref={accountButton}
            onClick={() => {
              setIsNotifOpen(false);
              setIsCreateMenuOpen(false);
              setIsUserMenuOpen(open => !open);
            }}
            className="min-h-[44px] min-w-[44px] max-sm:w-[44px] flex items-center justify-center gap-1.5 sm:px-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-colors"
            title="حسابي: كلمة المرور والتحقق بخطوتين وتسجيل الخروج"
            aria-label={`الحساب ${currentUser.fullName}`}
            aria-expanded={isUserMenuOpen}
            aria-controls={isUserMenuOpen ? 'workspace-account-actions' : undefined}
          >
            <span aria-hidden="true" className="inline-flex"><Avatar src={currentUser.avatarUrl} name={currentUser.fullName} className="size-7 rounded-full ring-1 ring-slate-200" /></span>
            <div className="hidden sm:block text-right max-w-[9rem] min-w-0">
              <span className="text-2xs font-bold text-slate-800 2xl:hidden">الحساب</span>
              <span className="hidden 2xl:block text-xs font-bold text-slate-800 leading-tight truncate">
                {currentUser.fullName}
              </span>
              <span aria-hidden="true" className="hidden 2xl:block text-2xs text-blue-600 font-semibold leading-tight truncate">
                {roleName}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 hidden sm:block" />
          </button>

          {isUserMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
              <div id="workspace-account-actions" className="workspace-popover sm:w-72" role="group" aria-label="خيارات الحساب">
                <div className="px-3 py-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-800 block">{currentUser.fullName}</span>
                  <span className="text-2xs text-slate-600 block wrap-anywhere" dir="ltr">
                    {currentUser.email}
                  </span>
                  <span className="text-2xs text-blue-600 font-semibold block mt-0.5">
                    {[roleName, currentUser.department].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="py-1 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onNavigate?.('/alerts');
                    }}
                    className="workspace-popover-item"
                  >
                    <BellRing className="w-4 h-4 text-slate-500" />
                    <span>تنبيهاتي (البريد والجوال)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      accountButton.current?.focus();
                      onChangePassword();
                    }}
                    className="workspace-popover-item"
                  >
                    <KeyRound className="w-4 h-4 text-slate-500" />
                    <span>تغيير كلمة المرور</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      accountButton.current?.focus();
                      setIsTwoFactorOpen(true);
                    }}
                    className="workspace-popover-item"
                  >
                    <ShieldCheck className="w-4 h-4 text-slate-500" />
                    <span>التحقق بخطوتين {currentUser.twoFactorEnabled ? '(مفعّل)' : ''}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onLogout();
                    }}
                    className="workspace-popover-item text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <TwoFactorModal
        isOpen={isTwoFactorOpen}
        onClose={() => setIsTwoFactorOpen(false)}
        isEnabled={!!currentUser.twoFactorEnabled}
        onChanged={() => undefined}
      />

    </header>
  );
};
