import { deviceDiffersFromStation, stationTimeZone } from '../../shared/dates';
import { Avatar } from '../common/Avatar';
import { ThemeToggle } from '../common/ThemeToggle';
import React, { useState, useEffect } from 'react';
import { BellRing,
  Search,
  Bell,
  Plus,
  Radio,
  Clock,
  UserCheck,
  ChevronDown,
  FileText,
  Tv,
  Video,
  CheckSquare,
  Shield,
  Activity,
  Database,
  Menu,
  Globe,
  ShieldCheck,
  Lock,
  Keyboard,
  KeyRound,
  LogOut,
} from 'lucide-react';
import { User, AppNotification } from '../../types';
import { ApiService } from '../../services/api';
import { TwoFactorModal } from '../auth/TwoFactorModal';
import { NotificationDropdown } from './NotificationDropdown';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';

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
  onNavigate?: (view: string) => void;
  unreadNotificationsCount?: number;
  onToggleMobileMenu?: () => void;
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
  onCreateNews = () => {},
  onCreateProgram = () => {},
  onCreateEpisode = () => {},
  onCreateTask = () => {},
  onNavigate,
  unreadNotificationsCount,
  onToggleMobileMenu,
  isLiveLockActive = false,
  onToggleLiveLock = () => {},
}) => {
  const [timeStr, setTimeStr] = useState('');
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ pending: dataStore.pendingCount(), online: true });
  const [isTwoFactorOpen, setIsTwoFactorOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const handleSearchClick = onOpenCommandPalette || onOpenSearch || (() => {});

  const stationTz = stationTimeZone(ApiService.getSettings()?.defaultTimezone);
  const [stationTime, setStationTime] = useState('');
  const [zoneMismatch, setZoneMismatch] = useState(false);
  useEffect(() => {
    // The clock shows this device's time: the same clock every date/time field uses.
    const fmt = (timeZone?: string) =>
      new Date().toLocaleTimeString('ar-EG-u-nu-latn', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const updateTime = () => {
      setTimeStr(fmt());
      const differs = deviceDiffersFromStation(stationTz);
      setZoneMismatch(differs);
      setStationTime(differs && stationTz ? fmt(stationTz).slice(0, 5) : '');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [stationTz]);

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'sync-status') setSyncStatus({ pending: evt.pending, online: evt.online });
        if (evt.type === 'data-changed' && evt.collections.includes('notifications')) setNotifications(ApiService.getMyNotifications());
      }),
    []
  );

  const canToggleLock = RbacService.hasPermission(currentUser, 'rundown.lock_override');

  useEffect(() => {
    setNotifications(ApiService.getMyNotifications());
  }, [isNotifOpen, isUserMenuOpen]);

  const unreadCount = (notifications || []).filter((n) => !n.isRead).length;

  const handleMarkAllRead = () => {
    ApiService.markAllNotificationsRead();
    setNotifications(ApiService.getMyNotifications());
  };

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'مدير النظام العام',
    ADMIN: 'مدير قطاع الأخبار',
    EDITOR: 'رئيس تحرير أول',
    JOURNALIST: 'محرر صحفي',
    PRODUCER: 'منتج برامج',
    PRESENTER: 'مذيع ومقدم',
    REPORTER: 'مراسل ميداني',
    MEDIA: 'فني وسائط وأرشيف',
    VIEWER: 'مطلع',
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
      {/* Right side (RTL Start): Station Live Clock & Search */}
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 overflow-hidden">
        {/* Mobile menu trigger */}
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl md:hidden transition-colors"
            title="فتح القائمة الرئيسية"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Station clock + shared on-air lock (enforced by the server for every user) */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 bg-slate-100 border border-slate-200 text-slate-800 px-2 sm:px-3 py-1.5 rounded-xl text-xs font-mono shrink-0">
          <button
            type="button"
            onClick={onToggleLiveLock}
            disabled={!canToggleLock}
            title={
              isLiveLockActive
                ? 'قفل البث المباشر مفعّل لكل المستخدمين (Ctrl+Alt+L لرفعه)'
                : 'تفعيل قفل البث المباشر: يمنع حذف البرامج والحلقات أثناء الهواء (Ctrl+Alt+L)'
            }
            className={`flex items-center gap-1.5 disabled:cursor-default ${isLiveLockActive ? 'text-red-600' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {isLiveLockActive ? <Lock className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
            <span className="font-bold text-[10px] tracking-wider hidden lg:inline">{isLiveLockActive ? 'ON AIR LOCK' : 'غير مقفل'}</span>
          </button>
          <span className="text-slate-300 hidden lg:inline">|</span>
          <div className="hidden sm:flex items-center gap-1 font-bold text-slate-800">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>{timeStr || '00:00:00'}</span>
          </div>
          {zoneMismatch && (
            <span
              role="status"
              className="font-sans text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-lg px-1.5 py-0.5"
              title={`توقيت جهازك يختلف عن توقيت المحطة (${stationTz}). الأوقات التي تدخلها تُفهم بتوقيت جهازك؛ اضبط المنطقة الزمنية لجهازك لتطابق المحطة.`}
            >
              المحطة {stationTime}
            </span>
          )}
        </div>

        {/* Real synchronisation status with the server */}
        <div
          className={`hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border whitespace-nowrap ${
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
          {!syncStatus.online ? 'غير متصل' : syncStatus.pending > 0 ? `جارٍ الحفظ (${syncStatus.pending})` : 'متصل ومحفوظ'}
        </div>

        {/* Compact sync indicator for narrower screens */}
        <span
          role="status"
          title={!syncStatus.online ? 'غير متصل بالخادم' : syncStatus.pending > 0 ? `جارٍ الحفظ (${syncStatus.pending})` : 'متصل ومحفوظ'}
          aria-label={!syncStatus.online ? 'غير متصل بالخادم' : syncStatus.pending > 0 ? 'جارٍ الحفظ' : 'متصل ومحفوظ'}
          className={`xl:hidden w-2.5 h-2.5 rounded-full shrink-0 ${!syncStatus.online ? 'bg-red-500 animate-pulse' : syncStatus.pending > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
        />

        {/* Mobile Search Button */}
        <button
          type="button"
          onClick={handleSearchClick}
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl xl:hidden transition-colors"
          title="البحث السريع"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Global Search Button (Desktop) */}
        <button
          type="button"
          onClick={handleSearchClick}
          className="hidden xl:flex items-center gap-2.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-500 hover:text-slate-700 rounded-xl text-xs transition-colors border border-slate-200/60"
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden 2xl:inline">بحث فوري في الأخبار والبرامج...</span>
          <kbd className="bg-white px-1.5 py-0.5 rounded-md border border-slate-300 text-[10px] font-mono text-slate-400">
            Ctrl + K
          </kbd>
        </button>
      </div>

      {/* Left side (RTL End): Quick Actions, Notifications, Role Switcher */}
      <div className="flex items-center gap-1 sm:gap-3 shrink-0">
        {/* PWA Workstation Install Prompt */}
        <PWAInstallButton />

        {/* Quick Create Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden xl:inline">إنشاء جديد</span>
            <ChevronDown className="w-3 h-3 opacity-80" />
          </button>

          {isCreateMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsCreateMenuOpen(false)} />
              <div className="absolute left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    onCreateNews();
                  }}
                  className="w-full px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                >
                  <FileText className="w-4 h-4 text-blue-600" />
                  خبر صحفي جديد
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    onCreateProgram();
                  }}
                  className="w-full px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                >
                  <Tv className="w-4 h-4 text-emerald-600" />
                  برنامج تلفزيوني جديد
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    onCreateEpisode();
                  }}
                  className="w-full px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                >
                  <Video className="w-4 h-4 text-purple-600" />
                  حلقة برنامج جديدة
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMenuOpen(false);
                    onCreateTask();
                  }}
                  className="w-full px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                >
                  <CheckSquare className="w-4 h-4 text-amber-600" />
                  مهمة تحريرية جديدة
                </button>
              </div>
            </>
          )}
        </div>

        {/* Notifications Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            aria-label={unreadCount > 0 ? `الإشعارات (${unreadCount} غير مقروء)` : 'الإشعارات'}
            aria-expanded={isNotifOpen}
            className="p-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors relative"
            title="الإشعارات التحريرية"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-600 rounded-full ring-2 ring-white" />
            )}
          </button>

          <NotificationDropdown
            isOpen={isNotifOpen}
            onClose={() => setIsNotifOpen(false)}
            notifications={notifications}
            onMarkAllRead={handleMarkAllRead}
            onMarkRead={(id) => {
              ApiService.markNotificationRead(id);
              setNotifications(ApiService.getMyNotifications());
            }}
            onNavigate={(url) => url && onNavigate(url)}
          />
        </div>

        <ThemeToggle />

        {/* Keyboard Shortcuts Trigger Button */}
        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="hidden xl:flex p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-transparent hover:border-slate-200"
            title="اختصارات لوحة المفاتيح والإنتاج السريع (?)"
          >
            <Keyboard className="w-5 h-5" />
          </button>
        )}

        {/* Signed-in user menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2.5 p-1.5 pr-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-all"
            title="حساب المستخدم"
          >
            <Avatar src={currentUser.avatarUrl} name={currentUser.fullName} className="w-7 h-7 rounded-full ring-1 ring-slate-200" />
            <div className="text-right hidden xl:block max-w-[9rem] min-w-0">
              <span className="text-xs font-bold text-slate-800 block leading-tight truncate">
                {currentUser.fullName}
              </span>
              <span className="text-[10px] text-blue-600 font-semibold block leading-tight truncate">
                {roleLabels[currentUser.role] || currentUser.jobTitle}
              </span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {isUserMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
              <div className="absolute left-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-50 text-right">
                <div className="px-3 py-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-800 block">{currentUser.fullName}</span>
                  <span className="text-[11px] text-slate-500 block" dir="ltr">
                    {currentUser.email}
                  </span>
                  <span className="text-[10px] text-blue-600 font-semibold block mt-0.5">
                    {roleLabels[currentUser.role] || currentUser.jobTitle} - {currentUser.department}
                  </span>
                </div>
                <div className="py-1 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onNavigate?.('/alerts');
                    }}
                    className="w-full p-2 rounded-xl flex items-center gap-2 text-right text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <BellRing className="w-4 h-4 text-slate-500" />
                    <span>تنبيهاتي (البريد والجوال)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onChangePassword();
                    }}
                    className="w-full p-2 rounded-xl flex items-center gap-2 text-right text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <KeyRound className="w-4 h-4 text-slate-500" />
                    <span>تغيير كلمة المرور</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setIsTwoFactorOpen(true);
                    }}
                    className="w-full p-2 rounded-xl flex items-center gap-2 text-right text-xs font-bold text-slate-700 hover:bg-slate-50"
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
                    className="w-full p-2 rounded-xl flex items-center gap-2 text-right text-xs font-bold text-red-600 hover:bg-red-50"
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
