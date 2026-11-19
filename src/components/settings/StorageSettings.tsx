import { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Copy, ExternalLink, FolderTree, KeyRound, RefreshCw, Save, Server, TriangleAlert } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { confirmDialog } from '../../services/dialogs';
import { storageClient } from '../../services/storageClient';
import { SINGLETON_ID } from '../../shared/collections';
import { storageOf, validateStorage, type ResolvedStorageSettings, type StorageStatus } from '../../shared/storage';

const INPUT = 'w-full min-h-11 px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-900';
const BTN = 'min-h-11 px-4 rounded-lg text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50';
const PRIMARY = `${BTN} bg-blue-600 hover:bg-blue-700 text-white`;
const SECONDARY = `${BTN} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

const RETURN_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  'gdrive-connected': { ok: true, text: 'رُبط Google Drive. فعّله واحفظ الإعدادات لتبدأ النسخ.' },
  'gdrive-denied': { ok: false, text: 'لم تُمنح الموافقة في Google. أعد المحاولة واقبل الأذونات المطلوبة.' },
  'gdrive-expired': { ok: false, text: 'انتهت مهلة الربط أو تغيّر الحساب المسجل. ابدأ الربط من جديد.' },
  'gdrive-failed': { ok: false, text: 'تعذر إكمال الربط مع Google Drive. تحقق من معرّف العميل وسرّه ومن عنوان الرجوع المسجّل.' },
};

function when(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
}

function StatusChip({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const tone = ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : warn ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold ${tone}`}>{children}</span>;
}

/**
 * Where library files are kept: Dropbox, Google Drive and the station's shared folder (SMB),
 * the latter through «جسر مدار» on a computer inside the network or a folder mounted on the server.
 */
