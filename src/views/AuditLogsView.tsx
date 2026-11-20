import { appLocale, zoneOptions } from '../shared/dateFormat';
import { matchesQuery } from '../shared/search';
import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Search, X, Download } from 'lucide-react';
import { ActivityLog, AuditLog } from '../types';
import { Badge } from '../components/common/Badge';
import { FilterTabs } from '../components/common/FilterTabs';
import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { downloadCsv } from '../services/csvExport';
import { filterLogRows, logUsers } from '../services/logFilters';
import { localDateString } from '../shared/dates';
import { AUDIT_ACTION_LABELS, readableAuditDetails } from '../shared/auditTrail';

interface AuditLogsViewProps {
  logs: AuditLog[];
}

/** Every action the server writes, in Arabic (shared with the server's audit trail). */
const ACTION_LABELS = AUDIT_ACTION_LABELS;
const actionName = (a: string) => ACTION_LABELS[a] || a;

/** What the action touched, in Arabic (the codes stay searchable). */
const ENTITY_LABELS: Record<string, string> = {
  AUTH: 'الدخول', USER: 'مستخدم', NEWS: 'خبر', BREAKING_NEWS: 'عاجل', EPISODE: 'حلقة', PROGRAM: 'برنامج', GUEST: 'ضيف',
  STORY: 'تغطية', TASK: 'مهمة', MEDIA: 'وسائط', BULLETIN: 'نشرة', BULLETIN_FORMAT: 'قالب نشرة', BULLETIN_STORY: 'قصة نشرة',
  DIARY: 'أجندة', BOOKING: 'حجز', RESOURCE: 'مورد', REQUEST: 'طلب قسم', SETTINGS: 'الإعدادات', BACKUP: 'النسخ الاحتياطي',
  BROADCAST: 'البث', ROLE: 'دور', DATABASE: 'قاعدة البيانات', STATION: 'محطة', DEPARTMENT: 'الأقسام الإدارية', PRODUCTION_CARD: 'تكليف', STORAGE: 'التخزين',
};
const entityName = (e: string) => ENTITY_LABELS[e] || e;

// The server writes actionType/targetEntity/timestamp; older rows may use action/entityType/createdAt.
const actionOf = (log: AuditLog) => log.actionType || log.action || '';
const entityOf = (log: AuditLog) => log.targetEntity || log.entityType || '';
const timeOf = (log: AuditLog) => log.timestamp || log.createdAt || '';
const fullTime = (iso: string) =>
  iso ? new Date(iso).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const SEVERITY_LABELS: Record<string, string> = { INFO: 'معلومة', WARNING: 'تحذير', SECURITY: 'أمني' };
const FIELD = 'min-h-11 px-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

