import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Settings2, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { notify } from '../../services/notify';
import { setupCommand } from '../../services/uiEvents';

const LABELS: Record<string, string> = {
  news: 'أخبار',
  stories: 'تغطيات',
  breaking: 'عاجل',
  programs: 'برامج',
  episodes: 'حلقات',
  guests: 'ضيوف',
  tasks: 'مهام',
  media: 'وسائط',
  notifications: 'إشعارات',
  activityLogs: 'سجل النشاط',
  auditLogs: 'سجل التدقيق',
  bulletinFormats: 'قوالب نشرات',
  bulletins: 'نشرات',
  bulletinStories: 'قصص نشرات',
  resources: 'موارد',
  diary: 'أحداث الأجندة',
  bookings: 'حجوزات',
};

type Info = Awaited<ReturnType<typeof apiService.getDemoDataInfo>>;

/** Removes the sample content shipped for demos, so the newsroom starts clean. */
export const DemoDataCard: React.FC = () => {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [includeUsers, setIncludeUsers] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiService
      .getDemoDataInfo()
      .then((d) => {
        setInfo(d);
        setError('');
      })
      .catch((e) => setError(e?.message || 'تعذر قراءة البيانات التجريبية'));
  useEffect(() => {
    load();
  }, []);

  const total = info ? Object.values(info.counts).reduce((a, b) => a + b, 0) : 0;
  const nothingLeft = !!info && total === 0 && info.users.length === 0;
  const selectedCount = total + (includeUsers ? info?.users.length || 0 : 0);

  const remove = async () => {
    setBusy(true);
    try {
      const { total: n, setupReviewId } = await apiService.removeDemoData(includeUsers, confirm.trim());
      if (n > 0) {
        notify({ type: 'success', title: 'حُذفت البيانات التجريبية', message: `حُذف ${n} سجلاً، وحُفظت نسخة احتياطية قبل الحذف.` });
      } else {
        notify({ type: 'info', title: 'لا توجد بيانات تجريبية محددة للحذف', message: 'يمكنك مراجعة إعدادات المؤسسة في المعالج.' });
      }
      setConfirm('');
      setupCommand.emit(setupReviewId ? { reviewId: setupReviewId } : 'review');
      await load();
    } catch (e: any) {
      notify({ type: 'error', title: 'تعذر الحذف', message: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4" data-testid="demo-data-card">
      <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
        <Trash2 className="w-4 h-4 text-rose-600" />
        <span>البيانات التجريبية</span>
      </h3>
      <p className="text-sm text-slate-700 leading-relaxed">
        البيانات التجريبية هي أمثلة تأتي مع نسخة العرض، مثل الأخبار والنشرات والحلقات والمهام والحجوزات. يعرض هذا القسم الأعداد المتاحة للحذف.
        تبقى إعدادات المؤسسة والمحطات والتصنيفات والمصادر والأدوار محفوظة.
      </p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {!info && !error && <p className="text-xs text-slate-500">جارٍ الفحص...</p>}
      {info && nothingLeft && (
        <p className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> لا توجد أمثلة أو حسابات تجريبية متاحة للحذف من حسابك{info.removed ? '، ولن تُضاف الأمثلة مجدداً' : ''}.
        </p>
      )}
      {info && !nothingLeft && (
        <div className="space-y-3 text-xs">
          <p className="text-slate-600 leading-relaxed">
            تُحفظ نسخة احتياطية قبل حذف الأمثلة. بعدها يفتح معالج الإعداد لمراجعة القيم المحفوظة للمؤسسة.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(info.counts)
              .filter(([, n]) => n > 0)
              .map(([c, n]) => (
                <span key={c} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700">
                  {LABELS[c] || c}: <strong>{n}</strong>
                </span>
              ))}
          </div>
          {info.users.length > 0 && (
            <label className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
              <input type="checkbox" checked={includeUsers} onChange={(e) => setIncludeUsers(e.target.checked)} className="mt-0.5 accent-rose-600" />
              <span>
                حذف حسابات المستخدمين التجريبيين أيضاً ({info.users.length}): {info.users.map((u) => u.fullName).join('، ')}.
                <span className="block text-2xs mt-0.5">يبقى الحساب الذي تستخدمه الآن. لحذف المدير العام التجريبي، سجّل الدخول بحساب مدير عام مؤسسي ثم نفّذ الحذف.</span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span className="text-slate-600">للتأكيد اكتب «حذف»:</span>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="تأكيد الحذف" className="w-24 px-2 py-1.5 rounded-lg border border-slate-300" />
            </label>
            <button
              type="button"
              disabled={busy || selectedCount === 0 || confirm.trim() !== 'حذف'}
              onClick={remove}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl font-bold"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {busy ? 'جارٍ الحذف...' : `حذف البيانات التجريبية (${selectedCount})`}
            </button>
          </div>
        </div>
      )}
      <div className="pt-3 border-t border-slate-200">
        <button
          type="button"
          disabled={busy}
          onClick={() => setupCommand.emit('review')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <Settings2 className="size-4" aria-hidden="true" />
          فتح معالج الإعداد
        </button>
      </div>
    </div>
  );
};
