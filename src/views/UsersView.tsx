import { confirmDialog, promptDialog } from '../services/dialogs';
import { notify } from '../services/notify';
import { matchesQuery } from '../shared/search';
import { SortTh, sortList, usePersistentSort } from '../components/common/SortHeader';

const USER_SORT_KEYS = ['name', 'role', 'department', 'status', 'lastLogin'] as const;
type UserSortKey = (typeof USER_SORT_KEYS)[number];
const VIEW_KEY = 'nrcs-users-view';
const ICON_BTN = 'min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center bg-white rounded-lg border border-slate-200 transition-colors';
import { Avatar } from '../components/common/Avatar';
import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { stationGroupsOf, stationName, stationsOf } from '../shared/stations';
import { ApiService } from '../services/api';
import { authClient } from '../services/authClient';
import { dataStore } from '../services/dataStore';
import { RbacService, RoleDefinition, findUserRole } from '../services/rbacService';
import { temporaryPassword, webRandom } from '../shared/passwords';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { UserFormModal } from '../components/users/UserFormModal';
import { RoleEditModal } from '../components/users/RoleEditModal';
import { PermissionsWorkspace } from '../components/users/PermissionsWorkspace';
import { confirmSaved } from '../services/confirmSave';
import { countLabel } from '../shared/arabicPlural';
import { downloadCsv } from '../services/csvExport';
import {
  Users as UsersIcon,
  UserCheck,
  UserX,
  ShieldOff,
  Plus,
  Search,
  Grid,
  List,
  Mail,
  Phone,
  KeyRound,
  Trash2,
  Edit2,
  CheckCircle,
  Download,
  LogOut,
} from 'lucide-react';

interface UsersViewProps {
  currentUser: User;
  onUserSwitch?: (user: User) => void;
  /** Synchronous signal for the app-shell navigation guard. */
  onPermissionDirtyChange?: (dirty: boolean) => void;
}

