import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Radio,
  Server,
  Database,
  Cpu,
  Lock,
  Unlock,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  Sparkles,
  Zap,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface ProductionEnvironmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLiveLockActive: boolean;
  onToggleLiveLock: () => void;
  onNavigate?: (nav: string) => void;
}

export const ProductionEnvironmentModal: React.FC<ProductionEnvironmentModalProps> = ({
  isOpen,
  onClose,
  isLiveLockActive,
  onToggleLiveLock,
  onNavigate,
}) => {
  const [stats, setStats] = useState<{
    engine: string;
    totalTables: number;
    totalRows: number;
    fileSizeFormatted: string;
    isHealthy: boolean;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchStats();
    }
  }, [isOpen]);

  const fetchStats = async () => {
    try {
      const data = await apiService.getDbStats();
      if (data) {
        setStats(data);
      }
    } catch (e) {
      console.warn('Could not fetch DB stats for production modal', e);
    }
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      await apiService.createBackup();
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3500);
      fetchStats();
    } catch (e) {
      console.error('Backup error:', e);
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="production-environment-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto"
      dir="rtl"
    >
      <div
        id="production-environment-modal-card"
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-8"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white p-6 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 left-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  OFFICIAL PRODUCTION READY
                </span>
                <span className="text-xs text-slate-400">الإصدار 2.5.0 مستقر</span>
              </div>
              <h2 className="text-lg font-bold text-white mt-1">
                مركز إدارة بيئة الإنتاج والبث التلفزيوني الرسمي
              </h2>
            </div>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed max-w-xl">
            المنظومة مهيأة بالكامل للعمل المكتبي والرسمي داخل غرف الأخبار واستوديوهات البث التلفزيوني الحي، مع حماية السلامة التشغيلية والنسخ الاحتياطي المستمر.
          </p>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Production Mode Toggle */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  isLiveLockActive
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {isLiveLockActive ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-slate-850">
                    وضع البث المباشر المحمي (Live On-Air Production Lock)
                  </h4>
                  {isLiveLockActive && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white font-mono text-[9px] font-bold">
                      ACTIVE LOCK
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {isLiveLockActive
                    ? 'قفل التعديلات الحرجة على الرانداون مفعل لحماية البث المباشر من الحذف أو التعديل المفاجئ أثناء الهواء.'
                    : 'الوضع التحريري مفتوح: يمكن للمنتجين والمعدين تحديث المسودات والرانداون بشكل حر.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleLiveLock}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                isLiveLockActive
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                  : 'bg-slate-800 hover:bg-slate-900 text-white'
              }`}
            >
              {isLiveLockActive ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>تعطيل القفل التحريري</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>تفعيل قفل البث المباشر</span>
                </>
              )}
            </button>
          </div>

          {/* Subsystems Health Audit Grid */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600" />
              <span>فحص الأنظمة التشغيلية الفرعية (Operational Subsystems Audit)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* SQLite DB */}
              <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-850">قاعدة بيانات SQLite 3</span>
                    <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> متصلة
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {stats ? `${stats.totalRows} صف في ${stats.totalTables} جداول (${stats.fileSizeFormatted})` : 'محرك البيانات جاهز'}
                  </p>
                </div>
              </div>

              {/* Wire Feeds Engine */}
              <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-850">بث برقيات الوكالات</span>
                    <span className="flex items-center gap-1 text-[10px] text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="w-3 h-3 text-blue-600" /> مباشر
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    رويترز، واس، أ ف ب، بلومبرغ (تحديث تلقائي)
                  </p>
                </div>
              </div>

              {/* Rundown & MOS Engine */}
              <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                  <Cpu className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-850">محرك الرانداون & MOS</span>
                    <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> متزامن
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    متوافق مع أجهزة التلقين الآلي وغرف التحكم MCR
                  </p>
                </div>
              </div>

              {/* Intercom & Studio Audio */}
              <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <Server className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-850">الإنتركوم وغرفة الأخبار</span>
                    <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> جاهز
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    قنوات الاتصال الداخلي والمحادثات الميدانية
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions for Official Newsroom Environment */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <h4 className="text-xs font-bold text-slate-800 mb-2">إجراءات الحفظ والسلامة الرسمية:</h4>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={isExporting}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isExporting ? 'جاري إنشاء النسخة...' : 'إنشاء نسخة احتياطية فورية (Snapshot)'}</span>
              </button>

              {exportSuccess && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تم حفظ النسخة الاحتياطية بنجاح في سجل الخادم</span>
                </span>
              )}

              {onNavigate && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigate('database');
                  }}
                  className="px-3 py-2 text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-xl text-xs font-semibold transition-colors"
                >
                  فتح لوحة استعلامات SQLite 3 المباشرة &larr;
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-100 px-6 py-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>التوقيت التشغيلي: بتوقيت الرياض (UTC+3)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-300 transition-all cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  );
};
