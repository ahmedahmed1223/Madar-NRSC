import { appLocale, zoneOptions } from '../shared/dateFormat';
import React, { useState, useEffect, useRef } from 'react';
import { DatabaseErrorsPanel } from '../components/database/DatabaseErrorsPanel';
import { DatabaseOperationConfirmation } from '../components/database/DatabaseOperationConfirmation';
import type { BackupStatus, BackupRehearsal } from '../shared/databaseDiagnostics';
import {
  Database,
  Download,
  RotateCcw,
  Play,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon,
  HardDrive,
  FileCode,
  Clock,
  Sparkles,
  Layers,
  ChevronRight,
  Search,
  ShieldCheck,
  Archive,
  RefreshCw,
  Copy,
  X,
} from 'lucide-react';
import { DbStats, SqlQueryResult, DbBackupFileInfo } from '../types';
import { apiService } from '../services/api';

// Data is stored as JSON documents per collection in the `entities` table.
const QUERY_PRESETS = [
  {
    title: 'أحدث الأخبار',
    desc: 'آخر 5 أخبار مع حالتها ودرجة الأولوية',
    sql: "SELECT id, json_extract(data, '$.title') AS title, json_extract(data, '$.priority') AS priority, json_extract(data, '$.status') AS status, updated_at FROM entities WHERE collection = 'news' AND deleted = 0 ORDER BY updated_at DESC LIMIT 5;",
  },
  {
    title: 'البرامج وعدد الحلقات',
    desc: 'إجمالي الحلقات ومتوسط المدة لكل برنامج',
    sql: "SELECT json_extract(data, '$.programName') AS program_name, COUNT(*) AS episodes_count, AVG(json_extract(data, '$.durationMinutes')) AS avg_duration_min FROM entities WHERE collection = 'episodes' AND deleted = 0 GROUP BY program_name;",
  },
  {
    title: 'تحليل فقرات الرانداون',
    desc: 'أنواع الفقرات ومجموع مدتها بالثواني',
    sql: "SELECT json_extract(seg.value, '$.segmentType') AS segment_type, COUNT(*) AS count, SUM(json_extract(seg.value, '$.durationSeconds')) AS total_seconds FROM entities e, json_each(e.data, '$.rundown') seg WHERE e.collection = 'episodes' AND e.deleted = 0 GROUP BY segment_type;",
  },
  {
    title: 'حجم كل مجموعة بيانات',
    desc: 'عدد السجلات الفعالة في كل مجموعة',
    sql: "SELECT collection, COUNT(*) AS rows, MAX(updated_at) AS last_update FROM entities WHERE deleted = 0 GROUP BY collection ORDER BY rows DESC;",
  },
  {
    title: 'سجل التدقيق والأمان',
    desc: 'آخر العمليات الحساسة المنفذة في المنظومة',
    sql: "SELECT json_extract(data, '$.userName') AS user_name, json_extract(data, '$.actionType') AS action_type, json_extract(data, '$.severity') AS severity, json_extract(data, '$.timestamp') AS at FROM entities WHERE collection = 'auditLogs' ORDER BY position ASC LIMIT 10;",
  },
];

