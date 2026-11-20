import { FormPage } from '../common/FormPage';
import React, { useState, useEffect } from 'react';
import {
  RoleDefinition,
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PermissionCategory,
} from '../../services/rbacService';
import { ASSIGNABLE_SCREENS, SCREEN_GROUPS, screenLabel } from '../../shared/screens';
import { screenPermission } from '../../shared/commandPalette';
import { Shield, Check } from 'lucide-react';

interface RoleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Returns an error message when the role was refused (the form stays open and shows it). */
  onSave: (role: RoleDefinition) => void | string | null;
  roleToEdit?: RoleDefinition | null;
}

const PRESET_ROLE_COLORS = [
  { hex: '#dc2626', bg: 'bg-red-50 text-red-700 border-red-200' },
  { hex: '#7c3aed', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  { hex: '#2563eb', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
  { hex: '#059669', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { hex: '#d97706', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
  { hex: '#0891b2', bg: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { hex: '#ea580c', bg: 'bg-orange-50 text-orange-700 border-orange-200' },
  { hex: '#4f46e5', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { hex: '#64748b', bg: 'bg-slate-100 text-slate-700 border-slate-200' },
];

export const RoleEditModal: React.FC<RoleEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  roleToEdit,
}) => {
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_ROLE_COLORS[2]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  /** null = every screen the permissions allow. */
  const [screens, setScreens] = useState<string[] | null>(null);
  const [activeCategory, setActiveCategory] = useState<PermissionCategory | 'ALL'>('ALL');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (roleToEdit) {
      setNameAr(roleToEdit.nameAr || '');
      setNameEn(roleToEdit.nameEn || '');
      setRoleCode(roleToEdit.roleCode || '');
      setDescription(roleToEdit.description || '');
      const foundColor = PRESET_ROLE_COLORS.find((c) => c.hex === roleToEdit.color) || PRESET_ROLE_COLORS[2];
      setSelectedColor(foundColor);
      setSelectedPermissions([...roleToEdit.permissions]);
      setScreens(Array.isArray(roleToEdit.screens) ? [...roleToEdit.screens] : null);
    } else {
      setNameAr('');
      setNameEn('');
      setRoleCode(`CUSTOM_ROLE_${Date.now().toString().slice(-4)}`);
      setDescription('');
      setSelectedColor(PRESET_ROLE_COLORS[3]);
      setScreens(null);
      setSelectedPermissions([
        'news.view',
        'news.create',
        'rundown.view',
        'programs.view',
        'media.view',
        'tasks.view',
      ]);
    }
    setErrors({});
  }, [roleToEdit, isOpen]);

  const togglePermission = (code: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!nameAr.trim()) newErrors.nameAr = 'اسم الدور بالعربية مطلوب';
    if (!roleCode.trim()) newErrors.roleCode = 'رمز الدور البرمجي مطلوب';
    else if (!roleToEdit?.isSystemRole && !/^[A-Z][A-Z0-9_]{1,39}$/.test(roleCode.trim().toUpperCase().replace(/\s+/g, '_'))) newErrors.roleCode = 'رمز الدور: حروف إنجليزية وأرقام وشرطة سفلية (_) فقط، ويبدأ بحرف';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const refused = onSave({
      id: roleToEdit?.id || `role-${Date.now()}`,
      roleCode: roleCode.trim().toUpperCase().replace(/\s+/g, '_'),
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || nameAr.trim(),
      description: description.trim(),
      color: selectedColor.hex,
      badgeBg: selectedColor.bg,
      badgeText: nameAr.trim(),
      isSystemRole: roleToEdit?.isSystemRole ?? false,
      permissions: selectedPermissions,
      // Kept in sidebar order; a role without a list opens every screen its permissions allow.
      ...(screens ? { screens: ASSIGNABLE_SCREENS.filter((nav) => screens.includes(nav)) } : {}),
    });
    if (refused) {
      // A duplicate code belongs next to the code field; anything else above the actions.
      setErrors(/الرمز/.test(refused) ? { roleCode: refused } : { form: refused });
      return;
    }
    onClose();
  };

  const filteredPermissions =
    activeCategory === 'ALL'
      ? ALL_PERMISSIONS
      : ALL_PERMISSIONS.filter((p) => p.category === activeCategory);

  return (
    <FormPage
      isOpen={isOpen}
      onClose={onClose}
      title={roleToEdit ? `تعديل صلاحيات الدور: ${roleToEdit.nameAr}` : 'إنشاء وتخصيص دور وصلاحيات جديدة'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-right font-sans" dir="rtl">
        {/* Role Identity Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div>
            <label htmlFor="role-edit-modal-field-1" className="block text-xs font-bold text-slate-700 mb-1.5">
              اسم الدور (بالعربية) <span className="text-red-500">*</span>
            </label>
            <input id="role-edit-modal-field-1"
              type="text"
              value={nameAr}
              onChange={(e) => {
                setNameAr(e.target.value);
                if (errors.nameAr) setErrors((prev) => ({ ...prev, nameAr: '' }));
              }}
              placeholder="مثال: منسق نشرات أول"
              className={`w-full text-xs px-3 py-2 bg-white border rounded-xl focus:outline-none ${
                errors.nameAr ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
              }`}
            />
            {errors.nameAr && <p className="text-2xs text-red-600 mt-1 font-bold">{errors.nameAr}</p>}
          </div>

          <div>
            <label htmlFor="role-edit-modal-field-2" className="block text-xs font-bold text-slate-700 mb-1.5">
              الاسم بالإنجليزية
            </label>
            <input id="role-edit-modal-field-2"
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="e.g. Senior Broadcast Coordinator"
              className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left font-sans"
              dir="ltr"
            />
          </div>

          <div>
            <label htmlFor="role-edit-modal-field-3" className="block text-xs font-bold text-slate-700 mb-1.5">
              الرمز التعريفي البرمجي (Role Code) <span className="text-red-500">*</span>
            </label>
            <input id="role-edit-modal-field-3"
              type="text"
              value={roleCode}
              disabled={roleToEdit?.isSystemRole}
              onChange={(e) => {
                setRoleCode(e.target.value);
                if (errors.roleCode || errors.form) setErrors((prev) => ({ ...prev, roleCode: '', form: '' }));
              }}
              placeholder="ROLE_COORDINATOR"
              aria-invalid={!!errors.roleCode}
              aria-describedby={errors.roleCode ? 'role-edit-modal-code-error' : undefined}
              className={`w-full text-xs px-3 py-2 bg-white border rounded-xl focus:outline-none focus:border-blue-500 text-left font-mono disabled:bg-slate-100 disabled:text-slate-500 ${errors.roleCode ? 'border-red-500 bg-red-50/20' : 'border-slate-200'}`}
              dir="ltr"
            />
            {errors.roleCode && <p id="role-edit-modal-code-error" role="alert" className="text-2xs text-red-600 mt-1 font-bold">{errors.roleCode}</p>}
          </div>

          <div className="md:col-span-2">
            <label htmlFor="role-edit-modal-field-4" className="block text-xs font-bold text-slate-700 mb-1.5">
              وصف الدور ونطاق المسؤولية التحريرية
            </label>
            <input id="role-edit-modal-field-4"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف مختصر للمهام المنوطة بهذا الدور..."
              className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              لون الشارة التعريفية:
            </label>
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {PRESET_ROLE_COLORS.map((c, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    selectedColor.hex === c.hex ? 'scale-125 ring-2 ring-blue-400' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Permissions Assignment Matrix */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-blue-600" />
                <span>تعيين الصلاحيات الممنوحة لهذا الدور ({selectedPermissions.length} من {ALL_PERMISSIONS.length})</span>
              </h3>
              <p className="text-2xs text-slate-500">حدد الإجراءات المسموح لأصحاب هذا الدور تنفيذها في النظام</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPermissions(ALL_PERMISSIONS.map((p) => p.code))}
                className="text-2xs text-blue-600 hover:text-blue-800 font-bold underline"
              >
                تحديد الكل
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => setSelectedPermissions([])}
                className="text-2xs text-slate-500 hover:text-slate-700 underline"
              >
                إلغاء التحديد
              </button>
            </div>
          </div>

          {/* Category Filter Chips */}
          <div className="flex flex-wrap gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => setActiveCategory('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeCategory === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              كافة الأقسام ({ALL_PERMISSIONS.length})
            </button>
            {PERMISSION_CATEGORIES.map((cat) => {
              const countInCat = ALL_PERMISSIONS.filter((p) => p.category === cat.key).length;
              const selectedInCat = ALL_PERMISSIONS.filter(
                (p) => p.category === cat.key && selectedPermissions.includes(p.code)
              ).length;

              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setActiveCategory(cat.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    activeCategory === cat.key
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <span>{cat.labelAr}</span>
                  <span
                    className={`text-2xs px-1.5 py-0.2 rounded-full font-mono ${
                      activeCategory === cat.key ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {selectedInCat}/{countInCat}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Permissions Checklist Grid */}
          <div className="max-h-72 overflow-y-auto p-2 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            {filteredPermissions.map((perm) => {
              const isSelected = selectedPermissions.includes(perm.code);
              const riskColor = {
                LOW: 'bg-slate-100 text-slate-600 border-slate-200',
                MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
                HIGH: 'bg-amber-50 text-amber-700 border-amber-200',
                CRITICAL: 'bg-red-50 text-red-700 border-red-200',
              }[perm.riskLevel];

              const riskLabel = {
                LOW: 'منخفض',
                MEDIUM: 'متوسط',
                HIGH: 'مرتفع',
                CRITICAL: 'حرج / سيادي',
              }[perm.riskLevel];

              return (
                <label
                  key={perm.code}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600 ${
                    isSelected
                      ? 'bg-white border-blue-400 shadow-xs ring-1 ring-blue-300/50'
                      : 'bg-white/60 border-slate-200 hover:bg-white'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input type="checkbox" checked={isSelected} onChange={() => togglePermission(perm.code)} aria-label={perm.nameAr} className="mt-0.5 size-4 shrink-0 accent-blue-600" />
                    <span>
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-800">{perm.nameAr}</span>
                        <span className="text-2xs text-slate-500 font-mono" dir="ltr">
                          ({perm.code})
                        </span>
                      </span>
                      <span className="block text-2xs text-slate-500 mt-0.5">{perm.description}</span>
                    </span>
                  </span>

                  <span className={`text-2xs font-bold px-2 py-0.5 rounded-md border shrink-0 ${riskColor}`}>
                    {riskLabel}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Screens the role opens */}
        <fieldset className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <legend className="text-sm font-bold text-slate-900 px-1">الصفحات التي يفتحها هذا الدور</legend>
          <p className="text-xs text-slate-600">الصلاحيات تحدد ما يستطيع فعله بالبيانات؛ وهنا تحدد الصفحات التي تظهر له. الرئيسية والمساعدة وإعدادات التنبيهات تبقى متاحة للجميع.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <label className="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-800">
              <input type="radio" name="role-screens-mode" checked={screens === null} onChange={() => setScreens(null)} />
              كل الصفحات التي تسمح بها صلاحياته
            </label>
            <label className="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-800">
              <input type="radio" name="role-screens-mode" checked={screens !== null} onChange={() => setScreens(screens ?? ASSIGNABLE_SCREENS.filter((nav) => !screenPermission(nav) || selectedPermissions.includes(screenPermission(nav)!)))} />
              صفحات محددة فقط
            </label>
          </div>
          {screens !== null && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {SCREEN_GROUPS.map((group) => (
                <div key={group.label} role="group" aria-label={group.label} className="bg-white border border-slate-200 rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-700 mb-1">{group.label}</p>
                  {group.navs.map((nav) => {
                    const needs = screenPermission(nav);
                    const lacks = !!needs && !selectedPermissions.includes(needs);
                    return (
                      <label key={nav} className={`flex items-center gap-2 min-h-9 text-xs ${lacks ? 'text-slate-400' : 'text-slate-800'}`}>
                        <input type="checkbox" checked={screens.includes(nav)} onChange={() => setScreens(screens.includes(nav) ? screens.filter((x) => x !== nav) : [...screens, nav])} />
                        {screenLabel(nav)}
                        {lacks && <span className="text-2xs">(تحتاج صلاحيتها)</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </fieldset>

        {(errors.form || errors.roleCode || errors.nameAr) && (
          <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {errors.form || errors.roleCode || errors.nameAr}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>حفظ إعدادات الدور</span>
          </button>
        </div>
      </form>
    </FormPage>
  );
};
