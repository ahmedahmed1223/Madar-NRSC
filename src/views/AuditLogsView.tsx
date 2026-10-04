import { appLocale, zoneOptions } from '../shared/dateFormat';
import { matchesQuery } from '../shared/search';
import React, { useState } from 'react';
import {
  Shield,
  Search,
  Clock,
  User as UserIcon,
  Filter,
  FileText,
  Radio,
  AlertTriangle,
  Info,
  X,
  RotateCcw,
} from 'lucide-react';
import { AuditLog } from '../types';
import { Badge } from '../components/common/Badge';

interface AuditLogsViewProps {
  logs: AuditLog[];
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف', RESTORE: 'استعادة', PUBLISH: 'نشر', UNPUBLISH: 'إلغاء نشر',
  STATUS_CHANGE: 'تغيير حالة', LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', LOGIN_FAILED: 'محاولة دخول فاشلة',
  SETTINGS_UPDATE: 'تعديل إعدادات', SECURITY_VIOLATION: 'محاولة غير مصرح بها', PASSWORD_CHANGE: 'تغيير كلمة المرور',
  PASSWORD_RESET: 'إعادة تعيين كلمة المرور', TWO_FACTOR_ENABLED: 'تفعيل التحقق بخطوتين', TWO_FACTOR_DISABLED: 'إلغاء التحقق بخطوتين',
  DB_EXPORT: 'تنزيل قاعدة البيانات', DB_RESET: 'إعادة تهيئة البيانات', DB_RESTORE: 'استعادة نسخة احتياطية', BACKUP_CREATE: 'نسخة احتياطية',
  DEMO_DATA_REMOVED: 'حذف البيانات التجريبية', ROLE_CHANGE: 'تغيير الدور والصلاحيات', USER_SUSPEND: 'إيقاف حساب',
  USER_DELETE: 'حذف مستخدم', USER_CREATE: 'إضافة مستخدم',
};
const actionName = (a: string) => ACTION_LABELS[a] || a;

