import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { DbStats, SqlQueryResult, DbBackupFileInfo } from '../types';
import { apiService } from '../services/api';

const QUERY_PRESETS = [
  {
    title: 'أحدث الأخبار المنشورة',
    desc: 'استعراض آخر 5 أخبار مع حالتها ودرجة الأولوية',
    sql: 'SELECT id, title, priority, status, created_at FROM news ORDER BY created_at DESC LIMIT 5;',
  },
  {
    title: 'البرامج وعدد الحلقات',
    desc: 'تجميع إجمالي الحلقات ومتوسط المدة لكل برنامج',
    sql: 'SELECT program_name, COUNT(*) as episodes_count, AVG(duration_minutes) as avg_duration_min FROM episodes GROUP BY program_name;',
  },
  {
    title: 'تحليل فقرات الرانداون',
    desc: 'إحصاء أنواع الفقرات التلفزيونية ومجموع مدتها بالثواني',
    sql: 'SELECT segment_type, COUNT(*) as count, SUM(duration_seconds) as total_seconds FROM rundown_segments GROUP BY segment_type;',
  },
  {
    title: 'بنك الضيوف والأكثر مشاركة',
    desc: 'الضيوف الأكثر ظهوراً وتقييمهم ومؤسساتهم',
    sql: 'SELECT full_name, organization, specialty, appearances_count, rating FROM guests ORDER BY appearances_count DESC LIMIT 5;',
  },
  {
    title: 'سجل التدقيق والأمان',
    desc: 'آخر العمليات الإدارية المنفذة في المنظومة',
    sql: 'SELECT user_name, action, action_type, severity, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 5;',
  },
];

