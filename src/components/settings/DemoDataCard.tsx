import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { notify } from '../../services/notify';

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

  const remove = async () => {
    setBusy(true);
    try {
      const { total: n } = await apiService.removeDemoData(includeUsers, confirm.trim());
      notify({ type: 'success', title: 'حُذفت البيانات التجريبية', message: `حُذف ${n} سجلاً، وحُفظت نسخة احتياطية قبل الحذف.` });
      setConfirm('');
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
        <span>حذف البيانات التجريبية</span>
      </h3>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {!info && !error && <p className="text-xs text-slate-500">جارٍ الفحص...</p>}
      {info && nothingLeft && (
        <p className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> لا توجد بيانات تجريبية؛ النظام يحوي بياناتكم فقط{info.removed ? ' ولن تُضاف البيانات التجريبية مجدداً' : ''}.
        </p>
      )}
      {info && !nothingLeft && (
        <div className="space-y-3 text-xs">
          <p className="text-slate-600 leading-relaxed">
            يحذف الأخبار والبرامج والحلقات والضيوف والنشرات والحجوزات وغيرها من الأمثلة التي جاءت مع النظام للتجربة فقط. لا يُحذف أي شيء أنشأه فريقكم، ولا الأقسام والمصادر والأدوار.
            تُحفظ نسخة احتياطية تلقائياً قبل الحذف، ولن تُضاف البيانات التجريبية مرة أخرى.
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
                <span className="block text-[11px] mt-0.5">حسابك الحالي لا يُحذف. تأكد أن لديك حساب مدير حقيقي قبل حذفها.</span>
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
              disabled={busy || confirm.trim() !== 'حذف'}
              onClick={remove}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl font-bold"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {busy ? 'جارٍ الحذف...' : `حذف البيانات التجريبية (${total + (includeUsers ? info.users.length : 0)})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
