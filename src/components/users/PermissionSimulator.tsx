import React, { useState } from 'react';
import { User } from '../../types';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  RbacService,
  RoleDefinition,
} from '../../services/rbacService';
import { ShieldCheck, ShieldAlert, UserCheck, Key, CheckCircle2, XCircle, Search, HelpCircle } from 'lucide-react';

interface PermissionSimulatorProps {
  users: User[];
  roles: RoleDefinition[];
}

export const PermissionSimulator: React.FC<PermissionSimulatorProps> = ({ users, roles }) => {
  const [selectedUserId, setSelectedUserId] = useState<string>(users[0]?.id || '');
  const [selectedPermissionCode, setSelectedPermissionCode] = useState<string>(ALL_PERMISSIONS[0]?.code || '');

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const selectedPermission = ALL_PERMISSIONS.find((p) => p.code === selectedPermissionCode);

  const hasAccess = selectedUser ? RbacService.hasPermission(selectedUser, selectedPermissionCode) : false;
  const userRole = roles.find((r) => r.roleCode === selectedUser?.role || r.id === selectedUser?.customRoleId);
  const userEffectivePerms = selectedUser ? RbacService.getEffectivePermissions(selectedUser) : [];

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6 font-sans text-right" dir="rtl">
      <div>
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-600" />
          <span>محاكي وفاحص الصلاحيات التفاعلي (RBAC Permission Simulator)</span>
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          أداة لاختبار وتدقيق ما إذا كان لمستخدم معين في غرفة الأخبار الإذن بتنفيذ عملية محددة بناءً على دوره، ورديته، والتصنيف الأمني.
        </p>
      </div>

      {/* Simulator Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            اختر المستخدم للاختبار:
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full text-xs px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-bold"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.jobTitle} - {u.role}) {!u.isActive ? '[مجمد]' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            اختر الإجراء أو الصلاحية المراد فحصها:
          </label>
          <select
            value={selectedPermissionCode}
            onChange={(e) => setSelectedPermissionCode(e.target.value)}
            className="w-full text-xs px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
          >
            {ALL_PERMISSIONS.map((p) => (
              <option key={p.code} value={p.code}>
                [{p.categoryNameAr}] {p.nameAr} ({p.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Decision Output Box */}
      {selectedUser && selectedPermission && (
        <div
          className={`p-5 rounded-2xl border transition-all ${
            hasAccess
              ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
              : 'bg-red-50/80 border-red-300 text-red-950'
          }`}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                  hasAccess ? 'bg-emerald-500 text-white shadow-md' : 'bg-red-500 text-white shadow-md'
                }`}
              >
                {hasAccess ? <CheckCircle2 className="w-7 h-7" /> : <XCircle className="w-7 h-7" />}
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider block opacity-80">
                  نتيجة التقييم الأمني الفوري:
                </span>
                <h4 className="text-base font-extrabold mt-0.5">
                  {hasAccess ? 'العملية مصرح بها ومقبولة (ACCESS GRANTED)' : 'العملية محظورة ومرفوضة (ACCESS DENIED)'}
                </h4>
              </div>
            </div>

            <div className="text-xs flex items-center gap-2">
              <span className="font-bold opacity-80">مستوى الخطورة:</span>
              <span className="px-2 py-0.5 rounded-md font-bold bg-white/80 border border-slate-200">
                {selectedPermission.riskLevel}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200/60 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-white/70 p-2.5 rounded-xl border border-slate-200/50">
              <span className="text-slate-500 block text-[11px]">المستخدم والدور:</span>
              <span className="font-bold text-slate-800">
                {selectedUser.fullName} ({userRole?.nameAr || selectedUser.role})
              </span>
            </div>

            <div className="bg-white/70 p-2.5 rounded-xl border border-slate-200/50">
              <span className="text-slate-500 block text-[11px]">حالة الحساب والمصادقة:</span>
              <span className="font-bold text-slate-800">
                {selectedUser.isActive ? 'نشط ومفعل' : 'حساب مجمد'} | {selectedUser.twoFactorEnabled ? '2FA مفعل' : '2FA غير مفعل'}
              </span>
            </div>

            <div className="bg-white/70 p-2.5 rounded-xl border border-slate-200/50">
              <span className="text-slate-500 block text-[11px]">سبب القرار:</span>
              <span className="font-bold text-slate-800">
                {selectedUser.role === 'SUPER_ADMIN'
                  ? 'صلاحيات المدير العام السيادية'
                  : hasAccess
                  ? 'ممنوحة رسمياً ضمن مصفوفة الدور'
                  : 'غير مشمولة في صلاحيات الدور الحالي'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Summary of Total Effective Permissions for selected user */}
      {selectedUser && (
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-700">
              مجموع الصلاحيات الفعالة للمستخدم: {selectedUser.fullName} ({userEffectivePerms.length} من {ALL_PERMISSIONS.length})
            </h4>
            <span className="text-[11px] text-blue-600 font-bold">
              نسبة التخويل: {Math.round((userEffectivePerms.length / ALL_PERMISSIONS.length) * 100)}%
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-white rounded-xl border border-slate-200">
            {ALL_PERMISSIONS.map((perm) => {
              const isGranted = userEffectivePerms.includes(perm.code);
              return (
                <span
                  key={perm.code}
                  className={`text-[10px] px-2 py-1 rounded-lg border font-medium flex items-center gap-1 ${
                    isGranted
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold'
                      : 'bg-slate-100 text-slate-400 border-slate-200 line-through opacity-60'
                  }`}
                >
                  {isGranted ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <XCircle className="w-3 h-3 text-slate-400" />}
                  <span>{perm.nameAr}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
