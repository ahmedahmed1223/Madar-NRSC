import { useEffect, useRef, useState } from 'react';
import { measureGuestUpload, testGuestDevices, type GuestCheckResult } from '../services/guestTechProbe';

const endpoint = '/api/v1/external-intake';
const HEADER = { 'X-NRCS-Client': 'web' };
type TicketInfo = { kind: 'upload' | 'guest'; expiresAt: string; maxUpload: number };

async function send(path: string, body: object, signal?: AbortSignal) {
  const response = await fetch(endpoint + path, { method: 'POST', headers: { ...HEADER, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'تعذر الاتصال بمدار.');
  return result;
}

export function ExternalIntakeView() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<TicketInfo>();
  const [activity, setActivity] = useState<'upload' | 'check' | 'send' | null>(null);
  const busy = activity !== null;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<GuestCheckResult>();
  const [done, setDone] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    send('/info', { token }, controller.signal).then(data => setInfo(data.data)).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof TypeError || reason instanceof SyntaxError ? 'تعذّر الاتصال بمدار للتحقق من الرابط.' : reason.message);
    });
    return () => controller.abort();
  }, [token, attempt]);

  const upload = async () => {
    if (!file || !info || busy) return;
    if (file.size > info.maxUpload) { setError('الملف أكبر من الحد المسموح.'); return; }
    setActivity('upload'); setError('');
    try {
      const response = await fetch(endpoint + '/upload', {
        method: 'POST', headers: { ...HEADER, 'X-Madar-Intake': token, 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر رفع الملف.');
      setDone('استلم مدار الملف الأصلي وأودعه في مكتبة الوسائط.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر رفع الملف.'); }
    finally { setActivity(null); }
  };
  const check = async () => {
    if (!videoRef.current || busy) return;
    setActivity('check'); setError(''); setResult(undefined);
    try {
      const devices = await testGuestDevices(videoRef.current);
      const uploadMbps = await measureGuestUpload(endpoint + '/speed', token);
      setResult({ ...devices, uploadMbps });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر الاختبار.'); }
    finally { setActivity(null); }
  };
  const submitResult = async () => {
    if (!result || busy) return;
    setActivity('send'); setError('');
    try {
      const saved = await send('/guest-result', { token, ...result });
      setDone(saved.ready ? 'رُفعت النتيجة إلى فريق البرنامج وأصبحت جاهزًا تقنيًا.' : 'رُفعت النتيجة إلى الفريق لمساعدتك في معالجة الملاحظات.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر حفظ النتيجة.'); }
    finally { setActivity(null); }
  };
  return (
    <main dir="rtl" className="min-h-dvh bg-slate-100 px-4 py-12 text-slate-900">
      <section className="mx-auto max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 sm:p-8">
        <h1 className="text-2xl font-bold">{info?.kind === 'guest' ? 'الفحص التقني قبل البث' : info?.kind === 'upload' ? 'رفع مادة إلى مدار' : 'رابط مدار'}</h1>
        {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-rose-800">{error}</p>}
        {!info && error && <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold text-blue-700 hover:bg-blue-50">إعادة التحقق من الرابط</button>}
        {done && <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-800">{done}</p>}
        {!info && !error && <p role="status">جارٍ التحقق من الرابط…</p>}
        {info?.kind === 'upload' && !done && <>
          <p>اختر ملف الفيديو أو الصوت الأصلي. يُستخدم الرابط لرفع ملف واحد.</p>
          <label className="block font-semibold">ملف الفيديو أو الصوت
            <input type="file" accept="audio/*,video/*" disabled={busy} aria-describedby="file-limit" onChange={event => { setFile(event.target.files?.[0]); setError(''); }} className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 p-1 text-sm file:me-2 file:rounded-md file:bg-slate-100 file:px-3 file:py-2" />
          </label>
          <p id="file-limit" className="text-sm text-slate-600">الحد الأقصى {Math.floor(info.maxUpload / (1024 * 1024))} ميغابايت</p>
          <button type="button" disabled={!file || busy} onClick={() => void upload()} className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'جارٍ رفع الملف…' : 'رفع الملف'}</button>
        </>}
        {info?.kind === 'guest' && !done && <>
          <p>ضع الضوء أمام وجهك واستعمل اتصالًا مستقرًا. يبقى صوتك وصورتك على جهازك، وتصل نتيجة الفحص فقط إلى فريق البرنامج.</p>
          <video ref={videoRef} muted playsInline className="sr-only" aria-hidden="true" />
          <button type="button" disabled={busy} onClick={() => void check()} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold hover:bg-slate-50 disabled:opacity-50">{activity === 'check' ? 'جارٍ الفحص…' : result ? 'إعادة الفحص' : 'بدء الفحص'}</button>
          {result && <>
            <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
              <div><dt>الكاميرا</dt><dd>{result.camera ? 'تعمل' : 'تحقق من الإذن'}</dd></div>
              <div><dt>الميكروفون</dt><dd>{result.microphone ? 'متصل' : 'تحقق من الإذن'}</dd></div>
              <div><dt>الإضاءة</dt><dd>{result.light ? 'كافية' : 'زد إضاءة الوجه'}</dd></div>
              <div><dt>سرعة الرفع التقريبية</dt><dd><bdi>{result.uploadMbps.toFixed(1)} Mbps</bdi></dd></div>
            </dl>
            <button type="button" disabled={busy} onClick={() => void submitResult()} className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">{activity === 'send' ? 'جارٍ إرسال النتيجة…' : 'إرسال النتيجة'}</button>
          </>}
        </>}
      </section>
    </main>
  );
}
