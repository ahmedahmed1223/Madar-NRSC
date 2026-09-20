import React, { useState } from 'react';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PermissionCategory,
  RoleDefinition,
} from '../../services/rbacService';
import {
  Shield,
  Check,
  X,
  Plus,
  Edit2,
  Trash2,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface PermissionsMatrixTableProps {
  roles: RoleDefinition[];
  onUpdateRolePermissions: (roleId: string, permissionCode: string, isEnabled: boolean) => void;
  onEditRole: (role: RoleDefinition) => void;
  onDeleteRole: (roleId: string) => void;
  onAddNewRole: () => void;
  onResetDefaults: () => void;
}

export const PermissionsMatrixTable: React.FC<PermissionsMatrixTableProps> = ({
  roles,
  onUpdateRolePermissions,
  onEditRole,
  onDeleteRole,
  onAddNewRole,
  onResetDefaults,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PermissionCategory | 'ALL'>('ALL');

  const filteredPermissions = ALL_PERMISSIONS.filter((perm) => {
    const matchesSearch =
      perm.nameAr.includes(searchQuery) ||
      perm.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      perm.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      perm.description.includes(searchQuery);

    const matchesCat = selectedCategory === 'ALL' || perm.category === selectedCategory;

    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-4 font-sans text-right" dir="rtl">
      {/* Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث في الصلاحيات أو الرمز البرمجي..."
              className="w-full text-xs pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as any)}
              className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
            >
              <option value="ALL">كافة الأقسام والموديولات</option>
              {PERMISSION_CATEGORIES.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.labelAr}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResetDefaults}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
            title="استعادة الصلاحيات القياسية للمنظومة"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>استعادة الإعدادات الافتراضية</span>
          </button>

          <button
            type="button"
            onClick={onAddNewRole}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة دور مخصص جديد</span>
          </button>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] font-bold border-b border-slate-800">
                <th className="p-3.5 min-w-[280px] sticky right-0 bg-slate-900 z-10">
                  الصلاحية ونطاق العملية (RBAC Permission)
                </th>
                <th className="p-3.5 text-center min-w-[90px]">مستوى الحساسية</th>
                {roles.map((role) => (
                  <th key={role.id} className="p-3 text-center min-w-[130px] border-r border-slate-800">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-bold">{role.nameAr}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEditRole(role)}
                          className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded-md transition-colors"
                          title="تعديل هذا الدور"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        {!role.isSystemRole && (
                          <button
                            type="button"
                            onClick={() => onDeleteRole(role.id)}
                            className="p-1 hover:bg-red-900/50 text-red-400 hover:text-red-300 rounded-md transition-colors"
                            title="حذف هذا الدور"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPermissions.length === 0 ? (
                <tr>
                  <td colSpan={roles.length + 2} className="p-8 text-center text-slate-400">
                    لا توجد صلاحيات مطابقة لمعايير البحث الحالية
                  </td>
                </tr>
              ) : (
                filteredPermissions.map((perm, idx) => {
                  const riskBadge = {
                    LOW: <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">منخفض</span>,
                    MEDIUM: <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200">متوسط</span>,
                    HIGH: <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-200">مرتفع</span>,
                    CRITICAL: <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-200">حرج / سيادي</span>,
                  }[perm.riskLevel];

                  return (
                    <tr
                      key={perm.code}
                      className={`hover:bg-blue-50/40 transition-colors ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                      }`}
                    >
                      {/* Permission Title & Info */}
                      <td className="p-3 sticky right-0 bg-white shadow-xs z-5">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">{perm.nameAr}</span>
                            <span className="text-[10px] text-slate-400 font-mono" dir="ltr">
                              ({perm.code})
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                            {perm.description}
                          </span>
                        </div>
                      </td>

                      {/* Risk Level */}
                      <td className="p-3 text-center">{riskBadge}</td>

                      {/* Role Checkboxes */}
                      {roles.map((role) => {
                        const isGranted = role.permissions.includes(perm.code);
                        const isSuper = role.roleCode === 'SUPER_ADMIN';

                        return (
                          <td
                            key={role.id}
                            className="p-3 text-center border-r border-slate-100 cursor-pointer hover:bg-blue-100/30"
                            onClick={() => {
                              if (!isSuper) {
                                onUpdateRolePermissions(role.id, perm.code, !isGranted);
                              }
                            }}
                          >
                            <div className="flex items-center justify-center">
                              {isSuper ? (
                                <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold" title="مدير النظام يملك كافة الصلاحيات تلقائياً">
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                              ) : isGranted ? (
                                <div className="w-6 h-6 rounded-md bg-emerald-500 text-white flex items-center justify-center shadow-xs transition-transform hover:scale-110">
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-md bg-slate-100 text-slate-300 hover:text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors">
                                  <X className="w-3.5 h-3.5" />
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info footer */}
      <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-bold">ملاحظة أمنية حول مصفوفة الصلاحيات (RBAC Matrix):</p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            النقر المباشر على أي خلية يقوم بتفعيل أو إلغاء الصلاحية للدور المحدد فورياً. دور (مدير النظام العام) يمتلك كامل الصلاحيات بصورة سيادية غير قابلة للإلغاء لضمان عدم قفل النظام.
          </p>
        </div>
      </div>
    </div>
  );
};
