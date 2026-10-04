import { FormPage } from '../common/FormPage';
import React, { useState, useEffect } from 'react';
import {
  RoleDefinition,
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PermissionCategory,
} from '../../services/rbacService';
import { Shield, Sparkles, Check, CheckSquare, Square, Palette, AlertTriangle } from 'lucide-react';

interface RoleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (role: RoleDefinition) => void;
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
    } else {
      setNameAr('');
      setNameEn('');
      setRoleCode(`CUSTOM_ROLE_${Date.now().toString().slice(-4)}`);
      setDescription('');
      setSelectedColor(PRESET_ROLE_COLORS[3]);
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

  const handleSelectAllCategory = (categoryKey: PermissionCategory) => {
    const categoryPermCodes = ALL_PERMISSIONS.filter((p) => p.category === categoryKey).map((p) => p.code);
    const allSelected = categoryPermCodes.every((c) => selectedPermissions.includes(c));

    if (allSelected) {
      setSelectedPermissions((prev) => prev.filter((c) => !categoryPermCodes.includes(c)));
    } else {
      setSelectedPermissions((prev) => Array.from(new Set([...prev, ...categoryPermCodes])));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!nameAr.trim()) newErrors.nameAr = 'اسم الدور بالعربية مطلوب';
    if (!roleCode.trim()) newErrors.roleCode = 'رمز الدور البرمجي مطلوب';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave({
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
    });
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
            {errors.nameAr && <p className="text-[10px] text-red-600 mt-1 font-bold">{errors.nameAr}</p>}
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
              onChange={(e) => setRoleCode(e.target.value)}
              placeholder="ROLE_COORDINATOR"
              className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left font-mono disabled:bg-slate-100 disabled:text-slate-500"
              dir="ltr"
            />
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
              <p className="text-[11px] text-slate-500">حدد الإجراءات المسموح لأصحاب هذا الدور تنفيذها في النظام</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPermissions(ALL_PERMISSIONS.map((p) => p.code))}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-bold underline"
              >
                تحديد الكل
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => setSelectedPermissions([])}
                className="text-[11px] text-slate-500 hover:text-slate-700 underline"
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
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
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
                <div
                  key={perm.code}
                  onClick={() => togglePermission(perm.code)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'bg-white border-blue-400 shadow-xs ring-1 ring-blue-300/50'
                      : 'bg-white/60 border-slate-200 hover:bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-800">{perm.nameAr}</span>
                        <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                          ({perm.code})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{perm.description}</p>
                    </div>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${riskColor}`}>
                    {riskLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

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
