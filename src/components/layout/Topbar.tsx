import React, { useState, useEffect } from 'react';
import {
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
} from 'lucide-react';
import { User, AppNotification } from '../../types';
import { ApiService } from '../../services/api';
import { NotificationDropdown } from './NotificationDropdown';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { ProductionEnvironmentModal } from '../common/ProductionEnvironmentModal';
import { SelfHealingModal } from '../common/SelfHealingModal';
import { useSystemHealth } from '../../hooks/useSystemHealth';

interface TopbarProps {
  currentUser: User;
  onUserChange?: (user: User) => void;
  onSwitchUser?: (user: User) => void;
  onOpenSearch?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenShortcuts?: () => void;
  onCreateNews?: () => void;
  onCreateProgram?: () => void;
  onCreateEpisode?: () => void;
  onCreateTask?: () => void;
  onNavigate?: (view: string) => void;
  onOpenLiveWire?: () => void;
  unreadNotificationsCount?: number;
  onToggleMobileMenu?: () => void;
  isLiveLockActive?: boolean;
  onToggleLiveLock?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentUser,
  onUserChange,
  onSwitchUser,
  onOpenSearch,
  onOpenCommandPalette,
  onOpenShortcuts,
  onCreateNews = () => {},
  onCreateProgram = () => {},
  onCreateEpisode = () => {},
  onCreateTask = () => {},
  onNavigate,
  onOpenLiveWire,
  unreadNotificationsCount,
  onToggleMobileMenu,
  isLiveLockActive = false,
  onToggleLiveLock = () => {},
}) => {
  const [timeStr, setTimeStr] = useState('');
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isProductionModalOpen, setIsProductionModalOpen] = useState(false);
  const [isSelfHealingOpen, setIsSelfHealingOpen] = useState(false);
  const { report } = useSystemHealth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const handleUserSelect = onSwitchUser || onUserChange || (() => {});
  const handleSearchClick = onOpenCommandPalette || onOpenSearch || (() => {});

  useEffect(() => {
    // Saudi Arabia / Arabic clock
    const updateTime = () => {
      const now = new Date();
      const formatted = now.toLocaleTimeString('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setTimeStr(formatted);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setNotifications(ApiService.getNotifications());
    setUsers(ApiService.getUsers());
  }, [isNotifOpen, isUserMenuOpen]);

  const unreadCount = (notifications || []).filter((n) => !n.isRead).length;

  const handleMarkAllRead = () => {
    ApiService.markAllNotificationsRead();
    setNotifications(ApiService.getNotifications());
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
      <div className="flex items-center gap-2 sm:gap-4">
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

        {/* Live On Air Badge & Saudi Time */}
        <div className="flex items-center gap-2 sm:gap-2.5 bg-slate-900 text-white px-2.5 sm:px-3 py-1.5 rounded-xl text-xs shadow-xs font-mono">
          <div className="flex items-center gap-1.5 text-red-400">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span className="font-bold text-[10px] tracking-wider">ON AIR</span>
          </div>
          <span className="text-slate-500">|</span>
          <div className="flex items-center gap-1 font-bold text-slate-200">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{timeStr || '00:00:00'}</span>
            <span className="text-[10px] text-slate-400 font-sans hidden sm:inline">بتوقيت الرياض</span>
          </div>
        </div>

        {/* Official Production Readiness Badge */}
        <button
          id="official-production-status-btn"
          type="button"
          onClick={() => setIsProductionModalOpen(true)}
          title="بيئة العمل والإنتاج الرسمي (فحص الأنظمة التشغيلية، النسخ الاحتياطي، قفل البث)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 rounded-xl text-xs font-semibold border border-emerald-500/30 transition-all cursor-pointer shadow-2xs"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-bold text-[11px] hidden sm:inline">بيئة الإنتاج</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          {isLiveLockActive && <Lock className="w-3 h-3 text-amber-300" />}
        </button>

        {/* 24/7 Self-Healing & System Health Badge */}
        <button
          id="system-self-healing-btn"
          type="button"
          onClick={() => setIsSelfHealingOpen(true)}
          title="مركز الاستقرار والتعافي الذاتي 24/7 (انقر للفحص والإصلاح الشامل)"
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-teal-950/90 hover:bg-teal-900 text-teal-300 rounded-xl text-xs font-semibold border border-teal-500/30 transition-all cursor-pointer shadow-2xs"
        >
          <Activity className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
          <span className="font-bold text-[11px]">التعافي الذاتي 24/7</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-teal-500/20 text-teal-200 rounded-md">
            {report.healthScore}%
          </span>
        </button>

        {/* SQLite 3 Status Badge */}
        <button
          type="button"
          onClick={() => onNavigate?.('database')}
          title="قاعدة بيانات SQLite 3 (انقر للإدارة والاستعلامات)"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-indigo-300 rounded-xl text-xs font-mono border border-indigo-500/30 transition-all cursor-pointer"
        >
          <Database className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-bold text-[11px]">SQLite 3</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </button>

        {/* Live Wire Feeds Button */}
        {onOpenLiveWire && (
          <button
            type="button"
            onClick={onOpenLiveWire}
            title="شريط برقيات وكالات الأنباء العالمية المباشرة (رويترز، واس، أ ف ب، بلومبرغ)"
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-900/90 hover:bg-blue-800 text-blue-200 rounded-xl text-xs font-semibold border border-blue-500/30 transition-all cursor-pointer shadow-2xs"
          >
            <Globe className="w-3.5 h-3.5 text-blue-400 animate-spin-slow" />
            <span className="font-bold text-[11px]">برقيات الوكالات</span>
            <span className="px-1.5 py-0.2 bg-red-600 text-white font-mono text-[9px] font-bold rounded-full">
              LIVE
            </span>
          </button>
        )}

        {/* Mobile Search Button */}
        <button
          type="button"
          onClick={handleSearchClick}
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl md:hidden transition-colors"
          title="البحث السريع"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Global Search Button (Desktop) */}
        <button
          type="button"
          onClick={handleSearchClick}
          className="hidden md:flex items-center gap-2.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-500 hover:text-slate-700 rounded-xl text-xs transition-colors border border-slate-200/60"
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <span>بحث فوري في الأخبار والبرامج...</span>
          <kbd className="bg-white px-1.5 py-0.5 rounded-md border border-slate-300 text-[10px] font-mono text-slate-400">
            Ctrl + K
          </kbd>
        </button>
      </div>

      {/* Left side (RTL End): Quick Actions, Notifications, Role Switcher */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* PWA Workstation Install Prompt */}
        <PWAInstallButton />

        {/* Quick Create Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">إنشاء جديد</span>
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
            onNavigate={(url) => url && onNavigate(url)}
          />
        </div>

        {/* Keyboard Shortcuts Trigger Button */}
        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="hidden sm:flex p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-transparent hover:border-slate-200"
            title="اختصارات لوحة المفاتيح والإنتاج السريع (?)"
          >
            <Keyboard className="w-5 h-5" />
          </button>
        )}

        {/* User Account / Role Switcher (RBAC Live Test) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2.5 p-1.5 pr-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-all"
            title="تبديل الحساب أو الرتبة التحريرية"
          >
            <img
              src={currentUser.avatarUrl}
              alt={currentUser.fullName}
              className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-200"
            />
            <div className="text-right hidden sm:block">
              <span className="text-xs font-bold text-slate-800 block leading-tight">
                {currentUser.fullName}
              </span>
              <span className="text-[10px] text-blue-600 font-semibold block leading-tight">
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
                  <span className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                    محاكاة الأدوار والصلاحيات (RBAC Live)
                  </span>
                  <p className="text-xs text-slate-500 leading-normal">
                    اختر أي دور لتجربة الصلاحيات الحقيقية في التدقيق، النشر، وإدارة الرانداون:
                  </p>
                </div>

                <div className="max-h-64 overflow-y-auto py-1 space-y-1">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        handleUserSelect(u);
                        setIsUserMenuOpen(false);
                      }}
                      className={`w-full p-2 rounded-xl flex items-center gap-2.5 text-right transition-colors ${
                        u.id === currentUser.id ? 'bg-blue-50 text-blue-900 font-bold' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <img
                        src={u.avatarUrl}
                        alt={u.fullName}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <div className="flex-1 truncate">
                        <div className="text-xs font-bold leading-tight">{u.fullName}</div>
                        <div className="text-[10px] text-slate-500 leading-tight">
                          {roleLabels[u.role]} - {u.department}
                        </div>
                      </div>
                      {u.id === currentUser.id && (
                        <span className="w-2 h-2 rounded-full bg-blue-600" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Official Production Environment & Broadcast Readiness Modal */}
      <ProductionEnvironmentModal
        isOpen={isProductionModalOpen}
        onClose={() => setIsProductionModalOpen(false)}
        isLiveLockActive={isLiveLockActive}
        onToggleLiveLock={onToggleLiveLock}
        onNavigate={onNavigate}
      />

      {/* 24/7 Self-Healing & System Health Operations Hub Modal */}
      <SelfHealingModal
        isOpen={isSelfHealingOpen}
        onClose={() => setIsSelfHealingOpen(false)}
      />
    </header>
  );
};
