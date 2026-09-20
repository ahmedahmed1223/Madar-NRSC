import React, { useState } from 'react';
import { Modal } from './Modal';
import { useSystemHealth } from '../../hooks/useSystemHealth';
import {
  ShieldCheck,
  Activity,
  HardDrive,
  Wifi,
  RefreshCw,
  Clock,
  AlertTriangle,
  FileCheck2,
  Sparkles,
  Zap,
  Trash2,
  Download,
  Server,
  Radio,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { ApiService } from '../../services/api';

interface SelfHealingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast?: (msg: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SelfHealingModal: React.FC<SelfHealingModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
}) => {
  const { report, networkState, isRepairing, triggerSelfHealing, triggerNetworkDrain } = useSystemHealth();
  const [activeTab, setActiveTab] = useState<'overview' | 'repairs' | 'storage' | 'network'>('overview');

  const handleRunRepair = async () => {
    const res = await triggerSelfHealing(true);
    if (onShowToast) {
      if (res.autoRepairsApplied.length > 0) {
        onShowToast(
          `تم اكتمال الفحص وتطبيق ${res.autoRepairsApplied.length} تحسينات وإصلاحات ذاتية بنجاح`,
          'success'
        );
      } else {
        onShowToast('تم فحص منظومة الأخبار بالكامل — كافة الجداول وقواعد البيانات سليمة 100%', 'info');
      }
    }
  };

  const handleDrainQueue = async () => {
    const res = await triggerNetworkDrain();
    if (onShowToast) {
      onShowToast(`تمت مزامنة ${res.synced} عمليات معلقة بنجاح`, 'success');
    }
  };

  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs} س ${mins} د ${secs} ث`;
  };

  const healthBadge = {
    EXCELLENT: { label: 'ممتاز - جاهز للبث 24/7', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    GOOD: { label: 'مستقر وجيد', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    DEGRADED: { label: 'تنبيه - تم تفعيل خط الدفاع', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    CRITICAL: { label: 'حرج - يتطلب تدخلاً', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  }[report.overallHealth];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="مركز الاستقرار والتعافي الذاتي للمنظومة (24/7 Self-Healing Hub)"
      size="xl"
    >
      <div className="space-y-6 text-right font-sans" dir="rtl">
        {/* Top Hero Banner */}
        <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute -top-12 -left-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner shrink-0">
                <ShieldCheck className="w-8 h-8 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${healthBadge.color}`}>
                    {healthBadge.label}
                  </span>
                  <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    وقت التشغيل المستمر: {formatUptime(report.uptimeSeconds)}
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-white mt-1 flex items-center gap-2">
                  <span>منظومة الحماية والتعافي الذاتي المستمر</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    24/7 ON-AIR ACTIVE
                  </span>
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <button
                type="button"
                onClick={handleRunRepair}
                disabled={isRepairing}
                className="w-full md:w-auto px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isRepairing ? 'animate-spin' : ''}`} />
                <span>{isRepairing ? 'جاري الفحص والمعالجة...' : 'إجراء فحص وإصلاح فوري'}</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800 text-xs">
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              <div className="text-slate-400 text-[11px]">معدل استقرار النظام</div>
              <div className="text-lg font-bold text-emerald-400 mt-0.5 font-mono">
                {report.healthScore}%
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              <div className="text-slate-400 text-[11px]">استهلاك التخزين المحلي</div>
              <div className="text-lg font-bold text-slate-200 mt-0.5 font-mono">
                {report.storageQuota.usedFormatted}
                <span className="text-xs text-slate-500 font-sans mr-1">
                  ({report.storageQuota.estimatedPercentage}%)
                </span>
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              <div className="text-slate-400 text-[11px]">زمن استجابة الخادم</div>
              <div className="text-lg font-bold text-blue-400 mt-0.5 font-mono">
                {networkState.latencyMs > 0 ? `${networkState.latencyMs} ms` : 'مباشر (محلي)'}
              </div>
            </div>
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              <div className="text-slate-400 text-[11px]">عمليات المزامنة المعلقة</div>
              <div className="text-lg font-bold text-amber-400 mt-0.5 font-mono">
                {networkState.pendingMutationsCount}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 text-xs font-semibold gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>نظرة عامة على الركائز</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('repairs')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'repairs'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>سجل المعالجات التلقائية ({report.autoRepairsApplied.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'storage'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>إدارة التخزين والتفريغ الذاتي</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('network')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'network'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>المرونة ضد انقطاع الشبكة</span>
          </button>
        </div>

        {/* Tab 1: Overview of 4 Resilience Pillars */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pillar 1: Data Integrity */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <FileCheck2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-xs">تكامل وهيكلة البيانات</h3>
                    <p className="text-[11px] text-slate-500">فحص الجداول والعلاقات وتوقيتات الرانداون</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                  سليم ومحمي
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-100 text-slate-600">
                <div>الأخبار المفحوصة: <strong className="text-slate-800">{report.integrityStatus.newsItemsChecked}</strong></div>
                <div>الحلقات المسجلة: <strong className="text-slate-800">{report.integrityStatus.episodesChecked}</strong></div>
                <div>فقرات الرانداون: <strong className="text-slate-800">{report.integrityStatus.rundownsChecked}</strong></div>
                <div>سجل الضيوف: <strong className="text-slate-800">{report.integrityStatus.guestsChecked}</strong></div>
              </div>
            </div>

            {/* Pillar 2: Storage & GC */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-xs">حصص الذاكرة والتفريغ التلقائي</h3>
                    <p className="text-[11px] text-slate-500">حماية ضد امتلاء LocalStorage ومنع الانهيار</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold">
                  GC مفعّل
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mt-2">
                <div
                  className={`h-full rounded-full transition-all ${
                    report.storageQuota.estimatedPercentage > 75 ? 'bg-amber-500' : 'bg-blue-600'
                  }`}
                  style={{ width: `${Math.max(5, report.storageQuota.estimatedPercentage)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>المستخدم: {report.storageQuota.usedFormatted}</span>
                <span>الحد الآمن المقدر: 5 MB</span>
              </div>
            </div>

            {/* Pillar 3: Network & Offline Resilience */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Wifi className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-xs">نبض الاتصال والمزامنة 24/7</h3>
                    <p className="text-[11px] text-slate-500">مراقبة الرابط وقائمة العمليات غير المتصلة</p>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    networkState.isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {networkState.isOnline ? 'متصل ومراقب' : 'وضع محلي مرن'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 text-slate-600">
                <span>فحص النبض المستمر: <strong>كل 20 ثانية</strong></span>
                {networkState.pendingMutationsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleDrainQueue}
                    className="text-indigo-600 hover:text-indigo-800 font-bold text-[10px] underline"
                  >
                    مزامنة الآن ({networkState.pendingMutationsCount})
                  </button>
                )}
              </div>
            </div>

            {/* Pillar 4: Zero-Data-Loss Draft Vault */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-xs">خزنة استعادة المسودات والتحرير</h3>
                    <p className="text-[11px] text-slate-500">حفظ تلقائي للفقرات والأخبار لمنع فقدان العمل</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">
                  حفظ دوري نشط
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed pt-1">
                يتم التقاط لقطات فورية أثناء الكتابة واستعادتها آلياً في حال انقطاع التيار أو إغلاق المتصفح المفاجئ.
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Auto Repairs Log */}
        {activeTab === 'repairs' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>سجل التدخلات الذاتية والإصلاحات الوقائية المنفذة:</span>
              <span className="text-[11px] text-slate-400">تحديث تلقائي مستمر</span>
            </div>

            {report.autoRepairsApplied.length === 0 ? (
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <div className="text-xs font-bold text-slate-700">المنظومة تعمل بكفاءة تامة</div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  لم يتم رصد أي أخطاء هيكلية أو انحراف في التوقيتات، وجميع السجلات متوافقة مع معايير البث 24/7.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {report.autoRepairsApplied.map((rep, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl text-xs flex items-start gap-2.5 text-emerald-900"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{rep}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Storage Management */}
        {activeTab === 'storage' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-800">
                <span>سعة التخزين المحلي المحمي (LocalStorage Safe Storage)</span>
                <span className="font-mono">{report.storageQuota.usedFormatted}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-emerald-600 h-full rounded-full transition-all"
                  style={{ width: `${Math.max(5, report.storageQuota.estimatedPercentage)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                تقوم خوارزمية التعافي الذاتي بتفريغ المسودات المؤقتة وسجلات التتبع القديمة تلقائياً دون المساس بالأخبار أو الحلقات الفعلية عند اقتراب السعة من الحد الحرج.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-600 font-semibold">الإجراءات الاحتياطية والطوارئ:</span>
              <button
                type="button"
                onClick={() => {
                  const dataStr = ApiService.exportClientBackup();
                  const blob = new Blob([dataStr], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `newsroom_backup_emergency_${Date.now()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  if (onShowToast) onShowToast('تم تصدير ملف النسخة الاحتياطية بنجاح', 'success');
                }}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>تصدير نسخة طوارئ (JSON)</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 4: Network Resilience */}
        {activeTab === 'network' && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">حالة الربط والنبض مع السيرفر:</span>
                <span className="font-mono text-emerald-600 font-bold">
                  {networkState.serverReachable ? 'متصل ونشط' : 'غير متصل (الوضع المحلي آمن)'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600 text-[11px]">
                <span>زمن الاستجابة التقديري:</span>
                <span className="font-mono font-bold">{networkState.latencyMs} ms</span>
              </div>
              <div className="flex items-center justify-between text-slate-600 text-[11px]">
                <span>آخر استجابة ناجحة (Heartbeat):</span>
                <span className="font-mono">{networkState.lastHeartbeat ? new Date(networkState.lastHeartbeat).toLocaleTimeString('ar-SA') : 'الآن'}</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 space-y-2">
              <div className="flex items-center justify-between font-bold text-indigo-900">
                <span>طابور المزامنة التلقائية عند عودة الاتصال:</span>
                <span className="font-mono bg-indigo-200/80 px-2 py-0.5 rounded text-indigo-900">
                  {networkState.pendingMutationsCount} عمليات معلقة
                </span>
              </div>
              <p className="text-[11px] text-indigo-700 leading-relaxed">
                أي تعديلات يتم إجراؤها أثناء انقطاع الإنترنت أو بطء الشبكة تُحفظ محلياً وتُرفع تلقائياً وبترتيب زمني دقيق فور عودة الاتصال لمنع تضارب البيانات.
              </p>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span className="font-mono text-[11px]">NRCS Engine v2.5 • 24/7 Continuous Broadcast Assurance</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </Modal>
  );
};
