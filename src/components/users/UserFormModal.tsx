import { FormPage } from '../common/FormPage';
import { countLabel } from '../../shared/arabicPlural';
import { Avatar } from '../common/Avatar';
import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../../types';
import { DEPARTMENTS, allDepartments, departmentIdOf, departmentName, departmentsAtStation } from '../../shared/departments';
import { validatePasswordStrength } from '../../shared/passwords';
import { stationGroupsOf } from '../../shared/stations';
import { RoleDefinition } from '../../services/rbacService';
import { evaluatePermission } from '../../shared/rbac';
import { canOpenScreen, SCREEN_GROUPS, screenLabel } from '../../shared/screens';
import { apiService } from '../../services/api';
import { stationsOf } from '../../shared/stations';
import { PermissionOverridesSection } from './PermissionOverridesSection';
import { sameOverrides } from '../../services/permissionOverrides';
import { User as UserIcon, Mail, Phone, Shield, Briefcase, Building, MapPin, KeyRound, Check } from 'lucide-react';

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves false when the save failed: the form then stays open with everything typed (undefined counts as saved). */
  onSave: (userData: Partial<User>, initialPassword?: string) => void | boolean | Promise<boolean>;
  userToEdit?: User | null;
  roles: RoleDefinition[];
  /** Show the per-user permission exceptions (needs users.manage_roles_permissions, and not on one's own account). */
  canManageOverrides?: boolean;
}




