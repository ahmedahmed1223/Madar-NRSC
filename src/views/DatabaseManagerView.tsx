import { appLocale, zoneOptions } from '../shared/dateFormat';
import React, { useState, useEffect, useRef } from 'react';
import { DatabaseErrorsPanel } from '../components/database/DatabaseErrorsPanel';
import { DatabaseEnginePanel } from '../components/database/DatabaseEnginePanel';
import { DatabaseOperationConfirmation, type DatabaseOperation } from '../components/database/DatabaseOperationConfirmation';
import type { BackupStatus, BackupRehearsal } from '../shared/databaseDiagnostics';
import { BackupReadinessEvidence } from '../components/settings/BackupReadinessSummary';
import {
  Database,
  Download,
  RotateCcw,
  Play,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon,
  FileCode,
  Clock,
  Sparkles,
  Layers,
  ChevronRight,
  Search,
  ShieldCheck,
  Archive,
  RefreshCw,
  X,
} from 'lucide-react';
import { DbStats, SqlQueryResult, DbBackupFileInfo } from '../types';
import { apiService } from '../services/api';
import { countLabel } from '../shared/arabicPlural';

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
  const [operation, setOperation] = useState<{ action: DatabaseOperation; fileName?: string } | null>(null);
  const [rehearsal, setRehearsal] = useState<BackupRehearsal | null>(null);
  const [rehearsing, setRehearsing] = useState<string | null>(null);
  const rehearsalGuard = useRef(false);
  const [backups, setBackups] = useState<DbBackupFileInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'console' | 'backups' | 'schema' | 'errors'>('backups');
  const [backupHealth, setBackupHealth] = useState<BackupStatus | null>(null);
  const [actionError, setActionError] = useState('');
  const [listError, setListError] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const backupGuard = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isPreparingOperation, setIsPreparingOperation] = useState(false);
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

  // Busy while the current state is checked; the confirmation dialog then holds the screen.
  const endOperation = () => {
    setOperation(null);
    setIsResetting(false);
    setIsPreparingOperation(false);
  };

  const handleReset = async () => {
    if (operation || isResetting || isPreparingOperation) return;
    setIsResetting(true);
    const current = await loadStats();
    // The dialog is modal; the opener stays enabled underneath so focus can return to it.
    setIsResetting(false);
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
        setFeedbackMessage(`تم إنشاء النسخة الاحتياطية الكاملة (القاعدة والملفات المرفوعة): ${created.fileName}`);
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

  const prepareOperation = async (action: 'restore' | 'download' | 'export', fileName?: string) => {
    if (operation || isResetting || isPreparingOperation) return;
    setIsPreparingOperation(true);
    const ok = await loadStats();
    setIsPreparingOperation(false);
    if (ok) setOperation({ action, fileName });
  };
  const handleRehearse = async (fileName: string) => {
    if (rehearsalGuard.current) return;
    rehearsalGuard.current = true; setRehearsing(fileName); setRehearsal(null); setActionError('');
    try {
      const result = await apiService.rehearseBackup(fileName);
      setRehearsal(result);
      setBackupHealth(current => current ? { ...current, lastRehearsal: { at: result.checkedAt, fileName: result.fileName } } : current);
    }
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
      {operation && <DatabaseOperationConfirmation action={operation.action} fileName={operation.fileName} totpRequired={stats?.confirmationTotpRequired === true} onClose={endOperation} onComplete={updated => {
        if (operation.action === 'download' || operation.action === 'export') {
          setFeedbackMessage(operation.action === 'download' ? `بدأ تنزيل ${operation.fileName}؛ سُجّل في سجل التدقيق.` : 'بدأ تنزيل ملف قاعدة البيانات؛ سُجّل في سجل التدقيق.');
          endOperation();
          return;
        }
        setStats(current => (current && updated ? { ...current, ...updated } : current));
        setFeedbackMessage(operation.action === 'restore' ? 'تمت استعادة قاعدة البيانات بنجاح' : 'تمت إعادة تهيئة قاعدة البيانات بنجاح');
        endOperation(); void loadBackups();
        if (consoleEnabled) void handleRunQuery(QUERY_PRESETS[0].sql);
      }}/>
      }
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">
            <Database className="w-5 h-5" aria-hidden="true" />
            النسخ الاحتياطي وقاعدة البيانات
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {stats ? (
              stats.isHealthy ? (
                <span role="status" className="inline-flex items-center gap-1.5 font-bold text-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  القاعدة سليمة ومتصلة
                </span>
              ) : (
                <span role="status" className="inline-flex items-center gap-1.5 font-bold text-rose-800">
                  <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  فحص السلامة لم ينجح
                </span>
              )
            ) : (
              <span role="status">{isLoading ? 'جارٍ فحص الحالة...' : 'الحالة غير معروفة'}</span>
            )}
            <span>آخر نسخة: {backupHealth?.lastSnapshotAt ? new Date(backupHealth.lastSnapshotAt).toLocaleString(appLocale(), zoneOptions()) : 'لا توجد نسخة مسجلة'}{backupHealth?.intervalHours === 0 && ' · النسخ التلقائي معطل'}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={isCreatingBackup || isPreparingOperation} onClick={() => void handleCreateBackup()} className="inline-flex items-center gap-2 px-4 min-h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold disabled:opacity-50"><ShieldCheck size={18} aria-hidden="true" />{isCreatingBackup ? 'جارٍ إنشاء النسخة الكاملة…' : 'نسخة احتياطية كاملة الآن'}</button>
          <button
            type="button"
            disabled={isPreparingOperation}
            onClick={() => void prepareOperation('export')}
            className="inline-flex items-center gap-2 px-4 min-h-11 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-bold"
            title="ملف القاعدة وحده (بلا الملفات المرفوعة)؛ يطلب تأكيد هويتك"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            تنزيل ملف القاعدة (.sqlite)
          </button>
          {stats?.resetEnabled && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isResetting || isPreparingOperation || isCreatingBackup}
              className="inline-flex items-center gap-2 px-4 min-h-11 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-800 text-sm font-bold disabled:opacity-50"
            >
              <RotateCcw className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} aria-hidden="true" />
              إعادة تهيئة وتعبئة
            </button>
          )}
        </div>
      </div>
      <DatabaseEnginePanel />
      {backupHealth && (backupHealth.overdue || !backupHealth.count || backupHealth.lastAttempt?.status === 'failed' || backupHealth.lastDelivery?.status === 'failed') && <div role="alert" className="border border-amber-300 bg-amber-50 text-amber-900 p-3 rounded-md text-sm space-y-1">
        {!backupHealth.count && <p>لا توجد نسخة احتياطية محفوظة؛ أنشئ نسخة قبل العمليات الحساسة.</p>}
        {backupHealth.overdue && <p>تأخر النسخ الاحتياطي عن الفترة المحددة ({backupHealth.intervalHours} ساعة).</p>}
        {backupHealth.lastAttempt?.status === 'failed' && <p>فشلت آخر محاولة لإنشاء النسخة الاحتياطية.</p>}
        {backupHealth.lastDelivery?.status === 'failed' && <p>فشلت آخر محاولة لإكمال حزمة الملفات أو إرسالها إلى الوجهة الخارجية.</p>}
      </div>}
      {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
      {listError && <p role="alert" className="text-sm text-red-700">{listError}</p>}
      {backupHealth?.incidents?.filter(incident => !incident.active && incident.recoveredAt).map(incident => <p key={incident.id} className="text-xs text-emerald-800">تمت معالجة تنبيه {incident.id === 'delivery-failure' ? 'الحزمة الكاملة' : incident.id === 'overdue' ? 'تأخر النسخ' : 'إنشاء النسخة'}: {new Date(incident.recoveredAt!).toLocaleString(appLocale(), zoneOptions())}</p>)}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-slate-200 bg-slate-200 text-xs">
        {([
          ['موقع التخزين', stats?.filePath || '—', true],
          ['حجم قاعدة البيانات', stats?.fileSizeFormatted || '—', true],
          ['الجداول', stats ? countLabel(stats.totalTables ?? 0, { one: 'جدول واحد', two: 'جدولان', few: 'جداول', many: 'جدولاً' }) : '—', false],
          ['السجلات المخزنة', stats ? countLabel(stats.totalRows || 0, { one: 'سجل واحد', two: 'سجلان', few: 'سجلات', many: 'سجلاً' }) : '—', false],
        ] as [string, string, boolean][]).map(([label, value, ltr]) => (
          <div key={label} className="bg-white p-3 min-w-0">
            <dt className="text-2xs text-slate-500 mb-0.5">{label}</dt>
            <dd className={`font-bold text-slate-900 truncate tabular-nums ${ltr ? 'font-mono text-left' : ''}`} dir={ltr ? 'ltr' : undefined} title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      {feedbackMessage && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-xs flex items-center gap-2 min-w-0 break-all">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div role="tablist" aria-label="أدوات قاعدة البيانات" className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(event.target as HTMLButtonElement); if (index < 0) return;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next].focus(); tabs[next].click();
      }}>
        {([
          { id: 'backups', label: `النسخ الاحتياطي (${backups.length})`, icon: Archive },
          { id: 'console', label: 'استعلامات SQL', icon: FileCode },
          { id: 'schema', label: 'هيكل قاعدة البيانات', icon: Layers },
          { id: 'errors', label: 'آخر أخطاء الخادم', icon: AlertCircle },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`database-tab-${t.id}`}
            aria-controls={`database-${t.id}`}
            aria-selected={activeTab === t.id}
            tabIndex={activeTab === t.id ? 0 : -1}
            onClick={() => setActiveTab(t.id)}
            className={`-mb-px flex items-center gap-2 px-4 min-h-11 border-b-2 text-sm font-bold whitespace-nowrap transition-colors ${
              activeTab === t.id ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <t.icon className="w-4 h-4" aria-hidden="true" />
            <span>{t.label}</span>
          </button>
        ))}
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
                <span className="text-2xs text-slate-500">انقر للفحص الفوري</span>
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
                  className="w-full pr-9 pl-8 py-2 text-xs bg-white border border-slate-300 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => handleInspectTable(table.name)}
                    className="w-full min-h-11 text-start p-3 rounded-xl border border-slate-100 hover:border-blue-200 bg-slate-50/50 hover:bg-blue-50/40 focus-visible:ring-2 focus-visible:ring-blue-500 transition-all flex items-center justify-between group"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-800 group-hover:text-blue-700 truncate">
                          {table.name}
                        </span>
                        <span className="text-2xs px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-mono">
                          {table.rowCount} صف
                        </span>
                      </span>
                      <span className="block text-2xs text-slate-500 truncate mt-1">
                        {table.columns.slice(0, 4).join(', ')}
                        {table.columns.length > 4 && ` +${table.columns.length - 4}`}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-blue-600 transition-transform group-hover:-translate-x-0.5 shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Query Presets */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-blue-600" />
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
                    className="w-full text-right p-2.5 rounded-xl border border-slate-100 hover:border-blue-200 bg-slate-50/50 hover:bg-blue-50/40 transition-all block"
                  >
                    <span className="text-xs font-bold text-slate-800 block mb-0.5">
                      {preset.title}
                    </span>
                    <span className="text-2xs text-slate-500 block truncate leading-tight">
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
                  <FileCode className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-slate-900">محرر استعلامات SQL الحي</h2>
                </div>
                <span className="text-2xs text-slate-500 font-mono">
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
                  className="w-full font-mono text-xs sm:text-sm bg-slate-950 text-emerald-400 p-4 rounded-xl border border-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-y leading-relaxed shadow-inner"
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
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 active:scale-95"
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
                  <span className="text-2xs text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    خطأ في الاستعلام
                  </span>
                ) : (
                  <span className="text-2xs text-emerald-700 font-medium flex items-center gap-1">
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
                          className="hover:bg-blue-50/30 transition-colors odd:bg-white even:bg-slate-50/40"
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
          {backupHealth && <BackupReadinessEvidence data={backupHealth} />}
          {rehearsal && <section className="border-y border-slate-200 py-4 space-y-2 text-sm" aria-label="نتيجة تجربة الاستعادة">
            <h3 className="font-bold">نتيجة تجربة الاستعادة</h3>
            <p className="text-emerald-800">لم تتغير قاعدة البيانات الحالية</p>
            <p>قاعدة البيانات سليمة ومتوافقة مع الإصدار {rehearsal.version}.</p>
            <p>{rehearsal.mediaVerified
              ? 'تمت مطابقة بصمات جميع ملفات الوسائط المشمولة في هذه النسخة.'
              : 'نتيجة قاعدة البيانات متاحة. لم تشمل التجربة التحقق من جميع ملفات الوسائط.'}</p>
            <p dir="ltr" className="text-xs font-mono break-all">SHA-256: {rehearsal.sha256}</p>
            <dl className="flex flex-wrap gap-4">{Object.entries(rehearsal.counts).map(([name, count]) => <div key={name} className="flex gap-2"><dt dir="ltr">{name}</dt><dd>{count}</dd></div>)}</dl>
          </section>}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Archive className="w-5 h-5 text-blue-600" />
                  نقاط الاستعادة
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  «نسخة احتياطية كاملة الآن» تنشئ ما ينشئه النسخ الدوري تماماً: لقطة للقاعدة، وحزمة معها كل الملفات المرفوعة وملخص SHA-256، ونسخة إلى المجلد الخارجي أو التخزين السحابي إن كانا مضبوطين. تظهر هنا لقطات القاعدة للفحص والتجربة والاستعادة.
                </p>
              </div>

              <button
                type="button"
                onClick={loadBackups}
                className="inline-flex items-center gap-2 min-h-11 px-3 text-sm font-bold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-300 shrink-0"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                تحديث القائمة
              </button>
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
                        لا توجد نسخ محفوظة بعد. انقر على «نسخة احتياطية كاملة الآن» لإنشاء أول نسخة.
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
                            <button type="button" aria-label="فحص سلامة النسخة" title="فحص سلامة النسخة" disabled={!!verifying || isPreparingOperation} onClick={() => void handleVerifyBackup(b.fileName)} className="p-3 border rounded-md disabled:opacity-50"><ShieldCheck size={18} className={verifying === b.fileName ? 'animate-pulse' : ''}/></button>
                            <button
                              type="button"
                              onClick={() => void prepareOperation('restore', b.fileName)}
                              aria-busy={isPreparingOperation}
                              disabled={isResetting || isCreatingBackup || !!verifying}
                              className="px-3 min-h-11 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 rounded-lg text-2xs font-bold transition-colors border border-amber-500/30 disabled:opacity-50"
                            >
                              استعادة هذه النسخة
                            </button>
                            <button
                              type="button"
                              disabled={isPreparingOperation}
                              onClick={() => void prepareOperation('download', b.fileName)}
                              aria-label="تنزيل النسخة"
                              className="p-3 min-h-11 min-w-11 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="تنزيل (يطلب تأكيد هويتك)"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-slate-600">يُحفظ كل تعديل فور حدوثه في ملف <strong className="text-slate-800 font-mono" dir="ltr">{stats?.filePath || 'newsroom.sqlite'}</strong>؛ النسخ الاحتياطية لقطات منه في أوقات محددة.</p>
          </div>
        </div>
      )}

      {/* Schema Inspector Tab */}
      {activeTab === 'schema' && (
        <div role="tabpanel" id="database-schema" aria-labelledby="database-tab-schema" className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
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
                  <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded-md border border-blue-200">
                    {tbl.name}
                  </span>
                  <span className="text-2xs text-slate-500 font-mono font-semibold">
                    {tbl.rowCount} سجل
                  </span>
                </div>

                <div className="space-y-1 text-xs">
                  <span className="text-2xs text-slate-500 block mb-1">الأعمدة ({tbl.columns.length}):</span>
                  <div className="flex flex-wrap gap-1">
                    {tbl.columns.map((c) => (
                      <span
                        key={c}
                        className="text-2xs font-mono px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-700"
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
                  className="w-full mt-2 py-1.5 text-center text-2xs text-blue-600 hover:text-blue-700 hover:bg-blue-50/60 rounded-lg font-bold transition-colors block border border-blue-200/50"
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