export const DatabaseManagerView: React.FC = () => {
  const [stats, setStats] = useState<(DbStats & { sqlConsoleEnabled?: boolean; resetEnabled?: boolean; confirmationTotpRequired?: boolean }) | null>(null);
  const [operation, setOperation] = useState<{ action: 'restore' | 'reset'; fileName?: string } | null>(null);
  const [rehearsal, setRehearsal] = useState<BackupRehearsal | null>(null);
  const [rehearsing, setRehearsing] = useState<string | null>(null);
  const rehearsalGuard = useRef(false);
  const [backups, setBackups] = useState<DbBackupFileInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'console' | 'backups' | 'schema' | 'errors'>('console');
  const [backupHealth, setBackupHealth] = useState<BackupStatus | null>(null);
  const [actionError, setActionError] = useState('');
  const [listError, setListError] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const backupGuard = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [activeQuery, setActiveQuery] = useState(QUERY_PRESETS[0].sql);
  const [isExecuting, setIsExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<SqlQueryResult | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getDbStats();
      setStats(data);
      return data;
    } catch (err: any) {
      setActionError('تعذر تحميل إحصاءات قاعدة البيانات');
    } finally {
      setIsLoading(false);
    }
  };

  const loadBackups = async () => {
    setListError('');
    try {
      const data = await apiService.getBackups();
      setBackups(data);
      setBackupHealth(await apiService.getBackupStatus());
    } catch (err) {
      setListError('تعذر تحديث قائمة النسخ الاحتياطية وحالتها');
    }
  };

  useEffect(() => {
    loadStats().then((data) => {
      // The console is disabled in production unless explicitly enabled.
      if (data?.sqlConsoleEnabled) handleRunQuery(QUERY_PRESETS[0].sql);
    });
    loadBackups();
  }, []);

  const consoleEnabled = stats?.sqlConsoleEnabled === true;

  const handleRunQuery = async (sqlToRun?: string) => {
    const sql = (sqlToRun || activeQuery).trim();
    if (!sql || stats?.sqlConsoleEnabled === false) return;

    setIsExecuting(true);
    try {
      const result = await apiService.executeSqlQuery(sql);
      setQueryResult(result);
    } catch (err: any) {
      setQueryResult({
        columns: ['Error'],
        values: [[err.message || 'خطأ غير متوقع أثناء تنفيذ الاستعلام']],
        rowCount: 0,
        executionTimeMs: 0,
        error: err.message,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = async () => {
    if (operation) return;
    const current = await loadStats();
    if (current?.resetEnabled) setOperation({ action: 'reset' });
  };

  const handleCreateBackup = async () => {
    if (backupGuard.current) return;
    backupGuard.current = true; setActionError(''); setFeedbackMessage(null);
    setIsCreatingBackup(true);
    try {
      const created = await apiService.createBackup();
      if (!created) throw new Error('لم يؤكد الخادم إنشاء النسخة');
      if (created) {
        setFeedbackMessage(`تم إنشاء النسخة الاحتياطية بنجاح: ${created.fileName}`);
        setTimeout(() => setFeedbackMessage(null), 5000);
        await loadBackups();
      }
    } catch (err: any) {
      setActionError('فشل إنشاء النسخة الاحتياطية؛ تحقق من مساحة التخزين والصلاحيات');
      await loadBackups();
    } finally {
      setIsCreatingBackup(false);
      backupGuard.current = false;
    }
  };

  const handleVerifyBackup = async (fileName: string) => {
    if (verifying) return;
    setVerifying(fileName); setActionError(''); setFeedbackMessage(null);
    try {
      const result = await apiService.verifyBackup(fileName);
      setFeedbackMessage(`النسخة سليمة: ${result.fileName} · SHA-256: ${result.sha256}`);
    } catch { setActionError('فشل فحص السلامة: النسخة غير موجودة أو تالفة أو غير متوافقة'); }
    finally { setVerifying(null); }
  };

  const handleRestoreBackup = async (fileName: string) => {
    if (operation) return;
    if (await loadStats()) setOperation({ action: 'restore', fileName });
  };
  const handleRehearse = async (fileName: string) => {
    if (rehearsalGuard.current) return;
    rehearsalGuard.current = true; setRehearsing(fileName); setRehearsal(null); setActionError('');
    try { setRehearsal(await apiService.rehearseBackup(fileName)); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'تعذرت تجربة الاستعادة'); }
    finally { rehearsalGuard.current = false; setRehearsing(null); }
  };

  const handleInspectTable = (tableName: string) => {
    const sql = `SELECT * FROM ${tableName} LIMIT 10;`;
    setActiveQuery(sql);
    if (consoleEnabled) handleRunQuery(sql);
  };

  const filteredTables = (stats?.tables || []).filter((t) =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-12 font-sans" dir="rtl">
      {operation && <DatabaseOperationConfirmation action={operation.action} fileName={operation.fileName} totpRequired={stats?.confirmationTotpRequired === true} onClose={() => setOperation(null)} onComplete={updated => {
        setStats(current => ({ ...current, ...updated }));
        setFeedbackMessage(operation.action === 'restore' ? 'تمت استعادة قاعدة البيانات بنجاح' : 'تمت إعادة تهيئة قاعدة البيانات بنجاح');
        setOperation(null); void loadBackups();
        if (consoleEnabled) void handleRunQuery(QUERY_PRESETS[0].sql);
      }}/>
      }
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600">آخر نسخة: {backupHealth?.lastSnapshotAt ? new Date(backupHealth.lastSnapshotAt).toLocaleString(appLocale(), zoneOptions()) : 'لا توجد نسخة مسجلة'}{backupHealth?.intervalHours === 0 && ' · النسخ التلقائي معطل'}</div>
        <button type="button" disabled={isCreatingBackup || isRestoringBackup} onClick={() => void handleCreateBackup()} className="inline-flex items-center gap-2 px-4 min-h-11 bg-emerald-700 text-white rounded-md text-sm disabled:opacity-50"><ShieldCheck size={18}/>{isCreatingBackup ? 'جار إنشاء النسخة...' : 'إنشاء نسخة احتياطية الآن'}</button>
      </div>
      {backupHealth && (backupHealth.overdue || !backupHealth.count || backupHealth.lastAttempt?.status === 'failed' || backupHealth.lastDelivery?.status === 'failed') && <div role="alert" className="border border-amber-300 bg-amber-50 text-amber-900 p-3 rounded-md text-sm space-y-1">
        {!backupHealth.count && <p>لا توجد نسخة احتياطية محفوظة؛ أنشئ نسخة قبل العمليات الحساسة.</p>}
        {backupHealth.overdue && <p>تأخر النسخ الاحتياطي عن الفترة المحددة ({backupHealth.intervalHours} ساعة).</p>}
        {backupHealth.lastAttempt?.status === 'failed' && <p>فشلت آخر محاولة لإنشاء النسخة الاحتياطية.</p>}
        {backupHealth.lastDelivery?.status === 'failed' && <p>فشلت آخر محاولة لإكمال حزمة الملفات أو إرسالها إلى الوجهة الخارجية.</p>}
      </div>}
      {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
      {listError && <p role="alert" className="text-sm text-red-700">{listError}</p>}
      {backupHealth?.incidents?.filter(incident => !incident.active && incident.recoveredAt).map(incident => <p key={incident.id} className="text-xs text-emerald-800">تمت معالجة تنبيه {incident.id === 'delivery-failure' ? 'الحزمة الكاملة' : incident.id === 'overdue' ? 'تأخر النسخ' : 'إنشاء النسخة'}: {new Date(incident.recoveredAt!).toLocaleString(appLocale(), zoneOptions())}</p>)}
      {/* Top Banner - Stitch Aesthetic */}
      <div className="bg-white rounded-2xl p-6 text-slate-900 shadow-2xs border border-slate-200 relative overflow-hidden">
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200">
                <Database className="w-3.5 h-3.5 text-indigo-600" />
                محرك SQLite 3 الأصلي
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                متصل ونشط على القرص
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              النسخ الاحتياطي وقاعدة البيانات
            </h1>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
              إدارة متكاملة لقاعدة بيانات المحطة الإخبارية؛ تدعم التخزين الدائم على ملف القرص الصلب، تنفيذ استعلامات SQL الفورية، ومزامنة الجداول والرانداون.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/v1/db/export"
              download
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-sm active:scale-95"
            >
              <Download className="w-4 h-4" />
              تحميل ملف SQLite (.sqlite)
            </a>

            {stats?.resetEnabled && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isResetting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all border border-slate-300 disabled:opacity-50 active:scale-95"
            >
              <RotateCcw className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} />
              إعادة تهيئة وتعبئة
            </button>
            )}
          </div>
        </div>

        {/* Database Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[11px] text-slate-500 block mb-1">مسار ملف التخزين</span>
            <span className="text-xs font-mono font-bold text-indigo-700 truncate block dir-ltr text-right">
              {stats?.filePath || '—'}
            </span>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[11px] text-slate-500 block mb-1">حجم قاعدة البيانات</span>
            <span className="text-xs font-mono font-bold text-slate-800">
              {stats?.fileSizeFormatted || '—'}
            </span>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[11px] text-slate-500 block mb-1">عدد الجداول العلائقية</span>
            <span className="text-xs font-mono font-bold text-slate-800">
              {stats?.totalTables ?? 0} جداول
            </span>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <span className="text-[11px] text-slate-500 block mb-1">إجمالي السجلات المخزنة</span>
            <span className="text-xs font-mono font-bold text-emerald-700">
              {stats?.totalRows || 0} سجل
            </span>
          </div>
        </div>
      </div>

      {feedbackMessage && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-xs flex items-center gap-2 min-w-0 break-all">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div role="tablist" aria-label="أدوات قاعدة البيانات" className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(event.target as HTMLButtonElement); if (index < 0) return;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next].focus(); tabs[next].click();
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('console')}
          role="tab" id="database-tab-console" aria-controls="database-console" aria-selected={activeTab === 'console'} tabIndex={activeTab === 'console' ? 0 : -1}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'console'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>استعلامات SQL</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('backups')}
          role="tab" id="database-tab-backups" aria-controls="database-backups" aria-selected={activeTab === 'backups'} tabIndex={activeTab === 'backups' ? 0 : -1}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'backups'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Archive className="w-4 h-4" />
          <span>النسخ الاحتياطي ({backups.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('schema')}
          role="tab" id="database-tab-schema" aria-controls="database-schema" aria-selected={activeTab === 'schema'} tabIndex={activeTab === 'schema' ? 0 : -1}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'schema'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>هيكل قاعدة البيانات</span>
        </button>
        <button type="button" role="tab" id="database-tab-errors" aria-controls="database-errors" aria-selected={activeTab === 'errors'} tabIndex={activeTab === 'errors' ? 0 : -1} onClick={() => setActiveTab('errors')} className={`flex items-center gap-2 px-4 min-h-11 rounded-md text-xs font-bold ${activeTab === 'errors' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><AlertCircle size={16}/>آخر أخطاء الخادم</button>
      </div>
      {activeTab === 'errors' && <DatabaseErrorsPanel/>}

      {activeTab === 'console' && (
        /* Main Grid: Tables Explorer on Left, SQL Console on Right */
        <div role="tabpanel" id="database-console" aria-labelledby="database-tab-console" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Tables Inspector */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TableIcon className="w-4 h-4 text-slate-700" />
                  <h2 className="text-sm font-bold text-slate-900">جداول المنظومة ({filteredTables.length})</h2>
                </div>
                <span className="text-[11px] text-slate-500">انقر للفحص الفوري</span>
              </div>

              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="db-table-search-input"
                  type="text"
                  aria-label="البحث عن جدول"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="ابحث عن جدول..."
                  autoComplete="off"
                  spellCheck="false"
                  className="w-full pr-9 pl-8 py-2 text-xs bg-white border border-slate-300 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                />
                {tableSearch && (
                  <button
                    type="button"
                    onClick={() => setTableSearch('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
                    title="مسح البحث"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {filteredTables.map((table) => (
                  <div
                    key={table.name}
                    onClick={() => handleInspectTable(table.name)}
                    className="p-3 rounded-xl border border-slate-100 hover:border-indigo-200 bg-slate-50/50 hover:bg-indigo-50/40 cursor-pointer transition-all flex items-center justify-between group"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-800 group-hover:text-indigo-700 truncate">
                          {table.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-mono">
                          {table.rowCount} صف
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-1">
                        {table.columns.slice(0, 4).join(', ')}
                        {table.columns.length > 4 && ` +${table.columns.length - 4}`}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-600 transition-transform group-hover:-translate-x-0.5 shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Query Presets */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900">استعلامات جاهزة وموصى بها</h2>
              </div>
              <div className="space-y-2">
                {QUERY_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveQuery(preset.sql);
                      handleRunQuery(preset.sql);
                    }}
                    className="w-full text-right p-2.5 rounded-xl border border-slate-100 hover:border-indigo-200 bg-slate-50/50 hover:bg-indigo-50/40 transition-all block"
                  >
                    <span className="text-xs font-bold text-slate-800 block mb-0.5">
                      {preset.title}
                    </span>
                    <span className="text-[11px] text-slate-500 block truncate leading-tight">
                      {preset.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Interactive SQL Query Console */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">محرر استعلامات SQL الحي</h2>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  اختصار التنفيذ: <kbd className="px-1.5 py-0.5 bg-slate-100 rounded-md border border-slate-300">Ctrl + Enter</kbd>
                </span>
              </div>

              {!consoleEnabled && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
                  محرر SQL معطل في بيئة الإنتاج لحماية البيانات. لتفعيله مؤقتاً اضبط المتغير ENABLE_SQL_CONSOLE=true على الخادم (استعلامات قراءة فقط).
                </div>
              )}

              {/* SQL Input Area */}
              <div className="relative">
                <textarea
                  id="db-sql-query-editor"
                  aria-label="محرر استعلامات SQL"
                  spellCheck="false"
                  autoCapitalize="none"
                  value={activeQuery}
                  disabled={!consoleEnabled}
                  onChange={(e) => setActiveQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleRunQuery();
                    }
                  }}
                  rows={5}
                  dir="ltr"
                  className="w-full font-mono text-xs sm:text-sm bg-slate-950 text-emerald-400 p-4 rounded-xl border border-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 resize-y leading-relaxed shadow-inner"
                  placeholder="اكتب استعلام SQL هنا (مثال: SELECT * FROM entities LIMIT 5;)..."
                />
              </div>

              {/* Execution Buttons & Stats Bar */}
              <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunQuery()}
                    disabled={isExecuting || !consoleEnabled}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 active:scale-95"
                  >
                    <Play className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : 'fill-current'}`} />
                    <span>{isExecuting ? 'جارِ التنفيذ...' : 'تشغيل الاستعلام'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveQuery('SELECT * FROM entities LIMIT 10;');
                    }}
                    className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    مسح
                  </button>
                </div>

                {queryResult && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-500">
                      عدد الصفوف: <strong className="text-slate-900 font-mono">{queryResult.rowCount}</strong>
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      زمن التنفيذ: <strong className="text-slate-900 font-mono">{queryResult.executionTimeMs}ms</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Results Table Section */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700">نتائج الاستعلام</h3>
                {queryResult?.error ? (
                  <span className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    خطأ في الاستعلام
                  </span>
                ) : (
                  <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تم الاسترجاع بنجاح
                  </span>
                )}
              </div>

              {queryResult?.error ? (
                <div className="p-6 bg-red-50/50 text-red-700 text-xs font-mono space-y-1">
                  <div className="font-bold">فشل تنفيذ الاستعلام:</div>
                  <div className="text-red-600">{queryResult.error}</div>
                </div>
              ) : queryResult && queryResult.columns.length > 0 ? (
                <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead className="bg-slate-100/80 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        {queryResult.columns.map((col, idx) => (
                          <th
                            key={idx}
                            className="py-2.5 px-4 font-mono font-bold text-slate-700 whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {queryResult.values.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          className="hover:bg-indigo-50/30 transition-colors odd:bg-white even:bg-slate-50/40"
                        >
                          {row.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className="py-2.5 px-4 text-slate-800 whitespace-nowrap max-w-xs truncate"
                              title={String(cell ?? '')}
                            >
                              {cell === null ? (
                                <span className="text-slate-500 italic">NULL</span>
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-slate-500 text-xs">
                  لا توجد بيانات مسترجعة. اكتب استعلام SQL ثم اضغط "تشغيل الاستعلام".
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Backups & Snapshots Tab */}
      {activeTab === 'backups' && (
        <div role="tabpanel" id="database-backups" aria-labelledby="database-tab-backups" className="space-y-6 min-w-0">
          {rehearsal && <section className="border-y border-slate-200 py-4 space-y-2 text-sm" aria-label="نتيجة تجربة الاستعادة">
            <h3 className="font-bold">نتيجة تجربة الاستعادة</h3>
            <p className="text-emerald-800">لم تتغير قاعدة البيانات الحالية</p>
            <p>نسخة سليمة ومتوافقة مع الإصدار {rehearsal.version}. لم يتم التحقق من ملفات الوسائط أو الخدمات الخارجية.</p>
            <p dir="ltr" className="text-xs font-mono break-all">SHA-256: {rehearsal.sha256}</p>
            <dl className="flex flex-wrap gap-4">{Object.entries(rehearsal.counts).map(([name, count]) => <div key={name} className="flex gap-2"><dt dir="ltr">{name}</dt><dd>{count}</dd></div>)}</dl>
          </section>}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Archive className="w-5 h-5 text-indigo-600" />
                  نقاط الاستعادة والنسخ الاحتياطي لقاعدة البيانات
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  إنشاء لقطات فورية لملف SQLite وحفظها في مجلد <code className="px-1.5 py-0.5 bg-slate-100 rounded text-indigo-700 font-mono">data/backups/</code> للاسترجاع السريع في حالات الطوارئ.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={loadBackups}
                  className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                  title="تحديث القائمة"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={isCreatingBackup || isRestoringBackup}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isCreatingBackup ? 'جارِ إنشاء النسخة...' : 'إنشاء نقطة استعادة فورية'}</span>
                </button>
              </div>
            </div>

            {/* Backups Table */}
            <div className="mt-6 overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-bold">اسم ملف النسخة</th>
                    <th className="py-3 px-4 font-bold">تاريخ الإنشاء</th>
                    <th className="py-3 px-4 font-bold">الحجم</th>
                    <th className="py-3 px-4 font-bold text-left">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-slate-500">
                        لا توجد نقاط استعادة محفوظة بعد. انقر على "إنشاء نقطة استعادة فورية" لتسجيل نسخة جديدة.
                      </td>
                    </tr>
                  ) : (
                    backups.map((b) => (
                      <tr key={b.fileName} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-slate-800 dir-ltr text-right">
                          {b.fileName}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {new Date(b.createdAt).toLocaleString(appLocale(), zoneOptions())}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 font-semibold">
                          {b.sizeFormatted}
                        </td>
                        <td className="py-3 px-4 text-left">
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" aria-label="تجربة الاستعادة" title="تجربة الاستعادة" disabled={!!rehearsing || !!verifying || isCreatingBackup || !!operation} onClick={() => void handleRehearse(b.fileName)} className="p-3 border rounded-md disabled:opacity-50"><Play size={18} className={rehearsing === b.fileName ? 'animate-pulse' : ''}/></button>
                            <button type="button" aria-label="فحص سلامة النسخة" title="فحص سلامة النسخة" disabled={!!verifying || isRestoringBackup} onClick={() => void handleVerifyBackup(b.fileName)} className="p-3 border rounded-md disabled:opacity-50"><ShieldCheck size={18} className={verifying === b.fileName ? 'animate-pulse' : ''}/></button>
                            <button
                              type="button"
                              onClick={() => handleRestoreBackup(b.fileName)}
                              disabled={isRestoringBackup || isCreatingBackup || !!verifying}
                              className="px-3 min-h-11 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 rounded-lg text-[11px] font-bold transition-colors border border-amber-500/30"
                            >
                              استعادة هذه النسخة
                            </button>
                            <a
                              href={`/api/v1/db/backups/download?fileName=${encodeURIComponent(b.fileName)}`}
                              aria-label="تحميل النسخة"
                              download
                              className="p-3 min-h-11 min-w-11 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="تحميل"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>يتم حفظ جميع التعديلات تلقائياً في ملف <strong className="text-slate-800 font-mono">data/newsroom.sqlite</strong> مع كل عملية تحرير.</span>
              </div>
              <span className="font-mono text-slate-500">ACID Compliant SQLite Engine</span>
            </div>
          </div>
        </div>
      )}

      {/* Schema Inspector Tab */}
      {activeTab === 'schema' && (
        <div role="tabpanel" id="database-schema" aria-labelledby="database-tab-schema" className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              مخطط الجداول والعلاقات العلائقية
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              تفاصيل وتوزيع الأعمدة والمفاتيح لكل جدول ضمن هيكل منظومة الأخبار والإنتاج التلفزيوني.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(stats?.tables || []).map((tbl) => (
              <div key={tbl.name} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-200">
                    {tbl.name}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono font-semibold">
                    {tbl.rowCount} سجل
                  </span>
                </div>

                <div className="space-y-1 text-xs">
                  <span className="text-[11px] text-slate-500 block mb-1">الأعمدة ({tbl.columns.length}):</span>
                  <div className="flex flex-wrap gap-1">
                    {tbl.columns.map((c) => (
                      <span
                        key={c}
                        className="text-[10px] font-mono px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-700"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('console');
                    handleInspectTable(tbl.name);
                  }}
                  className="w-full mt-2 py-1.5 text-center text-[11px] text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/60 rounded-lg font-bold transition-colors block border border-indigo-200/50"
                >
                  استعلام بيانات الجدول &larr;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
