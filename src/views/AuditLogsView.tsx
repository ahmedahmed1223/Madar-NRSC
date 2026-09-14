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
} from 'lucide-react';
import { AuditLog } from '../types';
import { Badge } from '../components/common/Badge';

interface AuditLogsViewProps {
  logs: AuditLog[];
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ logs = [] }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('ALL');

  const filteredLogs = (logs || []).filter((log) => {
    if (selectedAction !== 'ALL' && log.action !== selectedAction) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        log.userName.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.entityType.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'PUBLISH':
        return <Badge variant="success" size="sm">نشر فوري (PUBLISH)</Badge>;
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
        return <Badge variant="default" size="sm">{action}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-600" />
          <span>سجل التدقيق الأمني والتحريري (Audit Trail)</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          تسجيل غير قابل للتعديل لجميع العمليات والاعتمادات والنشر وتغيير الصلاحيات في النظام
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالموظف، تفاصيل الإجراء، أو الكيان..."
            className="w-full pr-9 pl-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 shrink-0">نوع الإجراء:</span>
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
          >
            <option value="ALL">جميع الإجراءات</option>
            <option value="PUBLISH">نشر</option>
            <option value="STATUS_CHANGE">تغيير حالة</option>
            <option value="CREATE">إنشاء</option>
            <option value="UPDATE">تعديل</option>
            <option value="DELETE">حذف</option>
            <option value="LOGIN">دخول</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
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
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                    {log.createdAt ? log.createdAt.replace('T', ' ').slice(0, 19) : ''}
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-800">{log.userName}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{log.userId}</div>
                  </td>
                  <td className="py-3 px-3">{getActionBadge(log.action)}</td>
                  <td className="py-3 px-3 font-semibold text-slate-700">
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                      {log.entityType}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-700 leading-relaxed max-w-md">
                    {log.details}
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-400 text-[11px]" dir="ltr">
                    {log.ipAddress || '192.168.1.50'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