export function StorageSettings() {
  const [settings, setSettings] = useState<ResolvedStorageSettings>(() => storageOf(apiService.getSettings()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(storageOf(apiService.getSettings())));
  const [networksText, setNetworksText] = useState(() => settings.share.localNetworks.join('\n'));
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [dbx, setDbx] = useState({ appKey: '', appSecret: '', code: '' });
  const [drive, setDrive] = useState({ clientId: '', clientSecret: '' });
  const [redirectUri, setRedirectUri] = useState('');
  const [token, setToken] = useState('');

  const current: ResolvedStorageSettings = { ...settings, share: { ...settings.share, localNetworks: networksText.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) } };
  const dirty = JSON.stringify(current) !== baseline;

  const refresh = async () => {
    try {
      setStatus(await storageClient.status());
      setStatusError('');
    } catch {
      setStatusError('تعذر قراءة حالة التخزين من الخادم.');
    }
  };
  useEffect(() => {
    void refresh();
    // Back from Google's consent page.
    const result = new URLSearchParams(window.location.search).get('storage');
    if (result && RETURN_MESSAGES[result]) {
      setMessage(RETURN_MESSAGES[result]);
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'تعذر إكمال العملية' });
    } finally {
      setBusy('');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const invalid = validateStorage(current);
    if (invalid) return setMessage({ ok: false, text: invalid });
    setSaving(true);
    setMessage(null);
    try {
      apiService.saveSettings({ storage: current });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم الحفظ');
      setSettings(current);
      setBaseline(JSON.stringify(current));
      setMessage({ ok: true, text: 'حُفظت إعدادات التخزين.' });
      void refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'تعذر حفظ الإعدادات' });
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setMessage({ ok: true, text: 'نُسخ إلى الحافظة.' }), () => undefined);
  };

  const q = status?.queue;
  const bridgeCommand = `MADAR_URL=${window.location.origin} MADAR_BRIDGE_TOKEN=${token || '<الرمز>'} SHARE_PATH=${settings.share.displayPath || '/mnt/news'} node madar-bridge.mjs`;

  return (
    <form onSubmit={save} className="py-4 space-y-8" aria-label="التخزين">
      <section aria-labelledby="storage-overview" className="space-y-3">
        <h2 id="storage-overview" className="text-lg font-bold text-slate-900">أين تُحفظ المواد</h2>
        <p className="text-sm text-slate-600 max-w-3xl leading-6">
          كل ملف يُرفع إلى المكتبة يُحفظ أولاً على الخادم، ثم يُنسخ تلقائياً إلى Dropbox أو Google Drive إن كانا مربوطين ومفعّلين. الزملاء داخل شبكة المحطة يستطيعون أيضاً حفظ نسخة في المجلد المشترك. ويمكن من المكتبة البحث في هذه الأماكن وإضافة ملف موجود فيها دون نسخه.
        </p>
        {statusError && <p role="alert" className="text-sm text-red-700">{statusError}</p>}
        <dl className="grid grid-cols-2 lg:grid-cols-4 border-y border-slate-200 divide-x divide-x-reverse divide-slate-200">
          {[
            { label: 'Dropbox', value: status?.dropbox.connected ? (status.dropbox.enabled ? 'مفعّل' : 'مربوط وغير مفعّل') : 'غير مربوط', ok: !!status?.dropbox.connected && status.dropbox.enabled },
            { label: 'Google Drive', value: status?.gdrive.connected ? (status.gdrive.enabled ? 'مفعّل' : 'مربوط وغير مفعّل') : 'غير مربوط', ok: !!status?.gdrive.connected && status.gdrive.enabled },
            { label: 'المجلد المشترك', value: !status?.share.enabled ? 'غير مفعّل' : status.share.mode === 'direct' ? 'مركّب على الخادم' : status.share.bridgeOnline ? 'الجسر متصل' : status.share.mode === 'bridge' ? 'الجسر غير متصل' : 'بلا جسر', ok: !!status?.share.enabled && (status.share.mode === 'direct' || status.share.bridgeOnline) },
            { label: 'بانتظار النسخ', value: q ? `${q.pending}${q.failed ? ` · ${q.failed} تعذّر` : ''}` : '—', ok: !!q && !q.failed },
          ].map((m) => (
            <div key={m.label} className="px-4 py-3">
              <dt className="text-xs text-slate-500">{m.label}</dt>
              <dd className={`mt-1 text-sm font-bold ${m.ok ? 'text-emerald-800' : 'text-slate-800'}`}>{m.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('sync', async () => { setStatus(await storageClient.syncNow()); setMessage({ ok: true, text: 'نُفذت دورة نسخ الآن.' }); })}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> انسخ الآن
          </button>
          {!!q?.failed && (
            <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('retry', async () => { const n = await storageClient.retryFailed(); setMessage({ ok: true, text: `أُعيدت ${n} ملفات إلى قائمة النسخ.` }); await refresh(); })}>
              <TriangleAlert className="w-4 h-4" aria-hidden="true" /> أعد محاولة ما تعذّر
            </button>
          )}
        </div>
        <label className="flex items-start gap-3 min-h-11 text-sm max-w-3xl">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={!settings.keepLocalCopy} onChange={(e) => setSettings({ ...settings, keepLocalCopy: !e.target.checked })} />
          <span>
            <span className="font-semibold text-slate-900">وفّر مساحة الخادم</span>
            <span className="block text-slate-600">يُحذف ملف الخادم بعد التأكد من وجوده في Dropbox أو Google Drive، ويُقرأ منهما عند فتحه.</span>
          </span>
        </label>
      </section>

      {/* Dropbox */}
      <fieldset className="space-y-4 border-t border-slate-200 pt-6" disabled={saving}>
        <legend className="text-lg font-bold text-slate-900 inline-flex items-center gap-2"><Cloud className="w-5 h-5 text-blue-600" aria-hidden="true" /> Dropbox</legend>
        <div className="flex flex-wrap items-center gap-2">
          {status?.dropbox.connected ? <StatusChip ok><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> مربوط بحساب {status.dropbox.account || 'Dropbox'}</StatusChip> : <StatusChip ok={false}>غير مربوط</StatusChip>}
          {status?.dropbox.lastError && <StatusChip ok={false} warn>آخر خطأ: {status.dropbox.lastError}</StatusChip>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
          <label className="flex items-center gap-2 min-h-11 text-sm font-semibold">
            <input type="checkbox" className="w-4 h-4" checked={settings.dropbox.enabled} onChange={(e) => setSettings({ ...settings, dropbox: { ...settings.dropbox, enabled: e.target.checked } })} />
            انسخ ملفات المكتبة إلى Dropbox
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">المجلد في Dropbox</span>
            <input className={`${INPUT} mt-1`} dir="auto" value={settings.dropbox.rootPath} onChange={(e) => setSettings({ ...settings, dropbox: { ...settings.dropbox, rootPath: e.target.value } })} placeholder="/مدار" />
          </label>
        </div>
        {status?.dropbox.managedByEnvironment ? (
          <p className="text-sm text-slate-600">مفاتيح Dropbox محددة في إعدادات الخادم (متغيرات البيئة).</p>
        ) : status?.dropbox.connected ? (
          <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('dbx-off', async () => {
            if (!(await confirmDialog({ title: 'فصل Dropbox', message: 'يتوقف النسخ إلى Dropbox، والملفات التي لا توجد إلا فيه لن تُفتح حتى تعيد الربط. الملفات في Dropbox نفسها لا تُحذف.', confirmLabel: 'فصل', danger: true }))) return;
            setStatus(await storageClient.disconnect('dropbox'));
          })}>فصل Dropbox</button>
        ) : (
          <details className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-slate-900">ربط Dropbox</summary>
            <ol className="mt-3 space-y-4 text-sm text-slate-700 list-decimal pr-5">
              <li>أنشئ تطبيقاً في <a className="text-blue-700 underline" href="https://www.dropbox.com/developers/apps" target="_blank" rel="noreferrer">Dropbox App Console</a> (نوع الوصول: Full Dropbox أو App folder) وفعّل أذونات <span dir="ltr">files.content.read / files.content.write / files.metadata.read</span>.</li>
              <li className="space-y-2">
                <span>انسخ مفتاح التطبيق وسرّه:</span>
                <div className="grid sm:grid-cols-2 gap-3">
                  <input className={INPUT} dir="ltr" aria-label="App key" placeholder="App key" value={dbx.appKey} onChange={(e) => setDbx({ ...dbx, appKey: e.target.value.trim() })} />
                  <input className={INPUT} dir="ltr" type="password" autoComplete="off" aria-label="App secret" placeholder="App secret" value={dbx.appSecret} onChange={(e) => setDbx({ ...dbx, appSecret: e.target.value.trim() })} />
                </div>
              </li>
              <li>
                <button type="button" className={SECONDARY} disabled={!dbx.appKey || !!busy} onClick={() => run('dbx-url', async () => { window.open(await storageClient.dropboxAuthorizeUrl(dbx.appKey), '_blank', 'noopener'); })}>
                  <ExternalLink className="w-4 h-4" aria-hidden="true" /> افتح صفحة الموافقة في Dropbox
                </button>
              </li>
              <li className="space-y-2">
                <span>الصق الرمز الذي يظهر بعد الموافقة:</span>
                <div className="flex flex-wrap gap-2">
                  <input className={`${INPUT} sm:w-96`} dir="ltr" aria-label="رمز التفويض من Dropbox" value={dbx.code} onChange={(e) => setDbx({ ...dbx, code: e.target.value.trim() })} />
                  <button type="button" className={PRIMARY} disabled={!dbx.appKey || !dbx.appSecret || !dbx.code || !!busy} onClick={() => run('dbx-connect', async () => {
                    setStatus(await storageClient.connectDropbox(dbx.appKey, dbx.appSecret, dbx.code));
                    setDbx({ appKey: '', appSecret: '', code: '' });
                    setMessage({ ok: true, text: 'رُبط Dropbox. فعّل النسخ واحفظ الإعدادات.' });
                  })}>ربط</button>
                </div>
              </li>
            </ol>
          </details>
        )}
      </fieldset>

      {/* Google Drive */}
      <fieldset className="space-y-4 border-t border-slate-200 pt-6" disabled={saving}>
        <legend className="text-lg font-bold text-slate-900 inline-flex items-center gap-2"><Cloud className="w-5 h-5 text-blue-600" aria-hidden="true" /> Google Drive</legend>
        <div className="flex flex-wrap items-center gap-2">
          {status?.gdrive.connected ? <StatusChip ok><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> مربوط بحساب {status.gdrive.account || 'Google'}</StatusChip> : <StatusChip ok={false}>غير مربوط</StatusChip>}
          {status?.gdrive.lastError && <StatusChip ok={false} warn>آخر خطأ: {status.gdrive.lastError}</StatusChip>}
        </div>
        <div className="grid sm:grid-cols-3 gap-4 max-w-4xl">
          <label className="flex items-center gap-2 min-h-11 text-sm font-semibold">
            <input type="checkbox" className="w-4 h-4" checked={settings.gdrive.enabled} onChange={(e) => setSettings({ ...settings, gdrive: { ...settings.gdrive, enabled: e.target.checked } })} />
            انسخ ملفات المكتبة إلى Google Drive
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">اسم المجلد</span>
            <input className={`${INPUT} mt-1`} value={settings.gdrive.rootName} onChange={(e) => setSettings({ ...settings, gdrive: { ...settings.gdrive, rootName: e.target.value } })} />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">أو معرّف مجلد موجود (اختياري)</span>
            <input className={`${INPUT} mt-1`} dir="ltr" value={settings.gdrive.rootFolderId} onChange={(e) => setSettings({ ...settings, gdrive: { ...settings.gdrive, rootFolderId: e.target.value.trim() } })} placeholder="مثلاً مجلد في Drive مشترك" />
          </label>
        </div>
        {status?.gdrive.managedByEnvironment ? (
          <p className="text-sm text-slate-600">مفاتيح Google Drive محددة في إعدادات الخادم (متغيرات البيئة).</p>
        ) : status?.gdrive.connected ? (
          <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('gd-off', async () => {
            if (!(await confirmDialog({ title: 'فصل Google Drive', message: 'يتوقف النسخ إلى Google Drive، والملفات التي لا توجد إلا فيه لن تُفتح حتى تعيد الربط. لا يُحذف شيء من Drive.', confirmLabel: 'فصل', danger: true }))) return;
            setStatus(await storageClient.disconnect('gdrive'));
          })}>فصل Google Drive</button>
        ) : (
          <details className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-slate-900">ربط Google Drive</summary>
            <ol className="mt-3 space-y-4 text-sm text-slate-700 list-decimal pr-5">
              <li>في <a className="text-blue-700 underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console</a> فعّل Google Drive API وأنشئ «OAuth client ID» من نوع Web application.</li>
              <li className="space-y-2">
                <span>أضف عنوان الرجوع هذا إلى «Authorized redirect URIs»:</span>
                <div className="flex flex-wrap items-center gap-2">
                  <code dir="ltr" className="px-2 py-1.5 rounded bg-white border border-slate-200 text-xs break-all">{redirectUri || `${window.location.origin}/api/v1/storage/gdrive/callback`}</code>
                  <button type="button" className={SECONDARY} onClick={() => copy(redirectUri || `${window.location.origin}/api/v1/storage/gdrive/callback`)}><Copy className="w-4 h-4" aria-hidden="true" /> نسخ</button>
                </div>
              </li>
              <li className="space-y-2">
                <span>انسخ معرّف العميل وسرّه، ثم اربط (ستنتقل إلى Google وتعود إلى هنا):</span>
                <div className="grid sm:grid-cols-2 gap-3">
                  <input className={INPUT} dir="ltr" aria-label="Client ID" placeholder="Client ID" value={drive.clientId} onChange={(e) => setDrive({ ...drive, clientId: e.target.value.trim() })} />
                  <input className={INPUT} dir="ltr" type="password" autoComplete="off" aria-label="Client secret" placeholder="Client secret" value={drive.clientSecret} onChange={(e) => setDrive({ ...drive, clientSecret: e.target.value.trim() })} />
                </div>
                <button type="button" className={PRIMARY} disabled={!drive.clientId || !drive.clientSecret || !!busy || dirty} onClick={() => run('gd-connect', async () => {
                  const r = await storageClient.driveAuthorizeUrl(drive.clientId, drive.clientSecret);
                  setRedirectUri(r.redirectUri);
                  window.location.assign(r.url);
                })}>ربط Google Drive</button>
                {dirty && <p className="text-xs text-amber-900">احفظ التغييرات أولاً؛ الربط ينقلك خارج الصفحة.</p>}
              </li>
            </ol>
          </details>
        )}
      </fieldset>

      {/* Shared folder */}
      <fieldset className="space-y-4 border-t border-slate-200 pt-6" disabled={saving}>
        <legend className="text-lg font-bold text-slate-900 inline-flex items-center gap-2"><FolderTree className="w-5 h-5 text-blue-600" aria-hidden="true" /> المجلد المشترك على شبكة المحطة (SMB)</legend>
        <p className="text-sm text-slate-600 max-w-3xl leading-6">
          للزملاء داخل شبكة المحطة: عند الرفع يظهر لهم خيار «احفظ نسخة في المجلد المشترك». يكتب في المجلد «جسر مدار» — برنامج صغير يعمل على جهاز داخل الشبكة يرى المجلد — أو الخادم نفسه إن كان المجلد مركّباً عليه. الجسر يرسل أيضاً قائمة ملفات المجلد ليُبحث فيها من المكتبة.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
          <label className="flex items-center gap-2 min-h-11 text-sm font-semibold">
            <input type="checkbox" className="w-4 h-4" checked={settings.share.enabled} onChange={(e) => setSettings({ ...settings, share: { ...settings.share, enabled: e.target.checked } })} />
            فعّل الحفظ في المجلد المشترك
          </label>
          <label className="flex items-center gap-2 min-h-11 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={settings.share.copyByDefault} onChange={(e) => setSettings({ ...settings, share: { ...settings.share, copyByDefault: e.target.checked } })} />
            الخيار محدد مسبقاً عند الرفع
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">مسار المجلد كما يراه الزملاء</span>
            <input className={`${INPUT} mt-1`} dir="ltr" value={settings.share.displayPath} onChange={(e) => setSettings({ ...settings, share: { ...settings.share, displayPath: e.target.value } })} placeholder="\\fileserver\news" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">عناوين شبكة المحطة</span>
            <textarea className={`${INPUT} mt-1 h-24 font-mono`} dir="ltr" value={networksText} onChange={(e) => setNetworksText(e.target.value)} aria-describedby="share-networks-hint" />
            <span id="share-networks-hint" className="block text-xs text-slate-500 mt-1">نطاق في كل سطر (مثلاً 10.0.0.0/8). من يتصل من هذه العناوين يُعدّ داخل المحطة.</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status?.share.mode === 'direct' && <StatusChip ok><Server className="w-3.5 h-3.5" aria-hidden="true" /> المجلد مركّب على الخادم</StatusChip>}
          {status?.share.mode !== 'direct' && (status?.share.bridgeOnline
            ? <StatusChip ok><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> الجسر متصل {status.share.bridgeVersion ? `(الإصدار ${status.share.bridgeVersion})` : ''}</StatusChip>
            : <StatusChip ok={false} warn={!!status?.share.hasBridgeToken}>{status?.share.hasBridgeToken ? `الجسر غير متصل · آخر ظهور ${when(status.share.bridgeLastSeen)}` : 'لا يوجد جسر بعد'}</StatusChip>)}
          {!!status?.share.indexedFiles && <StatusChip ok>{status.share.indexedFiles.toLocaleString('ar')} ملف مفهرس · {when(status.share.indexedAt)}</StatusChip>}
          {status && <StatusChip ok={status.isLocal}>{status.isLocal ? 'جهازك الآن داخل شبكة المحطة' : 'جهازك الآن خارج شبكة المحطة'}</StatusChip>}
        </div>
        {status?.share.mode !== 'direct' && (
          <details className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 p-4" open={!status?.share.hasBridgeToken && settings.share.enabled}>
            <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-slate-900">تشغيل «جسر مدار»</summary>
            <ol className="mt-3 space-y-4 text-sm text-slate-700 list-decimal pr-5">
              <li className="space-y-2">
                <span>على جهاز داخل الشبكة يرى المجلد المشترك ثبّت Node.js 20 أو أحدث، ثم نزّل برنامج الجسر إليه:</span>
                <a href="/api/v1/storage/bridge/program" download className={`${SECONDARY} w-fit`}>تنزيل madar-bridge.mjs</a>
              </li>
              <li className="space-y-2">
                <span>أصدر رمزاً للجسر (يظهر مرة واحدة، وإصدار رمز جديد يوقف القديم):</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('token', async () => {
                    if (status?.share.hasBridgeToken && !(await confirmDialog({ title: 'رمز جديد للجسر', message: 'الجسر الذي يعمل بالرمز الحالي سيتوقف حتى تضع فيه الرمز الجديد.', confirmLabel: 'إصدار رمز جديد' }))) return;
                    setToken(await storageClient.newBridgeToken());
                    await refresh();
                  })}><KeyRound className="w-4 h-4" aria-hidden="true" /> {status?.share.hasBridgeToken ? 'إصدار رمز جديد' : 'إصدار رمز'}</button>
                  {status?.share.hasBridgeToken && (
                    <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('revoke', async () => {
                      if (!(await confirmDialog({ title: 'إيقاف الجسر', message: 'يُلغى رمز الجسر ويتوقف الحفظ في المجلد المشترك والبحث فيه.', confirmLabel: 'إيقاف', danger: true }))) return;
                      await storageClient.revokeBridge();
                      setToken('');
                      await refresh();
                    })}>إلغاء الرمز</button>
                  )}
                </div>
                {token && (
                  <div className="flex flex-wrap items-center gap-2" role="status">
                    <code dir="ltr" className="px-2 py-1.5 rounded bg-white border border-slate-200 text-xs break-all">{token}</code>
                    <button type="button" className={SECONDARY} onClick={() => copy(token)}><Copy className="w-4 h-4" aria-hidden="true" /> نسخ الرمز</button>
                  </div>
                )}
              </li>
              <li className="space-y-2">
                <span>شغّله (على Windows يكفي مسار المجلد <span dir="ltr">\\fileserver\news</span>؛ على Linux ركّب المجلد أولاً):</span>
                <div className="flex flex-wrap items-center gap-2">
                  <code dir="ltr" className="px-2 py-1.5 rounded bg-white border border-slate-200 text-xs break-all">{bridgeCommand}</code>
                  <button type="button" className={SECONDARY} onClick={() => copy(bridgeCommand)}><Copy className="w-4 h-4" aria-hidden="true" /> نسخ الأمر</button>
                </div>
                <p className="text-xs text-slate-500">الجسر هو من يتصل بالخادم؛ لا يحتاج إلى فتح منافذ في الشبكة. التفاصيل في دليل التخزين ضمن وثائق «مدار».</p>
              </li>
            </ol>
          </details>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button type="submit" className={PRIMARY} disabled={!dirty || saving}>
          <Save className="w-4 h-4" aria-hidden="true" /> {saving ? 'جارٍ الحفظ...' : 'حفظ إعدادات التخزين'}
        </button>
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${message.ok ? 'text-emerald-800' : 'text-red-700'}`}>{message.text}</p>
        )}
      </div>
    </form>
  );
}
