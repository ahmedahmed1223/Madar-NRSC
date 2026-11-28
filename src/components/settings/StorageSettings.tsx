import { apiFetch } from '../../services/http';
import { notify } from '../../services/notify';
import { PrimaryStorageSettings, type BackupPrimaryReadiness } from './PrimaryStorageSettings';
import { useEffect, useState } from 'react';
import { DropboxAuthorization, DropboxEnvironmentKeys } from './DropboxAuthorization';
import { CheckCircle2, Cloud, Copy, ExternalLink, FolderTree, KeyRound, RefreshCw, Save, Server, TriangleAlert } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { confirmDialog } from '../../services/dialogs';
import { storageClient } from '../../services/storageClient';
import { writeBrowserHistory } from '../../services/browserHistory';
import { SINGLETON_ID } from '../../shared/collections';
import { storageOf, validateStorage, type DropboxCheck, type DropboxCheckStatus, type DropboxVerification, type ResolvedStorageSettings, type StorageStatus } from '../../shared/storage';
import { copyTextToClipboard } from '../../services/clipboard';
import { PasswordVisibilityButton } from '../auth/PasswordFields';

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

const DROPBOX_CHECK_MESSAGES: Record<DropboxCheckStatus, string> = {
  invalid_team_member: 'عضو الفريق غير متاح. اختر عضوًا نشطًا وتحقق من تفويضه.',
  root_changed: 'تغيّر جذر مساحة Dropbox. راجع مسارات المكتبة ثم جدّد الربط.',
  verified: 'تم التحقق',
  not_configured: 'بيانات الربط غير محفوظة أو غير مكتملة',
  invalid_credentials: 'تعذر تأكيد بيانات الربط. تحقق من مفاتيح التطبيق أو أعد التفويض.',
  missing_scope: 'الإذن غير ممنوح. فعّله في Dropbox ثم أعد الربط.',
  folder_missing: 'لم يعثر Dropbox على المجلد. تحقق من المسار المحفوظ.',
  folder_denied: 'رفض Dropbox الوصول إلى المجلد.',
  unavailable: 'خدمة Dropbox غير متاحة الآن. أعد المحاولة لاحقاً.',
  failed: 'تعذر إكمال الفحص في Dropbox.',
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

function DropboxCheckRow({ label, result }: { label: React.ReactNode; result: DropboxCheckStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <dt className="text-sm font-semibold text-slate-700">{label}</dt>
      <dd><StatusChip ok={result === 'verified'} warn={result !== 'verified'}>{DROPBOX_CHECK_MESSAGES[result]}</StatusChip></dd>
    </div>
  );
}

function DropboxCheckAccount({ result }: { result: DropboxVerification }) {
  if (!result.account) return null;
  return <div className="flex flex-wrap items-baseline gap-2 text-sm">
    <dt className="font-semibold text-slate-700">الحساب الذي فحصه مدار</dt>
    <dd className="min-w-0 break-words">
      <bdi>{result.account}</bdi>
      {result.teamMemberId && <bdi className="ms-2 break-all text-xs text-slate-600">{result.teamMemberId}</bdi>}
    </dd>
  </div>;
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
  const [backupReadiness, setBackupReadiness] = useState<BackupPrimaryReadiness | null>(null);
  const [message, setMessageState] = useState<{ ok: boolean; text: string } | null>(null);
  const setMessage = (feedback: { ok: boolean; text: string } | null) => {
    setMessageState(feedback);
    if (feedback) notify({ type: feedback.ok ? 'success' : 'error', message: feedback.text });
  };
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [dropboxChecks, setDropboxChecks] = useState<Partial<Record<DropboxCheck, DropboxVerification>>>({});
  const [drive, setDrive] = useState({ clientId: '', clientSecret: '' });
  const [redirectUri, setRedirectUri] = useState('');
  const [token, setToken] = useState('');
  const [showDriveSecret, setShowDriveSecret] = useState(false);

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
    const backupCheck = new AbortController();
    void apiFetch<{ data: { primaryDestinations?: BackupPrimaryReadiness } }>('/api/v1/db/backup-status', { signal: backupCheck.signal })
      .then(result => { if (!backupCheck.signal.aborted) setBackupReadiness(result.data.primaryDestinations ?? null); })
      .catch(() => undefined);
    // Back from Google's consent page.
    const address = new URL(window.location.href);
    const result = address.searchParams.get('storage');
    if (result && RETURN_MESSAGES[result]) {
      setMessage(RETURN_MESSAGES[result]);
      address.searchParams.delete('storage');
      writeBrowserHistory('replace', window.history.state, address.pathname + address.search + address.hash);
    }
    const t = window.setInterval(refresh, 30_000);
    return () => { window.clearInterval(t); backupCheck.abort(); };
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
      setDropboxChecks({});
      setMessage({ ok: true, text: 'حُفظت إعدادات التخزين.' });
      void refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'تعذر حفظ الإعدادات' });
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    void copyTextToClipboard(text).then(copied => setMessage({ ok: copied, text: copied ? 'نُسخ إلى الحافظة.' : 'تعذّر النسخ إلى الحافظة.' }));
  };

  const q = status?.queue;
  const cloudSummary = (provider: 'dropbox' | 'gdrive') => {
    if (!status?.[provider].connected) return 'غير مربوط';
    if (status.primaryMedia === provider) return 'وجهة الوسائط الأساسية';
    return status[provider].enabled ? 'النسخ الإضافي مفعّل' : 'متاح للتصفح';
  };
  const checkDropbox = (check: DropboxCheck) => run(`dbx-check-${check}`, async () => {
    setDropboxChecks((prev) => ({ ...prev, [check]: undefined }));
    const result = await storageClient.verifyDropbox(check);
    setDropboxChecks((prev) => ({ ...prev, [check]: result }));
    const checks = [
      { label: 'ربط Dropbox', status: result.credentials },
      { label: 'مجلد Dropbox', status: result.folder },
      { label: 'قراءة ملفات Dropbox', status: result.read },
      { label: 'كتابة ملفات Dropbox', status: result.write },
    ];
    const problem = checks.find(item => item.status && item.status !== 'verified');
    setMessage(problem?.status ? { ok: false, text: problem.label + ' · ' + DROPBOX_CHECK_MESSAGES[problem.status] } : {
      ok: true, text: check === 'connection' ? 'نجح فحص الاتصال بمجلد Dropbox.' : 'تحقّق مدار من تفويض التطبيق للقراءة والكتابة في Dropbox.',
    });
  });
  const connectionCheck = dropboxChecks.connection;
  const permissionCheck = dropboxChecks.permissions;
  const bridgeCommand = `MADAR_URL=${window.location.origin} MADAR_BRIDGE_TOKEN=${token || '<الرمز>'} SHARE_PATH=${settings.share.displayPath || '/mnt/news'} node madar-bridge.mjs`;

  return (
    <form onSubmit={save} className="py-4 space-y-8" aria-label="التخزين">
      <section aria-labelledby="storage-overview" className="space-y-3">
        <h2 id="storage-overview" className="text-lg font-bold text-slate-900">التخزين</h2>
        <PrimaryStorageSettings settings={settings} status={status} backups={backupReadiness} disabled={saving}
          onChange={(key, value) => setSettings(previous => ({ ...previous, [key]: value }))}
          onScheduleChange={scheduledBackups => setSettings(previous => ({ ...previous, scheduledBackups }))} />
        <p className="text-sm text-slate-600 max-w-3xl leading-6">
          عند اختيار خادم مدار للوسائط، تعمل خيارات النسخ الإضافية إلى الخدمات المربوطة أدناه. يمكن تصفّح الملفات الموجودة أصلًا في الخدمة وإضافتها إلى المكتبة من مكانها.
        </p>
        {statusError && <p role="alert" className="text-sm text-red-700">{statusError}</p>}
        <dl className="grid grid-cols-2 lg:grid-cols-4 border-y border-slate-200 divide-x divide-x-reverse divide-slate-200">
          {[
            { label: 'Dropbox', value: cloudSummary('dropbox'), ok: !!status?.dropbox.connected },
            { label: 'Google Drive', value: cloudSummary('gdrive'), ok: !!status?.gdrive.connected },
            { label: 'المجلد المشترك', value: status?.primaryMedia === 'nas' && status.share.mode === 'direct' ? 'وجهة الوسائط الأساسية' : !status?.share.enabled ? 'غير مفعّل' : status.share.mode === 'direct' ? 'مركّب على الخادم' : status.share.bridgeOnline ? 'الجسر متصل' : status.share.mode === 'bridge' ? 'الجسر غير متصل' : 'بلا جسر', ok: (status?.primaryMedia === 'nas' || !!status?.share.enabled) && (status.share.mode === 'direct' || status.share.bridgeOnline) },
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
        {settings.primaryMedia === 'local' && <label className="flex items-start gap-3 min-h-11 text-sm max-w-3xl">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={!settings.keepLocalCopy} onChange={(e) => setSettings({ ...settings, keepLocalCopy: !e.target.checked })} />
          <span>
            <span className="font-semibold text-slate-900">وفّر مساحة الخادم</span>
            <span className="block text-slate-600">يُحذف ملف الخادم بعد التأكد من وجوده في Dropbox أو Google Drive، ويُقرأ منهما عند فتحه.</span>
          </span>
        </label>}
      </section>

      {/* Dropbox */}
      <fieldset className="space-y-4 border-t border-slate-200 pt-6" disabled={saving}>
        <legend className="text-lg font-bold text-slate-900 inline-flex items-center gap-2"><Cloud className="w-5 h-5 text-blue-600" aria-hidden="true" /> Dropbox</legend>
        <div className="flex flex-wrap items-center gap-2">
          {status && (status.dropbox.connected ? <StatusChip ok={false}>بيانات الربط محفوظة{status.dropbox.account ? ` · ${status.dropbox.account}` : ''}</StatusChip> : <StatusChip ok={false}>غير مربوط</StatusChip>)}
          {status?.dropbox.lastError && <StatusChip ok={false} warn>آخر خطأ: {status.dropbox.lastError}</StatusChip>}
        </div>
        {status?.dropbox.connected && !status.dropbox.enabled && (
          <p role="status" className="text-sm text-slate-700">الربط محفوظ والنسخ متوقف. يمكنك تصفح Dropbox الآن من مكتبة الوسائط. ولنسخ المواد تلقائياً، حدّد المجلد وفعّل «انسخ ملفات المكتبة إلى Dropbox» ثم اضغط «حفظ إعدادات التخزين».</p>
        )}
        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
          <label className="flex items-center gap-2 min-h-11 text-sm font-semibold">
            <input type="checkbox" className="w-4 h-4" checked={settings.dropbox.enabled} onChange={(e) => setSettings({ ...settings, dropbox: { ...settings.dropbox, enabled: e.target.checked } })} />
            انسخ ملفات المكتبة إلى Dropbox
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-800">المجلد في Dropbox</span>
            <input className={`${INPUT} mt-1`} dir="ltr" value={settings.dropbox.rootPath} onChange={(e) => setSettings({ ...settings, dropbox: { ...settings.dropbox, rootPath: e.target.value } })} placeholder="/مدار" />
          </label>
        </div>
        <div className="space-y-2 max-w-3xl">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => void checkDropbox('connection')}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> فحص الاتصال والمجلد
            </button>
            <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => void checkDropbox('permissions')}>
              <KeyRound className="w-4 h-4" aria-hidden="true" /> فحص أذونات القراءة والكتابة
            </button>
          </div>
          <p className="text-sm text-slate-600">يستخدم الفحص إعدادات Dropbox المحفوظة ويتحقق من الأذونات دون رفع ملفات.</p>
          <div aria-live="polite" className="space-y-2">
            {busy.startsWith('dbx-check-') && <p className="text-sm text-slate-600">جارٍ التحقق من Dropbox…</p>}
            {connectionCheck && (
              <dl className="space-y-1">
                <DropboxCheckRow label="تجديد تفويض Dropbox" result={connectionCheck.credentials} />
                <DropboxCheckAccount result={connectionCheck} />
                {connectionCheck.folder && <DropboxCheckRow label={<>عرض محتويات المجلد <bdi>{connectionCheck.root}</bdi></>} result={connectionCheck.folder} />}
              </dl>
            )}
            {permissionCheck && (
              <dl className="space-y-1">
                {permissionCheck.credentials !== 'verified' && <DropboxCheckRow label="تجديد تفويض فحص الأذونات" result={permissionCheck.credentials} />}
                <DropboxCheckAccount result={permissionCheck} />
                {permissionCheck.folder && <DropboxCheckRow label={<>الوصول إلى المجلد <bdi>{permissionCheck.root}</bdi></>} result={permissionCheck.folder} />}
                {permissionCheck.read && <DropboxCheckRow label="تفويض قراءة الملفات" result={permissionCheck.read} />}
                {permissionCheck.write && <DropboxCheckRow label="تفويض كتابة الملفات" result={permissionCheck.write} />}
              </dl>
            )}
          </div>
        </div>
        {status?.dropbox.managedByEnvironment ? (
          <div><p className="mb-1 text-sm font-semibold">يدير الخادم ربط Dropbox عبر متغيرات البيئة.</p><DropboxEnvironmentKeys /></div>
        ) : (
          <>
            {status?.dropbox.connected && (
              <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => run('dbx-off', async () => {
                if (!(await confirmDialog({ title: 'فصل Dropbox', message: 'يتوقف النسخ إلى Dropbox، والملفات التي لا توجد إلا فيه لن تُفتح حتى تعيد الربط. الملفات في Dropbox نفسها لا تُحذف.', confirmLabel: 'فصل', danger: true }))) return;
                setStatus(await storageClient.disconnect('dropbox'));
                setDropboxChecks({});
              })}>فصل Dropbox</button>
            )}
            <DropboxAuthorization connected={!!status?.dropbox.connected} onFeedback={setMessage} onConnected={next => {
              setStatus(next);
              setDropboxChecks({});
            }} />
          </>
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
            <input className={`${INPUT} mt-1`} dir="ltr" value={settings.gdrive.rootFolderId} onChange={(e) => setSettings({ ...settings, gdrive: { ...settings.gdrive, rootFolderId: e.target.value.trim() } })} placeholder="Folder ID" aria-describedby="gdrive-folder-hint" /><span id="gdrive-folder-hint" className="block text-xs text-slate-500 mt-1">معرّف مجلد قائم، مثلاً مجلد في Drive مشترك.</span>
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
                  <span className="flex items-center gap-1"><input className={`${INPUT} min-w-0`} dir="ltr" type={showDriveSecret ? 'text' : 'password'} autoComplete="off" aria-label="Client secret" placeholder="Client secret" value={drive.clientSecret} onChange={(e) => setDrive({ ...drive, clientSecret: e.target.value.trim() })} /><PasswordVisibilityButton visible={showDriveSecret} onClick={() => setShowDriveSecret(value => !value)} /></span>
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
            <span id="share-networks-hint" className="block text-xs text-slate-500 mt-1">نطاق في كل سطر (مثلاً <span dir="ltr">10.0.0.0/8</span>). من يتصل من هذه العناوين يُعدّ داخل المحطة.</span>
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
          <p className={`text-sm font-semibold ${message.ok ? 'text-emerald-800' : 'text-red-700'}`}>{message.text}</p>
        )}
      </div>
    </form>
  );
}