type LogTab = 'AUDIT' | 'ACTIVITY';

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ logs = [] }) => {
  const [tab, setTab] = useState<LogTab>('AUDIT');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('ALL');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [userId, setUserId] = useState('ALL');

  // The activity log (who did what in the newsroom) is read here and follows live changes.
  const [activity, setActivity] = useState<ActivityLog[]>(() => apiService.getActivityLogs());
  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type === 'data-changed' && evt.collections.includes('activityLogs')) setActivity(apiService.getActivityLogs());
      }),
    []
  );

  const filter = { fromDay, toDay, userId };
  const filteredLogs = useMemo(
    () =>
      filterLogRows(logs || [], filter, timeOf, (l) => l.userId).filter((log) => {
        if (selectedAction !== 'ALL' && actionOf(log) !== selectedAction) return false;
        if (searchQuery.trim()) {
          return matchesQuery(searchQuery, log.userName, readableAuditDetails(log.details), entityOf(log), ENTITY_LABELS[entityOf(log)], actionOf(log), ACTION_LABELS[actionOf(log)]);
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, fromDay, toDay, userId, selectedAction, searchQuery]
  );
  const filteredActivity = useMemo(
    () =>
      filterLogRows(activity, filter, (a) => a.timestamp, (a) => a.userId).filter(
        (a) => !searchQuery.trim() || matchesQuery(searchQuery, a.userName, a.summaryAr, a.entityTitle, a.entityType, ENTITY_LABELS[a.entityType], a.action, ACTION_LABELS[a.action])
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, fromDay, toDay, userId, searchQuery]
  );
  const resetKey = `${tab}|${fromDay}|${toDay}|${userId}|${selectedAction}|${searchQuery}`;
  const auditPage = useIncremental(filteredLogs, 100, resetKey);
  const activityPage = useIncremental(filteredActivity, 100, resetKey);

  const userOptions = useMemo(() => {
    const merged = [
      ...logUsers(logs || [], (l) => l.userId, (l) => l.userName),
      ...logUsers(activity, (a) => a.userId, (a) => a.userName),
    ];
    const byId = new Map(merged.map((u) => [u.id, u]));
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [logs, activity]);

  const exportCsv = () => {
    const stamp = localDateString();
    if (tab === 'AUDIT') {
      downloadCsv(`سجل-التدقيق-${stamp}.csv`, [
        // ISO time first: sortable and importable; the Arabic time stays for reading.
        ['الوقت (ISO 8601)', 'التاريخ والوقت', 'المستخدم', 'معرف المستخدم', 'رمز الإجراء', 'نوع الإجراء', 'الكيان المتأثر', 'معرف الكيان', 'الخطورة', 'التفاصيل', 'عنوان IP'],
        ...filteredLogs.map((l) => [timeOf(l), fullTime(timeOf(l)), l.userName, l.userId, actionOf(l), actionName(actionOf(l)), entityName(entityOf(l)), l.targetId || '', SEVERITY_LABELS[l.severity || ''] || l.severity || '', readableAuditDetails(l.details), l.ipAddress || '']),
      ]);
    } else {
      downloadCsv(`سجل-النشاط-${stamp}.csv`, [
        ['الوقت (ISO 8601)', 'التاريخ والوقت', 'المستخدم', 'معرف المستخدم', 'الإجراء', 'النوع', 'العنوان', 'الملخص'],
        ...filteredActivity.map((a) => [a.timestamp, fullTime(a.timestamp), a.userName, a.userId, actionName(a.action), entityName(a.entityType), a.entityTitle, a.summaryAr]),
      ]);
    }
  };


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

  const hasActiveFilters = searchQuery.trim() !== '' || selectedAction !== 'ALL' || !!fromDay || !!toDay || userId !== 'ALL';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedAction('ALL');
    setFromDay('');
    setToDay('');
    setUserId('ALL');
  };
  const shownCount = tab === 'AUDIT' ? filteredLogs.length : filteredActivity.length;
  const totalCount = tab === 'AUDIT' ? (logs || []).length : activity.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            <Shield className="w-5 h-5" aria-hidden="true" />
            سجل التدقيق
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            يكتبه الخادم ولا يُعدَّل: الدخول والنشر والاعتمادات وتغيير الحسابات والصلاحيات. «سجل النشاط» يروي عمل الزملاء في المواد.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div role="status" className="text-xs text-slate-600 tabular-nums">
            <span className="font-bold text-slate-900">{shownCount}</span> من {totalCount}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={shownCount === 0}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            تصدير CSV
          </button>
        </div>
      </div>

      <FilterTabs<LogTab>
        label="نوع السجل"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'AUDIT', label: 'سجل التدقيق', count: filteredLogs.length, tone: 'blue' },
          { id: 'ACTIVITY', label: 'سجل النشاط', count: filteredActivity.length, tone: 'slate' },
        ]}
      />

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end flex-wrap gap-3">
          <div className="relative w-full sm:flex-1 sm:min-w-64 sm:max-w-md">
            <label htmlFor="audit-search-input" className="sr-only">بحث في سجل التدقيق</label>
            <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="audit-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الإجراء أو التفاصيل..."
              autoComplete="off"
              spellCheck="false"
              className="w-full min-h-11 pr-10 pl-11 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-0.5 top-1/2 -translate-y-1/2 min-h-10 min-w-10 inline-flex items-center justify-center text-slate-500 hover:text-slate-700 rounded-md"
                title="مسح البحث"
                aria-label="مسح البحث"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {tab === 'AUDIT' && (
          <div>
            <label htmlFor="audit-action-filter" className="block text-2xs font-bold text-slate-600 mb-1">نوع الإجراء</label>
            <select
              id="audit-action-filter"
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className={`${FIELD} w-full sm:w-auto`}
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
          </div>
          )}

          <div>
            <label htmlFor="audit-from-day" className="block text-2xs font-bold text-slate-600 mb-1">من تاريخ</label>
            <input id="audit-from-day" type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setFromDay(e.target.value)} className={FIELD} dir="ltr" />
          </div>
          <div>
            <label htmlFor="audit-to-day" className="block text-2xs font-bold text-slate-600 mb-1">إلى تاريخ</label>
            <input id="audit-to-day" type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setToDay(e.target.value)} className={FIELD} dir="ltr" />
          </div>
          {fromDay && toDay && fromDay > toDay && (
            <p role="alert" className="basis-full text-xs font-bold text-amber-800">
              تاريخ «من» بعد تاريخ «إلى»، فلا يمكن أن تطابق أي سجلات. بدّل التاريخين أو صحّح أحدهما.
              <button type="button" onClick={() => { setFromDay(toDay); setToDay(fromDay); }} className="ms-2 underline text-blue-700">تبديل التاريخين</button>
            </p>
          )}
          <div>
            <label htmlFor="audit-user-filter" className="block text-2xs font-bold text-slate-600 mb-1">المستخدم</label>
            <select id="audit-user-filter" value={userId} onChange={(e) => setUserId(e.target.value)} className={`${FIELD} min-w-48`}>
              <option value="ALL">كل المستخدمين</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-11 px-3 text-xs font-bold text-blue-700 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {/* Action quick tags */}
        {tab === 'AUDIT' && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 text-xs">
          <span className="text-2xs font-bold text-slate-600 me-1">تصفية سريعة:</span>
          {[
            { id: 'ALL', label: 'الكل' },
            { id: 'PUBLISH', label: 'نشر فوري' },
            { id: 'STATUS_CHANGE', label: 'تغيير حالة' },
            { id: 'CREATE', label: 'إنشاء' },
            { id: 'UPDATE', label: 'تعديل' },
            { id: 'DELETE', label: 'حذف' },
            { id: 'ROLE_CHANGE', label: 'تغيير دور' },
            { id: 'PERMISSION_OVERRIDE', label: 'استثناءات صلاحيات' },
            { id: 'USER_SUSPEND', label: 'تجميد' },
            { id: 'ROLE_UPDATE', label: 'تعديل دور' },
          ].map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => setSelectedAction(tag.id)}
              aria-pressed={selectedAction === tag.id}
              className={`min-h-11 sm:min-h-8 px-2.5 rounded-lg text-2xs font-bold transition-colors ${
                selectedAction === tag.id
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Audit Log Table */}
      {tab === 'AUDIT' ? (
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="جدول سجل التدقيق (يمكن تمريره أفقياً)">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3 px-4">التاريخ والوقت</th>
                <th className="py-3 px-3">المستخدم</th>
                <th className="py-3 px-3">الإجراء</th>
                <th className="py-3 px-3">العنصر</th>
                <th className="py-3 px-4">التفاصيل</th>
                <th className="py-3 px-3 whitespace-nowrap">عنوان IP</th>
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
                auditPage.visible.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 tabular-nums text-slate-500 whitespace-nowrap">
                      {fullTime(timeOf(log))}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-800 whitespace-nowrap" title={log.userId}>{log.userName}</div>
                    </td>
                    <td className="py-3 px-3">{getActionBadge(actionOf(log))}</td>
                    <td className="py-3 px-3 font-semibold text-slate-700">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-2xs">
                        {entityName(entityOf(log))}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 leading-relaxed max-w-md">
                      {log.severity === 'SECURITY' && <span className="inline-block me-1.5 text-2xs font-bold px-1.5 rounded bg-rose-100 text-rose-800">أمني</span>}
                      {readableAuditDetails(log.details)}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 text-2xs" dir="ltr">
                      {log.ipAddress || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ShowMore remaining={auditPage.remaining} onMore={auditPage.showMore} onAll={auditPage.showAll} noun="سجل" className="border-t border-slate-100" />
      </div>
      ) : (
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="جدول سجل النشاط (يمكن تمريره أفقياً)">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3 px-4">التاريخ والوقت</th>
                <th className="py-3 px-3">المستخدم</th>
                <th className="py-3 px-3">الإجراء</th>
                <th className="py-3 px-3">النوع</th>
                <th className="py-3 px-4">الملخص</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredActivity.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    لا يوجد نشاط يطابق معايير البحث أو التصفية الحالية.
                    {hasActiveFilters && (
                      <button type="button" onClick={handleResetFilters} className="text-blue-600 hover:underline font-bold mr-2">
                        إعادة تعيين الفلاتر
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                activityPage.visible.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 tabular-nums text-slate-500 whitespace-nowrap">{fullTime(a.timestamp)}</td>
                    <td className="py-3 px-3 font-bold text-slate-800">{a.userName}</td>
                    <td className="py-3 px-3">{getActionBadge(a.action)}</td>
                    <td className="py-3 px-3 font-semibold text-slate-700">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-2xs">{entityName(a.entityType)}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 leading-relaxed max-w-md">
                      {a.summaryAr}
                      {a.entityTitle && <span className="block text-2xs text-slate-500 mt-0.5">{a.entityTitle}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ShowMore remaining={activityPage.remaining} onMore={activityPage.showMore} onAll={activityPage.showAll} noun="سجل" className="border-t border-slate-100" />
      </div>
      )}
    </div>
  );
};
