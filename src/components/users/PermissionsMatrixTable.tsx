import React, { useState } from 'react';
import { matchesQuery } from '../../shared/search';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PermissionCategory,
  RoleDefinition,
} from '../../services/rbacService';
import { Check, Plus, Edit2, Trash2, Search, Filter, RefreshCw, Info } from 'lucide-react';
import { alertDialog, confirmDialog } from '../../services/dialogs';

interface PermissionsMatrixTableProps {
  roles: RoleDefinition[];
  onUpdateRolePermissions: (roleId: string, permissionCode: string, isEnabled: boolean) => void;
  onEditRole: (role: RoleDefinition) => void;
  onDeleteRole: (roleId: string) => void;
  onAddNewRole: () => void;
  onResetDefaults: () => void;
  /** Why a role cannot be deleted (e.g. colleagues still hold it), or null; checked before asking to confirm. */
  roleDeleteBlocker?: (role: RoleDefinition) => string | null;
}

export const PermissionsMatrixTable: React.FC<PermissionsMatrixTableProps> = ({
  roles,
  onUpdateRolePermissions,
  onEditRole,
  onDeleteRole,
  onAddNewRole,
  onResetDefaults,
  roleDeleteBlocker,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PermissionCategory | 'ALL'>('ALL');

  const handleDeleteRole = async (role: RoleDefinition) => {
    const blocker = roleDeleteBlocker?.(role);
    if (blocker) {
      await alertDialog({ title: 'تعذر حذف الدور', message: blocker });
      return;
    }
    const ok = await confirmDialog({
      title: 'حذف الدور',
      message: `حذف الدور المخصص «${role.nameAr}» نهائياً مع صلاحياته؟`,
      confirmLabel: 'حذف الدور',
      danger: true,
    });
    if (ok) onDeleteRole(role.id);
  };

  const filteredPermissions = ALL_PERMISSIONS.filter((perm) => {
    const matchesSearch = matchesQuery(searchQuery, perm.nameAr, perm.nameEn, perm.code, perm.description);

    const matchesCat = selectedCategory === 'ALL' || perm.category === selectedCategory;

    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-4 font-sans text-right" dir="rtl">
      {/* Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
            <input
              type="search"
              aria-label="بحث في الصلاحيات"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم الصلاحية أو رمزها..."
              className="w-full min-h-11 sm:min-h-9 text-xs pr-9 pl-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <select
              aria-label="مجال الصلاحيات"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as any)}
              className="min-h-11 sm:min-h-9 text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
            >
              <option value="ALL">كل المجالات</option>
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
            className="min-h-11 sm:min-h-9 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
            title="استعادة الصلاحيات القياسية للمنظومة"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>استعادة الإعدادات الافتراضية</span>
          </button>

          <button
            type="button"
            onClick={onAddNewRole}
            className="min-h-11 sm:min-h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة دور مخصص جديد</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-600 flex items-start gap-1.5">
        <Info className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
        الضغط على خانة يمنح الصلاحية للدور أو يلغيها فوراً ويُسجَّل في سجل التدقيق. دور «مدير النظام العام» يملك كل الصلاحيات دائماً حتى لا يُقفل النظام.
      </p>

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-100 text-slate-700 text-2xs font-bold border-b-2 border-slate-300">
                <th className="p-3.5 min-w-[280px] sticky right-0 bg-slate-100 z-10">
                  الصلاحية ونطاق العملية
                </th>
                <th className="p-3.5 text-center min-w-[90px]">مستوى الحساسية</th>
                {roles.map((role) => (
                  <th key={role.id} className="p-3 text-center min-w-[130px] border-r border-slate-200">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-bold text-slate-900">{role.nameAr}</span>
                      <span className="text-3xs font-semibold text-slate-600 font-mono tabular-nums">
                        {role.roleCode === 'SUPER_ADMIN' ? ALL_PERMISSIONS.length : role.permissions.length} / {ALL_PERMISSIONS.length}
                        <span className="font-sans me-1"> · {role.isSystemRole ? 'نظامي' : 'مخصص'}</span>
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEditRole(role)}
                          className="min-h-8 min-w-8 inline-flex items-center justify-center hover:bg-slate-200 text-slate-500 hover:text-slate-900 rounded-md transition-colors"
                          title="تعديل هذا الدور"
                          aria-label={`تعديل الدور: ${role.nameAr}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        {!role.isSystemRole && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteRole(role)}
                            className="min-h-8 min-w-8 inline-flex items-center justify-center hover:bg-rose-50 text-slate-500 hover:text-rose-700 rounded-md transition-colors"
                            aria-label={`حذف الدور: ${role.nameAr}`}
                            title="حذف هذا الدور"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
                  <td colSpan={roles.length + 2} className="p-8 text-center text-slate-500">
                    لا توجد صلاحيات مطابقة لمعايير البحث الحالية
                  </td>
                </tr>
              ) : (
                filteredPermissions.map((perm, idx) => {
                  const showGroup = idx === 0 || filteredPermissions[idx - 1].category !== perm.category;
                  const group = PERMISSION_CATEGORIES.find((c) => c.key === perm.category);
                  const groupCount = filteredPermissions.filter((p) => p.category === perm.category).length;
                  const riskBadge = {
                    LOW: <span className="text-2xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">منخفض</span>,
                    MEDIUM: <span className="text-2xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200">متوسط</span>,
                    HIGH: <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-200">مرتفع</span>,
                    CRITICAL: <span className="text-2xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 font-bold border border-rose-200 whitespace-nowrap">حرج</span>,
                  }[perm.riskLevel];

                  return (
                    <React.Fragment key={perm.code}>
                    {showGroup && (
                      <tr className="bg-slate-100">
                        <th
                          colSpan={roles.length + 2}
                          scope="colgroup"
                          className="px-3.5 py-2 text-start text-2xs font-bold text-slate-800 sticky right-0"
                        >
                          {group?.labelAr ?? perm.category}
                          <span className="ms-2 font-mono tabular-nums font-semibold text-slate-500">{groupCount}</span>
                        </th>
                      </tr>
                    )}
                    <tr
                      className={`hover:bg-blue-50/40 transition-colors ${
                        'bg-white'
                      }`}
                    >
                      {/* Permission Title & Info */}
                      <td className="p-3 sticky right-0 bg-white z-10">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">{perm.nameAr}</span>
                            <span className="text-2xs text-slate-500 font-mono" dir="ltr">
                              {perm.code}
                            </span>
                          </div>
                          <span className="text-2xs text-slate-500 mt-0.5 line-clamp-1">
                            {perm.description}
                          </span>
                        </div>
                      </td>

                      {/* Risk Level */}
                      <td className="p-3 text-center">{riskBadge}</td>

                      {/* Role cells: real toggle buttons, so the grid works from the keyboard too. */}
                      {roles.map((role) => {
                        const isGranted = role.permissions.includes(perm.code);
                        const isSuper = role.roleCode === 'SUPER_ADMIN';
                        const label = `${perm.nameAr} — ${role.nameAr}`;
                        return (
                          <td key={role.id} className="p-1.5 text-center border-r border-slate-100">
                            {isSuper ? (
                              <span className="inline-flex w-9 h-9 items-center justify-center text-slate-500" title="مدير النظام يملك كل الصلاحيات دائماً">
                                <Check className="w-4 h-4" aria-hidden="true" />
                                <span className="sr-only">{label}: ممنوحة دائماً</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                aria-pressed={isGranted}
                                aria-label={label}
                                title={isGranted ? 'ممنوحة؛ اضغط للإلغاء' : 'غير ممنوحة؛ اضغط للمنح'}
                                onClick={() => onUpdateRolePermissions(role.id, perm.code, !isGranted)}
                                className="group inline-flex w-11 h-11 sm:w-9 sm:h-9 items-center justify-center rounded-md hover:bg-blue-50"
                              >
                                <span className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isGranted ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-transparent group-hover:border-blue-400'}`}>
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                </span>
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