export const UserFormModal: React.FC<UserFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  userToEdit,
  roles,
  canManageOverrides = false,
}) => {
  const [fullName, setFullName] = useState('');
  const [fullNameEn, setFullNameEn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  /** Id of the chosen role definition (system or custom): custom roles reach the user through customRoleId. */
  const [roleId, setRoleId] = useState('');
  const [managedStationIds, setManagedStationIds] = useState<string[]>([]);
  const [managedGroupIds, setManagedGroupIds] = useState<string[]>([]);
  const [jobTitle, setJobTitle] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('newsroom');
  const [stationId, setStationId] = useState('');
  const stations = stationsOf(apiService.getSettings());
  const stationGroups = stationGroupsOf(apiService.getSettings());
  /** The role a record holds: its custom role, else its system role (also a legacy custom code written into `role`). */
  const roleIdOf = (u?: Pick<User, 'role' | 'customRoleId'> | null) =>
    (u?.customRoleId && roles.find((r) => r.id === u.customRoleId)?.id) || roles.find((r) => r.roleCode === (u?.role || 'JOURNALIST'))?.id || roles[0]?.id || '';
  const [staffId, setStaffId] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('/avatar.svg');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [initialPassword, setInitialPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customPermissions, setCustomPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userToEdit) {
      setFullName(userToEdit.fullName || '');
      setFullNameEn(userToEdit.fullNameEn || '');
      setEmail(userToEdit.email || '');
      setPhone(userToEdit.phone || '');
      setRoleId(roleIdOf(userToEdit));
      setManagedStationIds(userToEdit.managedStationIds || []);
      setManagedGroupIds(userToEdit.managedGroupIds || []);
      setJobTitle(userToEdit.jobTitle || '');
      setDepartmentId(departmentIdOf(userToEdit));
      setStationId(userToEdit.stationId || '');
      setStaffId(userToEdit.staffId || '');
      setBio(userToEdit.bio || '');
      setAvatarUrl(userToEdit.avatarUrl || '/avatar.svg');
      setTwoFactorEnabled(userToEdit.twoFactorEnabled ?? false);
      setIsActive(userToEdit.isActive !== undefined ? userToEdit.isActive : true);
    } else {
      setFullName('');
      setFullNameEn('');
      setEmail('');
      setPhone('');
      setRoleId(roleIdOf(null));
      setManagedStationIds([]);
      setManagedGroupIds([]);
      setJobTitle('');
      setDepartmentId('newsroom');
      setStationId('');
      setStaffId('');
      setBio('');
      setAvatarUrl('/avatar.svg');
      setTwoFactorEnabled(false);
      setIsActive(true);
    }
    setCustomPermissions(userToEdit?.customPermissions || []);
    setInitialPassword('');
    setErrors({});
  }, [userToEdit, isOpen]);

  const selectedRole = roles.find((r) => r.id === roleId);
  const role: UserRole = (selectedRole?.isSystemRole ? selectedRole.roleCode : userToEdit && roles.some((r) => r.isSystemRole && r.roleCode === userToEdit.role) ? userToEdit.role : 'VIEWER') as UserRole;
  const customRoleId = selectedRole && !selectedRole.isSystemRole ? selectedRole.id : undefined;
  const isGeneralManager = selectedRole?.roleCode === 'GENERAL_MANAGER';
  /** Departments open at the chosen station (an archived department the colleague is still in stays listed). */
  const departmentOptions = [
    ...departmentsAtStation(stationId || undefined, DEPARTMENTS),
    ...allDepartments().filter((d) => d.id === departmentId && (d.archived || !departmentsAtStation(stationId || undefined, DEPARTMENTS).some((x) => x.id === d.id))),
  ];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) newErrors.fullName = 'الاسم الكامل بالعربية مطلوب';
    if (!email.trim()) {
      newErrors.email = 'البريد الإلكتروني مطلوب';
    } else if (!/^\S+@\S+\.\S+$/.test(email)) {
      newErrors.email = 'صيغة البريد الإلكتروني غير صحيحة';
    }
    if (!jobTitle.trim()) newErrors.jobTitle = 'المسمى الوظيفي مطلوب';
    if (!userToEdit) {
      // The same rule the server applies, checked before the account is created (no account without a password).
      const weak = validatePasswordStrength(initialPassword);
      if (weak) newErrors.initialPassword = `كلمة المرور الأولية: ${weak}`;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Exceptions are sent only when they changed, so a profile edit never touches privileged fields.
    const overridesChanged = canManageOverrides && !sameOverrides(customPermissions, userToEdit?.customPermissions);
    setSaving(true);
    let saved: void | boolean;
    try {
    saved = await onSave({
      id: userToEdit?.id,
      fullName: fullName.trim(),
      fullNameEn: fullNameEn.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role,
      customRoleId,
      jobTitle: jobTitle.trim(),
      departmentId,
      department: departmentName(departmentId),
      stationId: stationId || undefined,
      staffId: staffId.trim(),
      bio: bio.trim(),
      avatarUrl,
      isActive,
      ...(overridesChanged ? { customPermissions } : {}),
      // A general manager's stations and groups are privileged: only sent by someone allowed to change them.
      ...(canManageOverrides && (isGeneralManager || userToEdit?.managedStationIds?.length || userToEdit?.managedGroupIds?.length)
        ? { managedStationIds: isGeneralManager ? managedStationIds : [], managedGroupIds: isGeneralManager ? managedGroupIds : [] }
        : {}),
    }, userToEdit ? undefined : initialPassword);
    } catch {
      saved = false;
    } finally {
      setSaving(false);
    }
    if (saved !== false) onClose();
  };

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={userToEdit ? `تعديل حساب ${userToEdit.fullName}` : 'إضافة مستخدم جديد'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-right font-sans" dir="rtl">
        {/* Basic Info Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="user-form-modal-field-2" className="block text-xs font-bold text-slate-700 mb-1.5">
              الاسم الكامل (بالعربية) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input id="user-form-modal-field-2"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: '' }));
                }}
                data-autofocus
                placeholder="مثال: أحمد المنصوري"
                className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none ${
                  errors.fullName ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                }`}
              />
            </div>
            {errors.fullName && <p className="text-2xs text-red-600 mt-1 font-bold">{errors.fullName}</p>}
          </div>

          <div>
            <label htmlFor="user-form-modal-field-3" className="block text-xs font-bold text-slate-700 mb-1.5">
              الاسم بالإنجليزية
            </label>
            <input id="user-form-modal-field-3"
              type="text"
              value={fullNameEn}
              onChange={(e) => setFullNameEn(e.target.value)}
              placeholder="e.g. Ahmed Al-Mansouri"
              className="w-full text-xs px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left font-sans"
              dir="ltr"
            />
          </div>

          <div>
            <label htmlFor="user-form-modal-field-4" className="block text-xs font-bold text-slate-700 mb-1.5">
              البريد الإلكتروني المهني <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input id="user-form-modal-field-4"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
                }}
                placeholder="user@akhbar.tv"
                className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none text-left ${
                  errors.email ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                }`}
                dir="ltr"
              />
            </div>
            {errors.email && <p className="text-2xs text-red-600 mt-1 font-bold">{errors.email}</p>}
          </div>

          {!userToEdit && (
            <div>
              <label htmlFor="user-form-modal-field-5" className="block text-xs font-bold text-slate-700 mb-1.5">
                كلمة المرور الأولية <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
                <input id="user-form-modal-field-5"
                  type="password"
                  autoComplete="new-password"
                  value={initialPassword}
                  onChange={(e) => {
                    setInitialPassword(e.target.value);
                    if (errors.initialPassword) setErrors((prev) => ({ ...prev, initialPassword: '' }));
                  }}
                  className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none text-left ${
                    errors.initialPassword ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                  }`}
                  dir="ltr"
                />
              </div>
              <p className="text-2xs text-slate-500 mt-1">10 أحرف على الأقل بحروف وأرقام؛ يُطلب تغييرها عند أول تسجيل دخول.</p>
              {errors.initialPassword && <p className="text-2xs text-red-600 mt-1 font-bold">{errors.initialPassword}</p>}
            </div>
          )}

          <div>
            <label htmlFor="user-form-modal-field-6" className="block text-xs font-bold text-slate-700 mb-1.5">
              رقم الهاتف المباشر / الاتصال
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input id="user-form-modal-field-6"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+966 50 000 0000"
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left font-mono"
                dir="ltr"
              />
            </div>
          </div>
        </div>

        {/* Professional & Security Parameters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="user-form-modal-field-7" className="block text-xs font-bold text-slate-700 mb-1.5">
              الدور والصلاحية <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Shield className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <select id="user-form-modal-field-7"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-bold text-slate-800"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nameAr}{r.isSystemRole ? '' : ' (دور مخصص)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="user-form-modal-field-8" className="block text-xs font-bold text-slate-700 mb-1.5">
              المسمى الوظيفي <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Briefcase className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <input id="user-form-modal-field-8"
                type="text"
                value={jobTitle}
                onChange={(e) => {
                  setJobTitle(e.target.value);
                  if (errors.jobTitle) setErrors((prev) => ({ ...prev, jobTitle: '' }));
                }}
                placeholder="مثال: رئيس تحرير نشرة التاسعة"
                className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none ${
                  errors.jobTitle ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                }`}
              />
            </div>
            {errors.jobTitle && <p className="text-2xs text-red-600 mt-1 font-bold">{errors.jobTitle}</p>}
          </div>

          <div>
            <label htmlFor="user-form-modal-field-9" className="block text-xs font-bold text-slate-700 mb-1.5">
              القسم
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <select id="user-form-modal-field-9"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
              >
                {departmentOptions.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {departmentName(dept.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="user-form-modal-station" className="block text-xs font-bold text-slate-700 mb-1.5">
              المحطة
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-500 absolute right-3 top-3" />
              <select id="user-form-modal-station"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
              >
                <option value="">بدون محطة (إدارة مركزية)</option>
                {stationId && !stations.some((s) => s.id === stationId) && <option value={stationId}>محطة محذوفة</option>}
                {stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}{station.isMain ? ' (الرئيسية)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-2xs text-slate-500 mt-1">تُنسب إليها أعماله في التكليفات. تُدار المحطات من الإعدادات.</p>
          </div>
        </div>

        {selectedRole && <details className="rounded-xl border border-slate-200 p-3">
          <summary className="min-h-9 cursor-pointer py-1 text-sm font-bold text-slate-900">معاينة مساحة العمل لهذا الحساب</summary>
          {!isActive ? <p className="text-sm text-slate-600">الحساب موقوف.</p> : <>
            <p className="mb-2 text-xs text-slate-600">{selectedRole.nameAr} · {stations.find((station) => station.id === stationId)?.name || 'بلا محطة معيّنة'}. تشمل المعاينة صلاحيات الدور والاستثناءات المدخلة.</p>
            <ul className="divide-y divide-slate-100 text-xs">
              {SCREEN_GROUPS.map(({ label, navs }) => {
                const open = navs.filter((nav) => canOpenScreen(nav, selectedRole,
                  (permission) => evaluatePermission({ role, customRoleId, isActive, customPermissions }, permission, roles), role === 'SUPER_ADMIN'));
                return open.length > 0 && <li key={label} className="py-2"><strong className="me-2">{label}</strong>{open.map(screenLabel).join('، ')}</li>;
              })}
            </ul>
          </>}
        </details>}

        {isGeneralManager && (
          <fieldset className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3" disabled={!canManageOverrides}>
            <legend className="px-1 text-xs font-bold text-slate-900">ما يتابعه المدير العام</legend>
            <p className="text-2xs text-slate-600">
              يتابع ويكلّف في المحطات والمجموعات المختارة (ومحطته إن كانت له محطة). بلا اختيار: محطته فقط، أو كل المحطات إن لم تكن له محطة.
              {!canManageOverrides && ' يغيّرها من يملك صلاحية إدارة الأدوار.'}
            </p>
            <div role="group" aria-label="المحطات التي يتابعها" className="flex flex-wrap gap-x-5 gap-y-1">
              {stations.map((station) => (
                <label key={station.id} className="flex items-center gap-2 min-h-11 sm:min-h-9 text-xs">
                  <input type="checkbox" checked={managedStationIds.includes(station.id)} onChange={() => setManagedStationIds((list) => toggle(list, station.id))} />
                  {station.name}
                </label>
              ))}
            </div>
            {stationGroups.length > 0 && (
              <div role="group" aria-label="مجموعات المحطات التي يتابعها" className="flex flex-wrap gap-x-5 gap-y-1 pt-2 border-t border-slate-200">
                {stationGroups.map((group) => (
                  <label key={group.id} className="flex items-center gap-2 min-h-11 sm:min-h-9 text-xs">
                    <input type="checkbox" checked={managedGroupIds.includes(group.id)} onChange={() => setManagedGroupIds((list) => toggle(list, group.id))} />
                    مجموعة {group.name} ({countLabel(group.stationIds.length, { one: 'محطة واحدة', two: 'محطتان', few: 'محطات', many: 'محطة', zero: 'بلا محطات' })})
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        {/* Staff ID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="user-form-modal-staff-id" className="block text-xs font-bold text-slate-700 mb-1.5">
              الرقم الوظيفي
            </label>
            <input id="user-form-modal-staff-id"
              type="text"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              placeholder="EMP-001"
              className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>

        {/* Avatar Preset Selector */}
        <div>
          <label htmlFor="user-form-modal-field-1" className="block text-xs font-bold text-slate-700 mb-2">
            الصورة الشخصية (رابط اختياري)
          </label>
          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={fullName} className="w-12 h-12 rounded-xl border border-slate-200 shrink-0" />
            <div className="flex-1">
              <div>
                <input id="user-form-modal-field-1"
                  type="text"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://…"
                  dir="ltr"
                  className="w-full min-h-11 text-xs px-3 bg-white border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bio / Description */}
        <div>
          <label htmlFor="user-form-modal-field-13" className="block text-xs font-bold text-slate-700 mb-1.5">
            نبذة مهنية وسجل التخصص التحريري
          </label>
          <textarea id="user-form-modal-field-13"
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="اكتب نبذة مختصرة عن مسؤوليات وتخصص الموظف في شبكة الأخبار..."
            className="w-full text-xs p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 leading-relaxed"
          />
        </div>

        {/* Security & Active Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-slate-100/70 rounded-xl">
          {/* 2FA is enrolled by each user from their own account menu; admins can only reset it. */}
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <KeyRound className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>التحقق بخطوتين:</span>
            <span className={twoFactorEnabled ? 'text-emerald-700' : 'text-slate-500'}>
              {twoFactorEnabled ? 'مفعّل' : 'غير مفعّل (يفعّله المستخدم من قائمة حسابه)'}
            </span>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-500 border-slate-300"
            />
            <span className={isActive ? 'text-emerald-700' : 'text-slate-500'}>
              الحساب نشط ومصرح له بالدخول للنظام
            </span>
          </label>
        </div>

        {canManageOverrides && (
          <PermissionOverridesSection
            value={customPermissions}
            onChange={setCustomPermissions}
            rolePermissions={selectedRole?.permissions || []}
            allByRole={role === 'SUPER_ADMIN'}
          />
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-3 border-t border-slate-200">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 px-5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            <span>{saving ? 'جارٍ الحفظ...' : userToEdit ? 'حفظ التعديلات' : 'تسجيل المستخدم'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-lg transition-colors"
          >
            إلغاء
          </button>
        </div>
      </form>
    </FormPage>
  );
};
