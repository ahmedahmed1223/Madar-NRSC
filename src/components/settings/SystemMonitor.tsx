import { useEffect, useState } from 'react';
import { AR, countLabel } from '../../shared/arabicPlural';
import { AlertTriangle, CheckCircle2, LogOut, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../services/http';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { confirmDialog } from '../../services/dialogs';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { bytesLabel, type AdminOverview } from '../../shared/adminOverview';

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const TH = 'p-3 font-bold text-right whitespace-nowrap';

/** Short description of a browser from its user-agent string. */
function deviceLabel(agent?: string) {
  if (!agent) return 'جهاز غير معروف';
  const system = /Android/i.test(agent) ? 'أندرويد' : /iPhone|iPad/i.test(agent) ? 'آيفون/آيباد' : /Windows/i.test(agent) ? 'ويندوز' : /Mac OS/i.test(agent) ? 'ماك' : /Linux/i.test(agent) ? 'لينكس' : 'نظام آخر';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'متصفح';
  return `${browser} — ${system}`;
}

const Stat = ({ label, value, tone = '' }: { label: string; value: React.ReactNode; tone?: string }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-3">
    <dt className="text-xs text-slate-600">{label}</dt>
    <dd className={`text-lg font-bold tabular-nums ${tone || 'text-slate-900'}`}>{value}</dd>
  </div>
);

/** The administrator's day-to-day view of the system: who is signed in, storage, people, content and background jobs. */
export function SystemMonitor() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const me = apiService.getCurrentUser();
  const canRevoke = RbacService.hasPermission(me, 'users.suspend_delete');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData((await apiFetch<{ data: AdminOverview }>('/api/v1/admin/overview')).data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر قراءة حالة النظام');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const revoke = async (userId: string, name: string) => {
    const self = userId === me.id;
    if (!(await confirmDialog({ title: 'إنهاء الجلسات', message: self ? 'تسجيل خروجك من أجهزتك الأخرى؟ يبقى هذا الجهاز.' : `تسجيل خروج ${name} من كل أجهزته؟ يدخل مجدداً بكلمة مروره.`, confirmLabel: 'إنهاء الجلسات', cancelLabel: 'تراجع', danger: !self }))) return;
    try {
      await apiFetch('/api/v1/admin/sessions/revoke', { method: 'POST', json: { userId } });
      setMessage(self ? 'أُنهيت جلساتك على الأجهزة الأخرى' : `أُنهيت جلسات ${name}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنهاء الجلسات');
    }
  };

  return (
    <section className="py-4 space-y-6" aria-label="مراقبة النظام">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">مراقبة النظام</h2>
          <p className="text-sm text-slate-600">{data ? `آخر قراءة: ${when(data.generatedAt)}` : 'ما يتابعه مدير النظام يومياً في مكان واحد.'}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="min-h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 inline-flex items-center gap-2 disabled:opacity-50">
          <RefreshCw className="w-4 h-4" />
          {loading ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>

      {error && <p role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-sm font-bold text-rose-700">{error}</p>}
      {message && <p role="status" className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-800">{message}</p>}
      {!data && !error && <p role="status" className="text-sm text-slate-600">جارٍ قراءة الحالة…</p>}

      {data && (
        <>
          {data.alerts.length === 0 ? (
            <p role="status" className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              لا شيء يحتاج تدخلاً الآن.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="ما يحتاج تدخلاً">
              {data.alerts.map((alert) => (
                <li key={alert.text} className={`flex items-start gap-2 p-3 rounded-xl border text-sm font-bold ${alert.level === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{alert.level === 'error' ? 'خطأ: ' : 'تنبيه: '}{alert.text}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">التخزين</h3>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Stat label="قاعدة البيانات" value={bytesLabel(data.storage.databaseBytes)} />
              <Stat label={`الملفات المرفوعة (${data.storage.uploads.files})`} value={bytesLabel(data.storage.uploads.bytes)} />
              <Stat label={`ملفات غير مستخدمة (${data.storage.unused.files})`} value={bytesLabel(data.storage.unused.bytes)} />
              <Stat label="المساحة الحرة على القرص" value={data.storage.disk ? `${bytesLabel(data.storage.disk.freeBytes)} من ${bytesLabel(data.storage.disk.totalBytes)}` : 'غير متاحة'} tone={data.storage.disk && data.storage.disk.freeBytes < 2 * 1024 ** 3 ? 'text-rose-700' : ''} />
            </dl>
            <p className="text-xs text-slate-500">الملفات غير المستخدمة (رُفعت ولم تُرفق بمادة أو رسالة) تُحذف آلياً بعد يوم. النسخ الاحتياطية والاستعادة في «قاعدة البيانات».</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">الحسابات</h3>
            <dl className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <Stat label="حسابات فعالة" value={data.people.active} />
              <Stat label="موقوفة" value={data.people.suspended} />
              <Stat label="بلا محطة" value={data.people.withoutStation} />
              <Stat label="مقفلة بعد محاولات خاطئة" value={data.people.locked} tone={data.people.locked ? 'text-amber-700' : ''} />
              <Stat label="لم تغيّر كلمة المرور الأولى" value={data.people.mustChangePassword} />
            </dl>
            {data.people.privilegedWithout2fa.length > 0 && (
              <p className="text-sm text-slate-700">أصحاب صلاحيات إدارية بلا تحقق بخطوتين: {data.people.privilegedWithout2fa.map((u) => u.name).join('، ')}.</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">المحتوى</h3>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Stat label="المحطات" value={data.content.stations} />
              <Stat label="تكليفات جارية" value={data.content.openCards} />
              <Stat label="بطاقات متعطلة / متأخرة" value={`${data.content.blockedCards} / ${data.content.lateCards}`} tone={data.content.blockedCards ? 'text-rose-700' : ''} />
              <Stat label="تنبيهات لم تُقرأ" value={data.content.notificationsWaiting} />
              <Stat label="الرسائل المحفوظة" value={data.content.messages} />
              <Stat label="أقدم رسالة" value={when(data.content.oldestMessageAt)} />
              <Stat label="مجموعات المحادثة" value={data.content.groups} />
            </dl>
            <p className="text-xs text-slate-500">مدة الاحتفاظ بالرسائل والسجلات يحددها LOG_RETENTION_DAYS في إعدادات الخادم.</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">المهام الدورية</h3>
            {data.jobs.length === 0 ? (
              <p className="text-sm text-slate-600">لم تُسجَّل مهام دورية في هذا التشغيل.</p>
            ) : (
              <div role="region" tabIndex={0} aria-label="جدول المهام الدورية (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="text-slate-600 border-b border-slate-200">
                      {['المهمة', 'كل', 'آخر تشغيل', 'النتيجة'].map((h) => (
                        <th key={h} scope="col" className={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((job) => (
                      <tr key={job.name} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className="p-3 text-right font-bold text-slate-900">{job.name}</th>
                        <td className="p-3 tabular-nums whitespace-nowrap">{job.everyMinutes === undefined ? '—' : job.everyMinutes >= 60 ? countLabel(Math.round(job.everyMinutes / 60), AR.hour) : job.everyMinutes >= 1 ? countLabel(Math.round(job.everyMinutes), AR.minute) : countLabel(Math.round(job.everyMinutes * 60), { one: 'ثانية واحدة', two: 'ثانيتان', few: 'ثوانٍ', many: 'ثانية' })}</td>
                        <td className="p-3 whitespace-nowrap">{when(job.lastRunAt)}</td>
                        <td className={`p-3 font-bold ${job.ok === false ? 'text-rose-700' : job.ok ? 'text-emerald-700' : 'text-slate-600'}`}>{job.ok === false ? job.error : job.ok ? 'نجحت' : 'لم تعمل بعد'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">الجلسات النشطة</h3>
            <p className="text-sm text-slate-600">{data.sessions.users} مسجّلون على {data.sessions.devices} جهازاً؛ {data.sessions.activeNow} نشطون في آخر خمس دقائق.</p>
            <div role="region" tabIndex={0} aria-label="جدول الجلسات النشطة (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200">
                    {['المستخدم', 'الأجهزة', 'آخر نشاط', 'آخر جهاز', 'العنوان', ''].map((h, i) => (
                      <th key={i} scope="col" className={TH}>{h || <span className="sr-only">إجراء</span>}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.list.map((s) => (
                    <tr key={s.userId} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="p-3 text-right font-bold text-slate-900">{s.name}{s.userId === me.id ? ' (أنت)' : ''}</th>
                      <td className="p-3 tabular-nums">{s.devices}</td>
                      <td className="p-3 whitespace-nowrap">{when(s.lastSeenAt)}</td>
                      <td className="p-3 whitespace-nowrap">{deviceLabel(s.agent)}</td>
                      <td className="p-3 tabular-nums" dir="ltr">{s.ip || '—'}</td>
                      <td className="p-3">
                        {canRevoke && (s.userId !== me.id || s.devices > 1) && (
                          <button type="button" onClick={() => revoke(s.userId, s.name)} className="min-h-11 sm:min-h-9 px-3 rounded-lg border border-slate-300 text-slate-700 hover:border-rose-200 hover:text-rose-700 hover:bg-rose-50 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
                            <LogOut className="w-3.5 h-3.5" />
                            {s.userId === me.id ? 'إنهاء جلساتي الأخرى' : 'إنهاء الجلسات'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
