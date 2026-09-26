import { Avatar } from '../components/common/Avatar';
import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { DEPARTMENTS, departmentIdOf, departmentName } from '../shared/departments';
import { ApiService } from '../services/api';
import { authClient } from '../services/authClient';
import { dataStore } from '../services/dataStore';
import {
  RbacService,
  RoleDefinition,
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
} from '../services/rbacService';
import { UserFormModal } from '../components/users/UserFormModal';
import { RoleEditModal } from '../components/users/RoleEditModal';
import { PermissionsMatrixTable } from '../components/users/PermissionsMatrixTable';
import {
  Users as UsersIcon,
  UserCheck,
  UserX,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Plus,
  Search,
  Filter,
  Grid,
  List,
  Mail,
  Phone,
  Clock,
  KeyRound,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  RotateCcw,
  Download,
  Upload,
  UserCog,
  Radio,
  Briefcase,
  Building,
  Check,
  Calendar,
} from 'lucide-react';

interface UsersViewProps {
  currentUser: User;
  onUserSwitch?: (user: User) => void;
}

export const UsersView: React.FC<UsersViewProps> = ({ currentUser, onUserSwitch }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<'DIRECTORY' | 'MATRIX'>('DIRECTORY');
  const [viewMode, setViewMode] = useState<'GRID' | 'TABLE'>('GRID');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('ALL');
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

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
    alert('صلاحياتك لا تسمح بإدارة الأدوار والصلاحيات');
    return false;
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
  const handleSaveUser = async (userData: Partial<User>, initialPassword?: string) => {
    try {
      const saved = ApiService.saveUser(userData);
      loadData();
      if (initialPassword) {
        // The account must exist on the server before credentials can be attached.
        const synced = await ApiService.flushSync();
        if (!synced) throw new Error('تعذر حفظ المستخدم على الخادم، حاول مرة أخرى');
        await authClient.setUserPassword(saved.id, initialPassword);
      }
      showToast(`تم حفظ بيانات المستخدم بنجاح: ${saved.fullName}`);
    } catch (e: any) {
      alert(e.message || 'تعذر حفظ المستخدم');
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
      alert(e.message || 'حدث خطأ');
    }
  };

  const handleDeleteUser = (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;

    if (window.confirm(`هل أنت متأكد من حذف حساب المستخدم: ${target.fullName}؟`)) {
      try {
        ApiService.deleteUser(userId);
        loadData();
        showToast(`تم حذف حساب ${target.fullName}`);
      } catch (e: any) {
        alert(e.message || 'فشل في حذف المستخدم');
      }
    }
  };

  const handleResetTwoFactor = async (user: User) => {
    if (!window.confirm(`إلغاء التحقق بخطوتين للمستخدم ${user.fullName}؟ استخدم ذلك فقط إذا فقد جهاز المصادقة.`)) return;
    try {
      await authClient.resetUserTwoFactor(user.id);
      showToast(`تم إلغاء التحقق بخطوتين للمستخدم ${user.fullName}`);
    } catch (e: any) {
      alert(e.message || 'تعذر إلغاء التحقق بخطوتين');
    }
  };

  /** Issues a random temporary password; the user must replace it at next sign-in. */
  const handleResetPassword = async (user: User) => {
    if (!window.confirm(`إصدار كلمة مرور مؤقتة جديدة للمستخدم ${user.fullName}؟ سيتم إنهاء جلساته الحالية.`)) return;
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    const temp = `${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')}7a`;
    try {
      await authClient.setUserPassword(user.id, temp);
      window.prompt('كلمة المرور المؤقتة (انسخها وسلّمها للمستخدم بشكل آمن):', temp);
    } catch (e: any) {
      alert(e.message || 'تعذر إعادة تعيين كلمة المرور');
    }
  };

  // --- ROLE & RBAC ACTIONS ---
  const handleSaveRole = (roleData: RoleDefinition) => {
    if (!canManageRoles) {
      denyRoles();
      return;
    }
    RbacService.saveRole(roleData);
    loadData();
    showToast(`تم تحديث إعدادات الدور: ${roleData.nameAr}`);
  };

  const handleDeleteRole = (roleId: string) => {
    if (!canManageRoles) {
      denyRoles();
      return;
    }
    const res = RbacService.deleteRole(roleId);
    if (!res.success) {
      alert(res.error || 'تعذر حذف الدور');
    } else {
      setRoles(res.roles);
      showToast('تم حذف الدور المخصص بنجاح');
    }
  };

  const handleUpdateRolePermissions = (roleId: string, permCode: string, isEnabled: boolean) => {
    if (!canManageRoles) {
      denyRoles();
      return;
    }
    const targetRole = roles.find((r) => r.id === roleId);
    if (!targetRole) return;

    let updatedPerms = [...targetRole.permissions];
    if (isEnabled) {
      if (!updatedPerms.includes(permCode)) updatedPerms.push(permCode);
    } else {
      updatedPerms = updatedPerms.filter((p) => p !== permCode);
    }

    const updatedRole = { ...targetRole, permissions: updatedPerms };
    RbacService.saveRole(updatedRole);
    loadData();
  };

  const handleResetDefaults = () => {
    if (!canManageRoles) {
      denyRoles();
      return;
    }
    if (window.confirm('هل تريد استعادة مصفوفة الصلاحيات الافتراضية لكافة الأدوار الأساسية؟')) {
      const reset = RbacService.resetToDefaults();
      setRoles(reset);
      showToast('تمت استعادة إعدادات الصلاحيات القياسية للمنظومة');
    }
  };

  // --- EXPORT ROSTER ---
  const handleExportRoster = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(users, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `newsroom_users_roster_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('تم تصدير سجل طاقم الأخبار بنجاح');
  };

  // Filtering Logic
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.fullName.includes(searchQuery) ||
      (u.fullNameEn && u.fullNameEn.toLowerCase().includes(searchQuery.toLowerCase())) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.staffId && u.staffId.toLowerCase().includes(searchQuery.toLowerCase())) ||
      u.jobTitle.includes(searchQuery) ||
      u.department.includes(searchQuery);

    const matchesRole = selectedRoleFilter === 'ALL' || u.role === selectedRoleFilter;
    const matchesDept = selectedDepartmentFilter === 'ALL' || departmentIdOf(u) === selectedDepartmentFilter;
    const matchesStatus =
      selectedStatusFilter === 'ALL'
        ? true
        : selectedStatusFilter === 'ACTIVE'
        ? u.isActive
        : !u.isActive;

    return matchesSearch && matchesRole && matchesDept && matchesStatus;
  });

  const departmentsList = Array.from(new Set(users.map((u) => departmentIdOf(u))));

  // KPI Metrics
  const activeCount = users.filter((u) => u.isActive).length;
  const suspendedCount = users.filter((u) => !u.isActive).length;
  const twoFactorRate = Math.round((users.filter((u) => u.twoFactorEnabled).length / (users.length || 1)) * 100);

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <UserCog className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                إدارة المستخدمين والصلاحيات التحريرية (RBAC)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                التحكم في طاقم الأخبار، تعيين مصفوفة الأذونات، إدارة المناوبات التلفزيونية، وتدقيق الأمان
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleExportRoster}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-2xl transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>تصدير السجل</span>
          </button>

          {canCreate && (
          <button
            type="button"
            onClick={() => {
              setUserToEdit(null);
              setIsUserModalOpen(true);
            }}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-2xl shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مستخدم جديد</span>
          </button>
          )}
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">إجمالي طاقم الشبكة</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{users.length} موظف</div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">{departmentsList.length} أقسام تخصصية</span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <UsersIcon className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">الحسابات النشطة</span>
            <div className="text-2xl font-black text-emerald-600 mt-1">{activeCount} مفعل</div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">{suspendedCount} حساب مجمد</span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">مصفوفة الصلاحيات (RBAC)</span>
            <div className="text-2xl font-black text-purple-600 mt-1">{ALL_PERMISSIONS.length} إذن</div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">{roles.length} أدوار معرفة</span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500">التأمين والمصادقة (2FA)</span>
            <div className="text-2xl font-black text-indigo-600 mt-1">{twoFactorRate}%</div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">معايير الأمان الإخباري</span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('DIRECTORY')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'DIRECTORY'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          <UsersIcon className="w-4 h-4" />
          <span>دليل الموظفين والمستخدمين ({users.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('MATRIX')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'MATRIX'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>مصفوفة الصلاحيات والأدوار (Permissions Matrix)</span>
        </button>

        

        
      </div>

      {/* TAB 1: USERS DIRECTORY */}
      {activeTab === 'DIRECTORY' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-[260px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم، البريد، الرقم الوظيفي، أو المسمى..."
                  className="w-full text-xs pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
                />
              </div>

              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كافة الأدوار التحريرية</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.roleCode}>
                    {r.nameAr}
                  </option>
                ))}
              </select>

              <select
                value={selectedDepartmentFilter}
                onChange={(e) => setSelectedDepartmentFilter(e.target.value)}
                className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كافة الأقسام</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
                className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="ALL">كافة الحالات</option>
                <option value="ACTIVE">نشط ومصرح فقط</option>
                <option value="INACTIVE">مجمد وموقوف فقط</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('GRID')}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'GRID' ? 'bg-white shadow-xs text-blue-600' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="عرض بطاقات"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TABLE')}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'TABLE' ? 'bg-white shadow-xs text-blue-600' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="عرض جدول"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Results Info */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              عرض <strong className="text-slate-800">{filteredUsers.length}</strong> من إجمالي {users.length} مستخدم
            </span>
            {(searchQuery || selectedRoleFilter !== 'ALL' || selectedDepartmentFilter !== 'ALL' || selectedStatusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedRoleFilter('ALL');
                  setSelectedDepartmentFilter('ALL');
                  setSelectedStatusFilter('ALL');
                }}
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
                const roleBadge = RbacService.getRoleBadge(user.role);
                const isCurrentActive = currentUser.id === user.id;

                return (
                  <div
                    key={user.id}
                    className={`bg-white rounded-2xl border transition-all shadow-xs hover:shadow-md flex flex-col justify-between overflow-hidden ${
                      isCurrentActive
                        ? 'border-blue-500 ring-2 ring-blue-400/50'
                        : !user.isActive
                        ? 'border-red-200 bg-red-50/20 opacity-80'
                        : 'border-slate-200/80'
                    }`}
                  >
                    <div className="p-4 space-y-3.5">
                      {/* Top bar with role & status */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${roleBadge.badgeBg}`}>
                          {roleBadge.labelAr}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {isCurrentActive && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white animate-pulse">
                              حسابك النشط
                            </span>
                          )}
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              user.isActive ? 'bg-emerald-500' : 'bg-red-500'
                            }`}
                            title={user.isActive ? 'نشط' : 'مجمد'}
                          />
                        </div>
                      </div>

                      {/* User Profile Info */}
                      <div className="flex items-start gap-3">
                        <Avatar src={user.avatarUrl} name={user.fullName} className="w-14 h-14 rounded-2xl border-2 border-slate-100 shadow-xs shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-black text-slate-900 truncate">{user.fullName}</h3>
                          {user.fullNameEn && (
                            <p className="text-[11px] text-slate-400 font-sans truncate" dir="ltr">
                              {user.fullNameEn}
                            </p>
                          )}
                          <p className="text-xs font-bold text-slate-700 mt-0.5 truncate">{user.jobTitle}</p>
                          <p className="text-[11px] text-slate-500 truncate">{departmentName(departmentIdOf(user))}</p>
                        </div>
                      </div>

                      {/* Bio excerpt */}
                      {user.bio && (
                        <p className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 line-clamp-2 leading-relaxed">
                          {user.bio}
                        </p>
                      )}

                      {/* Contact Info */}
                      <div className="space-y-1 text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-2 truncate">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate font-mono" dir="ltr">
                            {user.email}
                          </span>
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-2 truncate">
                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                          isCurrentActive
                            ? 'bg-blue-100 text-blue-700 cursor-default'
                            : 'bg-white hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-200 shadow-2xs'
                        }`}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>{isCurrentActive ? 'الحساب الحالي' : 'كلمة مرور مؤقتة'}</span>
                      </button>
                      )}

                      <div className="flex items-center gap-1">
                        {user.twoFactorEnabled && !isCurrentActive && canSuspend && canTouch(user) && (
                          <button
                            type="button"
                            onClick={() => handleResetTwoFactor(user)}
                            className="p-1.5 bg-white hover:bg-indigo-100 text-indigo-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                            title="إلغاء التحقق بخطوتين (فقدان جهاز المصادقة)"
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
                          className="p-1.5 bg-white hover:bg-slate-200 text-slate-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                          title="تعديل المستخدم"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        )}

                        {canSuspend && canTouch(user) && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(user.id)}
                          disabled={isCurrentActive}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                            user.isActive
                              ? 'bg-white hover:bg-amber-100 text-amber-600 border-slate-200'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                          title={user.isActive ? 'تجميد الحساب' : 'تنشيط الحساب'}
                        >
                          {user.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                        )}

                        {canSuspend && canTouch(user) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user.id)}
                          disabled={isCurrentActive}
                          className="p-1.5 bg-white hover:bg-red-100 text-red-600 rounded-lg border border-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="حذف الحساب"
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
                    <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 border-b border-slate-200">
                      <th className="p-3.5">المستخدم والبيانات</th>
                      <th className="p-3.5">الدور والصلاحية</th>
                      <th className="p-3.5">القسم</th>
                      <th className="p-3.5 text-center">الحالة</th>
                      <th className="p-3.5 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredUsers.map((user) => {
                      const roleBadge = RbacService.getRoleBadge(user.role);
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
                                    <span className="text-[9px] bg-blue-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                                      أنت
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-slate-500 font-mono" dir="ltr">
                                  {user.email}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="p-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${roleBadge.badgeBg}`}>
                              {roleBadge.labelAr}
                            </span>
                          </td>

                          <td className="p-3 font-medium text-slate-700">{departmentName(departmentIdOf(user))}</td>

                          <td className="p-3 text-center">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                user.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {user.isActive ? 'نشط' : 'مجمد'}
                            </span>
                          </td>

                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {canCreate && canTouch(user) && (
                              <button
                                type="button"
                                onClick={() => handleResetPassword(user)}
                                disabled={isCurrent}
                                className="px-2 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-lg text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                title="إصدار كلمة مرور مؤقتة"
                              >
                                كلمة مرور
                              </button>
                              )}
                              {(canEditProfile || canManageRoles) && canTouch(user) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setUserToEdit(user);
                                  setIsUserModalOpen(true);
                                }}
                                className="p-1 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
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

      {/* TAB 2: RBAC MATRIX */}
      {activeTab === 'MATRIX' && (
        <PermissionsMatrixTable
          roles={roles}
          onUpdateRolePermissions={handleUpdateRolePermissions}
          onEditRole={(role) => {
            setRoleToEdit(role);
            setIsRoleModalOpen(true);
          }}
          onDeleteRole={handleDeleteRole}
          onAddNewRole={() => {
            setRoleToEdit(null);
            setIsRoleModalOpen(true);
          }}
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