export const UsersView: React.FC<UsersViewProps> = ({ currentUser, onUserSwitch, onPermissionDirtyChange }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<'DIRECTORY' | 'WORKSPACE'>('DIRECTORY');
  const permissionDirtyRef = useRef(false);
  const [viewMode, setViewModeState] = useState<'GRID' | 'TABLE'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'TABLE' ? 'TABLE' : 'GRID';
    } catch {
      return 'GRID';
    }
  });
  /** The chosen layout is remembered on this device. */
  const setViewMode = (mode: 'GRID' | 'TABLE') => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };

  // Filters
  const stations = stationsOf(ApiService.getSettings());
  const stationGroups = stationGroupsOf(ApiService.getSettings());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('ALL');
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [twoFactorFilter, setTwoFactorFilter] = useState<'ALL' | 'ON' | 'OFF'>('ALL');
  /** 'ALL', a station id, or 'NONE' (central management, or a station that was removed). */
  const [stationFilter, setStationFilter] = useState<string>('ALL');
  const [sort, toggleSort] = usePersistentSort<UserSortKey>('nrcs_sort_users', { key: 'name', dir: 'asc' }, USER_SORT_KEYS);
  const filtersActive = !!searchQuery.trim() || selectedRoleFilter !== 'ALL' || selectedDepartmentFilter !== 'ALL' || selectedStatusFilter !== 'ALL' || twoFactorFilter !== 'ALL' || stationFilter !== 'ALL';
  const clearFilters = () => {
    setSearchQuery('');
    setSelectedRoleFilter('ALL');
    setSelectedDepartmentFilter('ALL');
    setSelectedStatusFilter('ALL');
    setTwoFactorFilter('ALL');
    setStationFilter('ALL');
  };

  // Modals
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [roleToEdit, setRoleToEdit] = useState<RoleDefinition | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mirrors the server's users/roles policies so only accepted actions are offered.
  const can = (perm: string) => RbacService.hasPermission(currentUser, perm);
  const isSuper = currentUser.role === 'SUPER_ADMIN';
  const canCreate = can('users.create');
  const canSuspend = can('users.suspend_delete');
  const canEditProfile = can('users.edit_profile');
  const canManageRoles = can('users.manage_roles_permissions');
  /** Super-admin accounts are only managed by a super admin. */
  const canTouch = (u: User) => u.role !== 'SUPER_ADMIN' || isSuper;
  const denyRoles = () => {
    notify({ type: 'warning', message: 'صلاحياتك لا تسمح بإدارة الأدوار والصلاحيات' });
    return false;
  };

  const changeActiveTab = async (nextTab: 'DIRECTORY' | 'WORKSPACE') => {
    if (nextTab === activeTab) return;
    if (permissionDirtyRef.current) {
      const confirmed = await confirmDialog({
        title: 'تغييرات غير محفوظة',
        message: 'ستغادر مساحة الصلاحيات مع وجود تعديلات غير محفوظة. هل تريد تركها؟',
        confirmLabel: 'ترك التغييرات',
        cancelLabel: 'البقاء هنا',
        danger: true,
      });
      if (!confirmed) return;
      permissionDirtyRef.current = false;
      onPermissionDirtyChange?.(false);
    }
    setActiveTab(nextTab);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = () => {
    const fetchedUsers = ApiService.getUsers();
    const fetchedRoles = RbacService.getRoleDefinitions();
    setUsers(fetchedUsers);
    setRoles(fetchedRoles);
  };

  useEffect(() => {
    loadData();
    // Reflect changes made by other administrators in real time.
    return dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed' && evt.collections.some((c) => c === 'users' || c === 'roles')) loadData();
    });
  }, []);

  // --- USER ACTIONS ---
  /** Resolves true once the server accepted the account; false keeps the form open with what was typed. */
  const handleSaveUser = async (userData: Partial<User>, initialPassword?: string): Promise<boolean> => {
    try {
      const saved = ApiService.saveUser(userData);
      loadData();
      if (initialPassword) {
        // The account must exist on the server before credentials can be attached.
        const accepted = await dataStore.awaitWrite('users', saved.id);
        if (!accepted.ok) throw new Error(accepted.message || 'تعذر حفظ المستخدم على الخادم، حاول مرة أخرى');
        try {
          await authClient.setUserPassword(saved.id, initialPassword);
        } catch (err) {
          if (!userData.id) {
            // A newly created account without credentials must not remain in the roster.
            ApiService.deleteUser(saved.id);
            throw err;
          }
          loadData();
          notify({ type: 'warning', message: `حُفظت بيانات الحساب، لكن تعذر تغيير كلمة المرور: ${(err as Error).message || 'حاول مرة أخرى'}` });
          return false;
        }
      }
      const ok = await confirmSaved('users', saved.id, `تم حفظ بيانات المستخدم بنجاح: ${saved.fullName}`);
      loadData();
      return ok;
    } catch (e: any) {
      notify({ type: 'warning', message: e.message || 'تعذر حفظ المستخدم' });
      loadData();
      return false;
    }
  };

  const handleToggleStatus = (userId: string) => {
    try {
      const updated = ApiService.toggleUserStatus(userId);
      if (updated) {
        loadData();
        showToast(`تم ${updated.isActive ? 'تنشيط' : 'تجميد'} حساب ${updated.fullName}`);
      }
    } catch (e: any) {
      notify({ type: 'warning', message: e.message || 'حدث خطأ' });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;

    if ((await confirmDialog(`هل أنت متأكد من حذف حساب المستخدم: ${target.fullName}؟`))) {
      try {
        ApiService.deleteUser(userId);
        loadData();
        showToast(`تم حذف حساب ${target.fullName}`);
      } catch (e: any) {
        notify({ type: 'warning', message: e.message || 'فشل في حذف المستخدم' });
      }
    }
  };

  const handleResetTwoFactor = async (user: User) => {
    if (!(await confirmDialog(`إلغاء التحقق بخطوتين للمستخدم ${user.fullName}؟ استخدم ذلك فقط إذا فقد جهاز المصادقة.`))) return;
    try {
      await authClient.resetUserTwoFactor(user.id);
      loadData();
      showToast(`تم إلغاء التحقق بخطوتين للمستخدم ${user.fullName}`);
    } catch (e: any) {
      notify({ type: 'warning', message: e.message || 'تعذر إلغاء التحقق بخطوتين' });
    }
  };

  /** Issues a random temporary password (no look-alike characters); it must be replaced at next sign-in and expires if unused. */
  const handleResetPassword = async (user: User) => {
    if (!(await confirmDialog(`إصدار كلمة مرور مؤقتة جديدة لـ ${user.fullName}؟ تُنهى جلساته الحالية.`))) return;
    const temp = temporaryPassword(webRandom);
    try {
      await authClient.setUserPassword(user.id, temp);
      await promptDialog({ title: 'كلمة المرور المؤقتة', message: `انسخها وسلّمها إلى ${user.fullName} بشكل آمن. تصلح لأول دخول فقط ويُطلب تغييرها فوراً، وتنتهي صلاحيتها إن لم تُستخدم خلال المدة التي يحددها الخادم (72 ساعة افتراضياً).`, defaultValue: temp, copyOnly: true });
    } catch (e: any) {
      notify({ type: 'warning', message: e.message || 'تعذر إعادة تعيين كلمة المرور' });
    }
  };

  /** Signs a colleague out of every device (a lost phone, a shared computer left signed in). */
  const handleRevokeSessions = async (user: User) => {
    if (!(await confirmDialog({ title: 'إنهاء الجلسات', message: `تسجيل خروج ${user.fullName} من كل الأجهزة الآن؟ يعود للدخول بكلمة مروره.`, confirmLabel: 'إنهاء الجلسات', cancelLabel: 'تراجع', danger: true }))) return;
    try {
      await authClient.revokeUserSessions(user.id);
      showToast(`أُنهيت جلسات ${user.fullName} على كل الأجهزة`);
    } catch (e: any) {
      notify({ type: 'warning', message: e.message || 'تعذر إنهاء الجلسات' });
    }
  };

  // --- ROLE & RBAC ACTIONS ---
  /** Returns the reason when the role is refused (duplicate or empty code), for the form to show. */
  const handleSaveRole = async (roleData: RoleDefinition): Promise<string | null> => {
    if (!canManageRoles) {
      denyRoles();
      return 'صلاحياتك لا تسمح بإدارة الأدوار والصلاحيات';
    }
    try {
      RbacService.saveRole(roleData);
    } catch (e: any) {
      return e?.message || 'تعذر حفظ الدور';
    }
    loadData();
    const accepted = await dataStore.awaitWrite('roles', roleData.id);
    loadData();
    if (!accepted.ok) return accepted.message || 'تعذر حفظ الدور على الخادم';
    showToast(`تم حفظ الدور: ${roleData.nameAr}`);
    return null;
  };

  const handleDeleteRole = (roleId: string) => {
    if (!canManageRoles) {
      denyRoles();
      return;
    }
    const res = RbacService.deleteRole(roleId, ApiService.getUsers());
    if (!res.success) {
      notify({ type: 'warning', message: res.error || 'تعذر حذف الدور' });
    } else {
      setRoles(res.roles);
      showToast('تم حذف الدور المخصص بنجاح');
    }
  };

  const handleResetDefaults = async () => {
    if (!canManageRoles) {
      denyRoles();
      return;
    }
    if ((await confirmDialog('هل تريد استعادة مصفوفة الصلاحيات الافتراضية لكافة الأدوار الأساسية؟'))) {
      const reset = RbacService.resetToDefaults();
      setRoles(reset);
      showToast('تمت استعادة إعدادات الصلاحيات القياسية للمنظومة');
    }
  };

  // --- EXPORT ROSTER ---
  const handleExportRoster = () => {
    const rows = [
      ['الاسم بالعربية', 'الاسم بالإنجليزية', 'البريد الإلكتروني', 'الهاتف', 'الرقم الوظيفي', 'المسمى الوظيفي', 'القسم', 'المحطة', 'الدور', 'الحالة', 'التحقق بخطوتين', 'آخر دخول'],
      ...users.map(user => [
        user.fullName, user.fullNameEn || '', user.email, user.phone || '', user.staffId || '', user.jobTitle || '',
        departmentName(departmentIdOf(user)), user.stationId ? stationName(stations, user.stationId) : '',
        findUserRole(user, roles)?.nameAr || user.role, user.isActive ? 'نشط' : 'مجمّد',
        user.twoFactorEnabled ? 'مفعّل' : 'غير مفعّل', user.lastLogin || '',
      ]),
    ];
    downloadCsv(`newsroom_users_roster_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    showToast('تم تصدير سجل طاقم الأخبار بنجاح');
  };

  // Filtering Logic
  const filteredUsers = sortList(users.filter((u) => {
    const matchesSearch = matchesQuery(searchQuery, u.fullName, u.fullNameEn, u.email, u.staffId, u.jobTitle, u.department, departmentName(departmentIdOf(u)), u.phone, u.stationId ? stationName(stations, u.stationId) : '');

    const matchesRole = selectedRoleFilter === 'ALL' || findUserRole(u, roles)?.id === selectedRoleFilter;
    const knownStation = !!u.stationId && stations.some((st) => st.id === u.stationId);
    const group = stationFilter.startsWith('group:') ? stationGroups.find((g) => `group:${g.id}` === stationFilter) : undefined;
    const matchesStation =
      stationFilter === 'ALL' ||
      (stationFilter === 'NONE' ? !knownStation : group ? !!u.stationId && group.stationIds.includes(u.stationId) : u.stationId === stationFilter);
    const matchesDept = selectedDepartmentFilter === 'ALL' || departmentIdOf(u) === selectedDepartmentFilter;
    const matchesStatus =
      selectedStatusFilter === 'ALL'
        ? true
        : selectedStatusFilter === 'ACTIVE'
        ? u.isActive
        : !u.isActive;

    const matches2fa = twoFactorFilter === 'ALL' || (twoFactorFilter === 'ON' ? !!u.twoFactorEnabled : !u.twoFactorEnabled);
    return matchesSearch && matchesRole && matchesDept && matchesStatus && matches2fa && matchesStation;
  }), sort, (u, key) =>
    key === 'name' ? u.fullName : key === 'role' ? u.role : key === 'department' ? departmentName(departmentIdOf(u)) : key === 'status' ? (u.isActive ? 0 : 1) : u.lastLogin || ''
  );

  const departmentsList = Array.from(new Set(users.map((u) => departmentIdOf(u))));

  // KPI Metrics
  const activeCount = users.filter((u) => u.isActive).length;
  const suspendedCount = users.filter((u) => !u.isActive).length;
  const withoutTwoFactor = users.filter((u) => !u.twoFactorEnabled).length;

  return (
    <div className="space-y-6 text-right font-sans max-w-7xl mx-auto" dir="rtl">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-700 animate-slide-up">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{toastMessage}</span>
        </div>
      )}

      {/* Header & Main Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">المستخدمون والصلاحيات</h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">الحسابات والأدوار والأقسام وأمان الدخول.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleExportRoster}
            className="min-h-11 px-3.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>تصدير القائمة (CSV)</span>
          </button>

          {canCreate && (
          <button
            type="button"
            onClick={() => {
              setUserToEdit(null);
              setIsUserModalOpen(true);
            }}
            className="min-h-11 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>إضافة مستخدم جديد</span>
          </button>
          )}
        </div>
      </div>

      {/* Account summary: each count filters the directory. */}
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="ملخص الحسابات" role="group">
        {([
          { label: 'نشطة', count: activeCount, apply: () => { clearFilters(); setSelectedStatusFilter('ACTIVE'); }, on: selectedStatusFilter === 'ACTIVE', warn: false },
          { label: 'مجمّدة', count: suspendedCount, apply: () => { clearFilters(); setSelectedStatusFilter('INACTIVE'); }, on: selectedStatusFilter === 'INACTIVE', warn: false },
          { label: 'بلا تحقق بخطوتين', count: withoutTwoFactor, apply: () => { clearFilters(); setTwoFactorFilter('OFF'); }, on: twoFactorFilter === 'OFF', warn: withoutTwoFactor > 0 },
        ]).map((item) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={item.on}
            onClick={() => { void changeActiveTab('DIRECTORY').then(() => { if (activeTab !== 'WORKSPACE' || !permissionDirtyRef.current) { if (item.on) clearFilters(); else item.apply(); } }); }}
            className={`min-h-11 sm:min-h-9 px-3 rounded-lg border inline-flex items-center gap-2 font-bold transition-colors ${item.on ? 'bg-blue-50 border-blue-600 text-blue-900' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
          >
            <span className={`tabular-nums text-sm ${item.warn ? 'text-amber-800' : 'text-slate-900'}`}>{item.count}</span>
            {item.label}
          </button>
        ))}
        <span className="text-slate-500">{countLabel(users.length, { one: 'حساب واحد', two: 'حسابان', few: 'حسابات', many: 'حساباً' })}، {countLabel(roles.length, { one: 'دور واحد', two: 'دوران', few: 'أدوار', many: 'دوراً' })}</span>
      </div>

      {/* Tabs Navigation */}
      <div role="tablist" aria-label="المستخدمون والأدوار" className="flex items-center gap-1 border-b border-slate-200">
        {([
          { id: 'DIRECTORY', label: `الحسابات (${users.length})`, icon: UsersIcon },
          { id: 'WORKSPACE', label: 'مساحة الصلاحيات', icon: KeyRound },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => void changeActiveTab(t.id)}
            className={`-mb-px min-h-11 px-4 border-b-2 text-sm font-bold transition-colors flex items-center gap-2 ${
              activeTab === t.id ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <t.icon className="w-4 h-4" aria-hidden="true" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: USERS DIRECTORY */}
      {activeTab === 'DIRECTORY' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
              <div className="relative col-span-2 sm:flex-1 sm:min-w-[12rem]">
                <Search className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
                <input
                  type="search"
                  aria-label="بحث في الحسابات"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم، البريد، الرقم الوظيفي، أو المسمى..."
                  className="w-full min-h-11 sm:min-h-9 text-xs pr-9 pl-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <select
                aria-label="الدور"
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="w-full sm:w-auto min-h-11 sm:min-h-0 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كل الأدوار</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nameAr}
                  </option>
                ))}
              </select>

              <select
                aria-label="المحطة"
                value={stationFilter}
                onChange={(e) => setStationFilter(e.target.value)}
                className="w-full sm:w-auto min-h-11 sm:min-h-0 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كل المحطات</option>
                {stations.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
                {stationGroups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    مجموعة {g.name}
                  </option>
                ))}
                <option value="NONE">بلا محطة</option>
              </select>

              <select
                aria-label="القسم"
                value={selectedDepartmentFilter}
                onChange={(e) => setSelectedDepartmentFilter(e.target.value)}
                className="w-full sm:w-auto min-h-11 sm:min-h-0 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كل الأقسام</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="حالة الحساب"
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
                className="w-full sm:w-auto min-h-11 sm:min-h-0 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كل الحالات</option>
                <option value="ACTIVE">النشطة فقط</option>
                <option value="INACTIVE">المجمّدة فقط</option>
              </select>

              <select
                aria-label="التحقق بخطوتين"
                value={twoFactorFilter}
                onChange={(e) => setTwoFactorFilter(e.target.value as any)}
                className="w-full sm:w-auto min-h-11 sm:min-h-0 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">التحقق بخطوتين: الكل</option>
                <option value="ON">مفعّل</option>
                <option value="OFF">غير مفعّل</option>
              </select>

              <select
                aria-label="ترتيب المستخدمين"
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':') as [UserSortKey, 'asc' | 'desc'];
                  if (key !== sort.key) toggleSort(key, dir);
                  else if (dir !== sort.dir) toggleSort(key);
                }}
                className="w-full sm:w-auto min-h-11 sm:min-h-0 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="name:asc">الاسم (أ-ي)</option>
                <option value="name:desc">الاسم (ي-أ)</option>
                <option value="department:asc">القسم</option>
                <option value="role:asc">الدور</option>
                <option value="status:asc">النشطون أولاً</option>
                <option value="lastLogin:desc">آخر دخول (الأحدث)</option>
              </select>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg" role="group" aria-label="طريقة العرض">
              {([['GRID', 'عرض بطاقات', Grid], ['TABLE', 'عرض جدول', List]] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  aria-label={label}
                  title={label}
                  className={`min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center rounded-md transition-colors ${
                    viewMode === mode ? 'bg-white shadow-xs text-blue-700' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {/* Results Info */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              <strong className="text-slate-800 tabular-nums">{filteredUsers.length}</strong> من {users.length}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-blue-600 hover:underline font-bold"
              >
                إعادة ضبط الفلاتر
              </button>
            )}
          </div>

          {/* GRID VIEW */}
          {viewMode === 'GRID' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredUsers.map((user) => {
                const roleBadge = RbacService.getRoleBadge(user.customRoleId || user.role);
                const isCurrentActive = currentUser.id === user.id;

                return (
                  <div
                    key={user.id}
                    className={`bg-white rounded-xl border transition-colors flex flex-col justify-between overflow-hidden ${
                      isCurrentActive
                        ? 'border-blue-500 ring-2 ring-blue-400/50'
                        : !user.isActive
                        ? 'border-rose-200 bg-rose-50/20'
                        : 'border-slate-200/80'
                    }`}
                  >
                    <div className="p-4 space-y-3.5">
                      {/* Top bar with role & status */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-2xs font-bold px-2.5 py-1 rounded-full border ${roleBadge.badgeBg}`}>
                          {roleBadge.labelAr}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {isCurrentActive && (
                            <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">
                              حسابك النشط
                            </span>
                          )}
                          {!user.isActive && (
                            <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">مجمّد</span>
                          )}
                        </div>
                      </div>

                      {/* User Profile Info */}
                      <div className="flex items-start gap-3">
                        <Avatar src={user.avatarUrl} name={user.fullName} className="w-14 h-14 rounded-2xl border-2 border-slate-100 shadow-xs shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 truncate">{user.fullName}</h3>
                          {user.fullNameEn && (
                            <p className="text-2xs text-slate-500 font-sans truncate" dir="ltr">
                              {user.fullNameEn}
                            </p>
                          )}
                          <p className="text-xs font-bold text-slate-700 mt-0.5 truncate">{user.jobTitle}</p>
                          <p className="text-2xs text-slate-500 truncate">{departmentName(departmentIdOf(user))}{user.stationId ? ` — ${stationName(stations, user.stationId)}` : ''}</p>
                          <p className="text-2xs text-slate-500 truncate">
                            آخر دخول: {user.lastLogin ? new Date(user.lastLogin).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'لم يدخل بعد'}
                          </p>
                        </div>
                      </div>

                      {/* Bio excerpt */}
                      {user.bio && (
                        <p className="text-2xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 line-clamp-2 leading-relaxed">
                          {user.bio}
                        </p>
                      )}

                      {/* Contact Info */}
                      <div className="space-y-1 text-2xs text-slate-500 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-2 truncate">
                          <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate font-mono" dir="ltr">
                            {user.email}
                          </span>
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-2 truncate">
                            <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="font-mono" dir="ltr">
                              {user.phone}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="p-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2">
                      {canCreate && canTouch(user) && (
                      <button
                        type="button"
                        onClick={() => handleResetPassword(user)}
                        disabled={isCurrentActive}
                        title={isCurrentActive ? undefined : 'إصدار كلمة مرور مؤقتة'}
                        className={`min-h-11 sm:min-h-9 text-xs font-bold px-3 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                          isCurrentActive
                            ? 'bg-blue-100 text-blue-700 cursor-default'
                            : 'bg-white hover:border-blue-300 hover:text-blue-800 text-slate-700 border border-slate-200'
                        }`}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>{isCurrentActive ? 'الحساب الحالي' : 'كلمة مرور مؤقتة'}</span>
                      </button>
                      )}

                      <div className="flex items-center gap-1">
                        {!isCurrentActive && canSuspend && canTouch(user) && (
                          <button
                            type="button"
                            onClick={() => void handleRevokeSessions(user)}
                            className={`${ICON_BTN} text-slate-600 hover:text-rose-700 hover:bg-rose-50`}
                            title="إنهاء الجلسات على كل الأجهزة (جهاز مفقود أو حاسوب مشترك)"
                            aria-label={`إنهاء جلسات ${user.fullName}`}
                          >
                            <LogOut className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {user.twoFactorEnabled && !isCurrentActive && canSuspend && canTouch(user) && (
                          <button
                            type="button"
                            onClick={() => handleResetTwoFactor(user)}
                            className={`${ICON_BTN} text-slate-600 hover:text-blue-700 hover:bg-blue-50`}
                            title="إلغاء التحقق بخطوتين (فقدان جهاز المصادقة)"
                            aria-label={`إلغاء التحقق بخطوتين لـ${user.fullName}`}
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(canEditProfile || canManageRoles) && canTouch(user) && (
                        <button
                          type="button"
                          onClick={() => {
                            setUserToEdit(user);
                            setIsUserModalOpen(true);
                          }}
                          className={`${ICON_BTN} text-slate-600 hover:text-blue-700 hover:bg-blue-50`}
                          title="تعديل المستخدم"
                          aria-label={`تعديل ${user.fullName}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        )}

                        {canSuspend && canTouch(user) && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id)}
                          disabled={isCurrentActive}
                          className={`${ICON_BTN} ${
                            user.isActive
                              ? 'text-slate-600 hover:text-amber-800 hover:bg-amber-50'
                              : 'text-emerald-700 hover:bg-emerald-50 border-emerald-200'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                          title={user.isActive ? 'تجميد الحساب' : 'تنشيط الحساب'}
                          aria-label={`${user.isActive ? 'تجميد حساب' : 'تنشيط حساب'} ${user.fullName}`}
                        >
                          {user.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                        )}

                        {canSuspend && canTouch(user) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user.id)}
                          disabled={isCurrentActive}
                          className={`${ICON_BTN} text-slate-600 hover:text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed`}
                          title="حذف الحساب"
                          aria-label={`حذف حساب ${user.fullName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* TABLE VIEW */
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-2xs font-bold text-slate-500 border-b border-slate-200">
                      <SortTh className="p-3.5" label="المستخدم والبيانات" sortKey="name" sort={sort} onSort={toggleSort} />
                      <SortTh className="p-3.5" label="الدور والصلاحية" sortKey="role" sort={sort} onSort={toggleSort} />
                      <SortTh className="p-3.5" label="القسم" sortKey="department" sort={sort} onSort={toggleSort} />
                      <SortTh className="p-3.5 text-center" label="الحالة" sortKey="status" sort={sort} onSort={toggleSort} />
                      <th className="p-3.5 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredUsers.map((user) => {
                      const roleBadge = RbacService.getRoleBadge(user.customRoleId || user.role);
                      const isCurrent = currentUser.id === user.id;

                      return (
                        <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <Avatar src={user.avatarUrl} name={user.fullName} className="w-9 h-9 rounded-xl border border-slate-200" />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900">{user.fullName}</span>
                                  {isCurrent && (
                                    <span className="text-2xs bg-blue-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                                      أنت
                                    </span>
                                  )}
                                </div>
                                <span className="text-2xs text-slate-500 font-mono" dir="ltr">
                                  {user.email}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="p-3">
                            <span className={`text-2xs font-bold px-2 py-0.5 rounded-md border ${roleBadge.badgeBg}`}>
                              {roleBadge.labelAr}
                            </span>
                          </td>

                          <td className="p-3 font-medium text-slate-700">{departmentName(departmentIdOf(user))}{user.stationId ? <span className="block text-2xs font-normal text-slate-500">{stationName(stations, user.stationId)}</span> : null}</td>

                          <td className="p-3 text-center">
                            <span
                              className={`text-2xs font-bold px-2 py-0.5 rounded-full ${
                                user.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {user.isActive ? 'نشط' : 'مجمّد'}
                            </span>
                          </td>

                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {canCreate && canTouch(user) && (
                              <button
                                type="button"
                                onClick={() => handleResetPassword(user)}
                                disabled={isCurrent}
                                className="min-h-11 sm:min-h-9 px-2.5 bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-800 rounded-lg text-2xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title="إصدار كلمة مرور مؤقتة"
                              >
                                كلمة مرور مؤقتة
                              </button>
                              )}
                              {!isCurrent && canSuspend && canTouch(user) && (
                                <button type="button" onClick={() => void handleRevokeSessions(user)} className={`${ICON_BTN} text-slate-600 hover:text-rose-700 hover:bg-rose-50`} title="إنهاء الجلسات على كل الأجهزة" aria-label={`إنهاء جلسات ${user.fullName}`}>
                                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                              {user.twoFactorEnabled && !isCurrent && canSuspend && canTouch(user) && (
                                <button type="button" onClick={() => void handleResetTwoFactor(user)} className={`${ICON_BTN} text-slate-600 hover:text-blue-700 hover:bg-blue-50`} title="إلغاء التحقق بخطوتين" aria-label={`إلغاء التحقق بخطوتين لـ${user.fullName}`}>
                                  <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                              {canSuspend && canTouch(user) && (
                                <button type="button" onClick={() => handleToggleStatus(user.id)} disabled={isCurrent} className={`${ICON_BTN} ${user.isActive ? 'text-slate-600 hover:text-amber-800 hover:bg-amber-50' : 'text-emerald-700 hover:bg-emerald-50 border-emerald-200'} disabled:opacity-40 disabled:cursor-not-allowed`} title={user.isActive ? 'تجميد الحساب' : 'تنشيط الحساب'} aria-label={`${user.isActive ? 'تجميد حساب' : 'تنشيط حساب'} ${user.fullName}`}>
                                  {user.isActive ? <UserX className="w-3.5 h-3.5" aria-hidden="true" /> : <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />}
                                </button>
                              )}
                              {canSuspend && canTouch(user) && (
                                <button type="button" onClick={() => void handleDeleteUser(user.id)} disabled={isCurrent} className={`${ICON_BTN} text-slate-600 hover:text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed`} title="حذف الحساب" aria-label={`حذف حساب ${user.fullName}`}>
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                              {(canEditProfile || canManageRoles) && canTouch(user) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setUserToEdit(user);
                                  setIsUserModalOpen(true);
                                }}
                                className={`${ICON_BTN} text-slate-600 hover:text-blue-700 hover:bg-blue-50`}
                                title="تعديل المستخدم"
                                aria-label={`تعديل ${user.fullName}`}
                              >
                                <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'WORKSPACE' && (
        <PermissionsWorkspace
          currentUser={currentUser}
          canManage={canManageRoles}
          onDirtyChange={(dirty) => {
            permissionDirtyRef.current = dirty;
            onPermissionDirtyChange?.(dirty);
          }}
          onAddNewRole={() => {
            setRoleToEdit(null);
            setIsRoleModalOpen(true);
          }}
          onEditRole={(role) => {
            setRoleToEdit(role);
            setIsRoleModalOpen(true);
          }}
          onDeleteRole={handleDeleteRole}
          onResetDefaults={handleResetDefaults}
        />
      )}

      {/* MODALS */}
      <UserFormModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        onSave={handleSaveUser}
        userToEdit={userToEdit}
        roles={isSuper ? roles : roles.filter((r) => r.roleCode !== 'SUPER_ADMIN')}
        canManageOverrides={canManageRoles && userToEdit?.id !== currentUser.id}
        canSetPassword={canCreate}
      />

      <RoleEditModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        onSave={handleSaveRole}
        roleToEdit={roleToEdit}
      />
    </div>
  );
};