/** What the action touched, in Arabic (the codes stay searchable). */
const ENTITY_LABELS: Record<string, string> = {
  AUTH: 'الدخول', USER: 'مستخدم', NEWS: 'خبر', BREAKING_NEWS: 'عاجل', EPISODE: 'حلقة', PROGRAM: 'برنامج', GUEST: 'ضيف',
  STORY: 'تغطية', TASK: 'مهمة', MEDIA: 'وسائط', BULLETIN: 'نشرة', BULLETIN_FORMAT: 'قالب نشرة', BULLETIN_STORY: 'قصة نشرة',
  DIARY: 'أجندة', BOOKING: 'حجز', RESOURCE: 'مورد', REQUEST: 'طلب قسم', SETTINGS: 'الإعدادات', BACKUP: 'النسخ الاحتياطي',
  BROADCAST: 'البث', ROLE: 'دور', DATABASE: 'قاعدة البيانات',
};
const entityName = (e: string) => ENTITY_LABELS[e] || e;

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ logs = [] }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('ALL');

  // The server writes actionType/targetEntity/timestamp; older rows may use action/entityType/createdAt.
  const actionOf = (log: AuditLog) => log.actionType || log.action || '';
  const entityOf = (log: AuditLog) => log.targetEntity || log.entityType || '';
  const timeOf = (log: AuditLog) => log.timestamp || log.createdAt || '';

  const filteredLogs = (logs || []).filter((log) => {
    if (selectedAction !== 'ALL' && actionOf(log) !== selectedAction) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, log.userName, log.details, entityOf(log), ENTITY_LABELS[entityOf(log)], actionOf(log), ACTION_LABELS[actionOf(log)]);
    }
    return true;
  });


  const getActionBadge = (action: string) => {
    switch (action) {
      case 'PUBLISH':
        return <Badge variant="success" size="sm">نشر</Badge>;
      case 'STATUS_CHANGE':
        return <Badge variant="purple" size="sm">تغيير حالة تحريرية</Badge>;
      case 'CREATE':
        return <Badge variant="primary" size="sm">إنشاء جديد</Badge>;
      case 'UPDATE':
        return <Badge variant="default" size="sm">تعديل بيانات</Badge>;
      case 'DELETE':
        return <Badge variant="danger" size="sm">حذف</Badge>;
      case 'LOGIN':
        return <Badge variant="info" size="sm">تسجيل دخول</Badge>;
      default:
        return <Badge variant="default" size="sm">{actionName(action)}</Badge>;
    }
  };

  const hasActiveFilters = searchQuery.trim() !== '' || selectedAction !== 'ALL';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedAction('ALL');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            <span>سجل التدقيق</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            تسجيل غير قابل للتعديل لجميع العمليات والاعتمادات والنشر وتغيير الصلاحيات في النظام
          </p>
        </div>
        <div className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 self-start sm:self-auto">
          إجمالي السجلات: <span className="text-slate-800 font-mono">{filteredLogs.length}</span> من <span className="font-mono">{logs.length}</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <label htmlFor="audit-search-input" className="sr-only">بحث في سجل التدقيق</label>
            <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="audit-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالموظف، تفاصيل الإجراء، أو الكيان..."
              autoComplete="off"
              spellCheck="false"
              className="w-full pr-10 pl-9 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
                title="مسح البحث"
                aria-label="مسح البحث"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label htmlFor="audit-action-filter" className="text-xs text-slate-500 shrink-0 font-medium">نوع الإجراء:</label>
            <select
              id="audit-action-filter"
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all w-full sm:w-auto font-medium"
            >
              <option value="ALL">جميع الإجراءات</option>
              {[...new Set((logs || []).map(actionOf))]
                .filter(Boolean)
                .sort()
                .map((a) => (
                  <option key={a} value={a}>
                    {actionName(a)}
                  </option>
                ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors whitespace-nowrap"
                title="إعادة تعيين جميع الفلاتر"
              >
                إعادة تعيين
              </button>
            )}
          </div>
        </div>

        {/* Action quick tags */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 text-xs">
          <span className="text-[11px] font-bold text-slate-500 ml-1">تصفية سريعة:</span>
          {[
            { id: 'ALL', label: 'الكل' },
            { id: 'PUBLISH', label: 'نشر فوري' },
            { id: 'STATUS_CHANGE', label: 'تغيير حالة' },
            { id: 'CREATE', label: 'إنشاء' },
            { id: 'UPDATE', label: 'تعديل' },
            { id: 'DELETE', label: 'حذف' },
          ].map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => setSelectedAction(tag.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                selectedAction === tag.id
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="جدول سجل التدقيق (يمكن تمريره أفقياً)">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3 px-4">التاريخ والوقت</th>
                <th className="py-3 px-3">المستخدم / المسؤول</th>
                <th className="py-3 px-3">نوع الإجراء</th>
                <th className="py-3 px-3">الكيان المتأثر</th>
                <th className="py-3 px-4">تفاصيل وملاحظات العملية</th>
                <th className="py-3 px-3">عنوان IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    لا توجد سجلات تطابق معايير البحث أو التصفية الحالية.
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="text-blue-600 hover:underline font-bold mr-2"
                      >
                        إعادة تعيين الفلاتر
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 tabular-nums text-slate-500 whitespace-nowrap">
                      {timeOf(log)
                        ? new Date(timeOf(log)).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : ''}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-800">{log.userName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{log.userId}</div>
                    </td>
                    <td className="py-3 px-3">{getActionBadge(actionOf(log))}</td>
                    <td className="py-3 px-3 font-semibold text-slate-700">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        {entityName(entityOf(log))}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 leading-relaxed max-w-md">
                      {log.details}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 text-[11px]" dir="ltr">
                      {log.ipAddress || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
