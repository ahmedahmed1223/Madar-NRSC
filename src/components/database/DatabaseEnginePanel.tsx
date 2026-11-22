import { useEffect, useId, useState } from 'react';
import { apiFetch } from '../../services/http';
import { confirmDialog } from '../../services/dialogs';
import { databaseEngineName, type DatabaseEngine, type DatabaseEngineStatus } from '../../shared/databaseEngine';

const ENDPOINT = '/api/v1/db/engine';
const PRIMARY = 'min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50';

export function DatabaseEnginePanel() {
  const titleId = useId();
  const selectId = useId();
  const [status, setStatus] = useState<DatabaseEngineStatus>();
  const [selected, setSelected] = useState<DatabaseEngine>('sqlite');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ data: DatabaseEngineStatus }>(ENDPOINT).then(({ data }) => {
      if (cancelled) return;
      setStatus(data);
      setSelected(data.pending?.engine || data.active);
    }).catch(() => { if (!cancelled) setError('تعذر تحميل إعداد محرك قاعدة البيانات'); });
    return () => { cancelled = true; };
  }, []);

  async function save(engine: DatabaseEngine) {
    if (!status || saving) return;
    setSaving(true);
    setError('');
    try {
      const switching = engine !== status.active;
      if (switching && !await confirmDialog({
        title: `الانتقال إلى ${databaseEngineName(engine)}`,
        message: 'أكد انتهاء جميع جلسات البث، بما فيها الجلسات المحلية غير المتصلة. يبدأ النقل عند تشغيل الخادم التالي ويُعتمد المحرك بعد مطابقة السجلات، وتبقى القاعدة الأصلية محفوظة.',
        confirmLabel: 'أؤكد انتهاء البث وأجدول التبديل',
      })) return;
      const { data } = await apiFetch<{ data: DatabaseEngineStatus }>(ENDPOINT, { method: 'POST', json: { engine, localAirEnded: switching } });
      setStatus(data);
      setSelected(data.pending?.engine || data.active);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر جدولة التبديل');
    } finally { setSaving(false); }
  }

  return <section aria-labelledby={titleId} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
    <h2 id={titleId} className="text-sm font-bold text-slate-900">محرك قاعدة البيانات</h2>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!status && !error && <p role="status" className="text-sm text-slate-600">جارٍ تحميل المحرك…</p>}
    {status && <>
      <p className="text-sm text-slate-700">المحرك النشط <bdi className="font-bold">{databaseEngineName(status.active)}</bdi></p>
      {status.pending && <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>التبديل إلى <bdi>{databaseEngineName(status.pending.engine)}</bdi> مجدول لتشغيل الخادم القادم.</span>
        <button type="button" disabled={saving} onClick={() => void save(status.active)} className="min-h-11 px-2 font-bold text-blue-800 hover:underline disabled:opacity-50">إلغاء الجدولة</button>
      </div>}
      {status.lastTransfer?.status === 'failed' && <p role="status" className="text-sm text-amber-900">تعذّر النقل في التشغيل السابق. يعمل مدار على القاعدة الأصلية.</p>}
      {status.lastTransfer?.status === 'complete' && <p role="status" className="text-sm text-emerald-800">اكتمل نقل البيانات إلى <bdi>{databaseEngineName(status.lastTransfer.engine)}</bdi>.</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={selectId} className="flex min-w-40 flex-col gap-1 text-sm font-bold text-slate-700">
          المحرك بعد إعادة التشغيل
          <select id={selectId} value={selected} onChange={event => setSelected(event.target.value as DatabaseEngine)}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900" disabled={saving}>
            <option value="sqlite">SQLite</option>
            <option value="postgresql" disabled={!status.postgresConfigured}>PostgreSQL</option>
          </select>
        </label>
        <button type="button" className={PRIMARY} onClick={() => void save(selected)}
          disabled={saving || selected === (status.pending?.engine || status.active)}>{saving ? 'جارٍ الحفظ…' : 'جدولة التبديل'}</button>
      </div>
      {!status.postgresConfigured && <p className="text-xs text-slate-600">يتطلب PostgreSQL ضبط رابط الاتصال في إعدادات الخادم.</p>}
    </>}
  </section>;
}