export const DatabaseManagerView: React.FC = () => {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [backups, setBackups] = useState<DbBackupFileInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'console' | 'backups' | 'schema'>('console');
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
    } catch (err) {
      console.error('Failed to load DB stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadBackups = async () => {
    try {
      const data = await apiService.getBackups();
      setBackups(data);
    } catch (err) {
      console.error('Failed to load backups:', err);
    }
  };

  useEffect(() => {
    loadStats();
    loadBackups();
    // Run default query
    handleRunQuery(QUERY_PRESETS[0].sql);
  }, []);

  const handleRunQuery = async (sqlToRun?: string) => {
    const sql = (sqlToRun || activeQuery).trim();
    if (!sql) return;

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
    if (!window.confirm('هل أنت متأكد من رغبتك في إعادة تهيئة قاعدة البيانات SQLite وتعبئتها بالبيانات القياسية الأولية؟')) {
      return;
    }
    setIsResetting(true);
    try {
      const updated = await apiService.resetDatabase();
      setStats(updated);
      setFeedbackMessage('تمت إعادة تهيئة قاعدة بيانات SQLite بنجاح');
      setTimeout(() => setFeedbackMessage(null), 4000);
      handleRunQuery(QUERY_PRESETS[0].sql);
      loadBackups();
    } catch (err: any) {
      alert('فشلت إعادة التهيئة: ' + err.message);
    } finally {
      setIsResetting(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      const created = await apiService.createBackup();
      if (created) {
        setFeedbackMessage(`تم إنشاء النسخة الاحتياطية بنجاح: ${created.fileName}`);
        setTimeout(() => setFeedbackMessage(null), 5000);
        await loadBackups();
      }
    } catch (err: any) {
      alert('فشل إنشاء النسخة الاحتياطية: ' + err.message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (fileName: string) => {
    if (!window.confirm(`هل أنت متأكد من استعادة قاعدة البيانات من النسخة: ${fileName}؟ سيتم استبدال البيانات الحالية.`)) {
      return;
    }
    setIsRestoringBackup(true);
    try {
      const updatedStats = await apiService.restoreBackup(fileName);
      setStats(updatedStats);
      setFeedbackMessage(`تمت استعادة قاعدة البيانات بنجاح من: ${fileName}`);
      setTimeout(() => setFeedbackMessage(null), 5000);
      handleRunQuery(QUERY_PRESETS[0].sql);
    } catch (err: any) {
      alert('فشلت استعادة النسخة الاحتياطية: ' + err.message);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleInspectTable = (tableName: string) => {
    const sql = `SELECT * FROM ${tableName} LIMIT 10;`;
    setActiveQuery(sql);
    handleRunQuery(sql);
  };

  const filteredTables = (stats?.tables || []).filter((t) =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-12 font-sans" dir="rtl">
      {/* Top Banner - Stitch Aesthetic */}
      <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-md border border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold border border-indigo-500/30">
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                محرك SQLite 3 الأصلي
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                متصل ونشط على القرص
              </span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              إدارة قاعدة البيانات ووحدة استعلامات SQLite
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
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

            <button
              type="button"
              onClick={handleReset}
              disabled={isResetting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all border border-slate-700 disabled:opacity-50 active:scale-95"
            >
              <RotateCcw className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} />
              إعادة تهيئة وتعبئة
            </button>
          </div>
        </div>

        {/* Database Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">مسار ملف التخزين</span>
            <span className="text-xs font-mono font-bold text-indigo-300 truncate block dir-ltr text-right">
              {stats?.filePath || 'data/newsroom.sqlite'}
            </span>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">حجم قاعدة البيانات</span>
            <span className="text-xs font-mono font-bold text-slate-200">
              {stats?.fileSizeFormatted || '100.0 KB'}
            </span>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">عدد الجداول العلائقية</span>
            <span className="text-xs font-mono font-bold text-slate-200">
              {stats?.totalTables || 9} جداول
            </span>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي السجلات المخزنة</span>
            <span className="text-xs font-mono font-bold text-emerald-400">
              {stats?.totalRows || 0} سجل
            </span>
          </div>
        </div>
      </div>

      {feedbackMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('console')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'console'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>محرر استعلامات SQL وفاحص الجداول</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('backups')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'backups'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Archive className="w-4 h-4" />
          <span>النسخ الاحتياطي ونقاط الاستعادة ({backups.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('schema')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'schema'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>مخطط وهيكل قاعدة البيانات (Schema)</span>
        </button>
      </div>

      {activeTab === 'console' && (
        /* Main Grid: Tables Explorer on Left, SQL Console on Right */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Tables Inspector */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TableIcon className="w-4 h-4 text-slate-700" />
                  <h2 className="text-sm font-bold text-slate-900">جداول المنظومة ({filteredTables.length})</h2>
                </div>
                <span className="text-[11px] text-slate-400">انقر للفحص الفوري</span>
              </div>

              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="ابحث عن جدول..."
                  className="w-full pl-3 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
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
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-transform group-hover:-translate-x-0.5 shrink-0" />
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

              {/* SQL Input Area */}
              <div className="relative">
                <textarea
                  value={activeQuery}
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
                  placeholder="اكتب استعلام SQL هنا (مثال: SELECT * FROM news LIMIT 5;)..."
                />
              </div>

              {/* Execution Buttons & Stats Bar */}
              <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunQuery()}
                    disabled={isExecuting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 active:scale-95"
                  >
                    <Play className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : 'fill-current'}`} />
                    <span>{isExecuting ? 'جارِ التنفيذ...' : 'تشغيل الاستعلام'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveQuery('SELECT * FROM news LIMIT 10;');
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
                      <Clock className="w-3 h-3 text-slate-400" />
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
                  <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
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
                                <span className="text-slate-400 italic">NULL</span>
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
                <div className="py-12 text-center text-slate-400 text-xs">
                  لا توجد بيانات مسترجعة. اكتب استعلام SQL ثم اضغط "تشغيل الاستعلام".
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Backups & Snapshots Tab */}
      {activeTab === 'backups' && (
        <div className="space-y-6">
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
                  disabled={isCreatingBackup}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isCreatingBackup ? 'جارِ إنشاء النسخة...' : 'إنشاء نقطة استعادة فورية'}</span>
                </button>
              </div>
            </div>

            {/* Backups Table */}
            <div className="mt-6 overflow-hidden border border-slate-200 rounded-xl">
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
                      <td colSpan={4} className="py-10 text-center text-slate-400">
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
                          {new Date(b.createdAt).toLocaleString('ar-SA')}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 font-semibold">
                          {b.sizeFormatted}
                        </td>
                        <td className="py-3 px-4 text-left">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleRestoreBackup(b.fileName)}
                              disabled={isRestoringBackup}
                              className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 rounded-lg text-[11px] font-bold transition-colors border border-amber-500/30"
                            >
                              استعادة هذه النسخة
                            </button>
                            <a
                              href={`/api/v1/db/export`}
                              download
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
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
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>يتم حفظ جميع التعديلات تلقائياً في ملف <strong className="text-slate-800 font-mono">data/newsroom.sqlite</strong> مع كل عملية تحرير.</span>
              </div>
              <span className="font-mono text-slate-400">ACID Compliant SQLite Engine</span>
            </div>
          </div>
        </div>
      )}

      {/* Schema Inspector Tab */}
      {activeTab === 'schema' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              مخطط الجداول والعلاقات العلائقية (Relational Schema)
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
                  <span className="text-[11px] text-slate-400 block mb-1">الأعمدة ({tbl.columns.length}):</span>
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
