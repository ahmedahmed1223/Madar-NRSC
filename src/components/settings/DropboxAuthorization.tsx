import { useRef, useState, type KeyboardEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { storageClient } from '../../services/storageClient';
import { dropboxAuthorizationUrl, validDropboxAppKey, validDropboxTeamMemberId, type DropboxAccountMode, type DropboxTeamMember } from '../../shared/dropboxAuthorization';
import type { StorageStatus } from '../../shared/storage';
import { PasswordVisibilityButton } from '../auth/PasswordFields';

const input = 'block w-full min-w-0 min-h-11 mt-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900';

export function DropboxEnvironmentKeys() {
  return <p className="text-sm leading-6 text-slate-600">للربط من إعدادات الخادم، عيّن <bdi>DROPBOX_APP_KEY</bdi> و<bdi>DROPBOX_APP_SECRET</bdi> و<bdi>DROPBOX_REFRESH_TOKEN</bdi> ثم أعد تشغيل الخدمة. مع تفويض فريق، يمكنك تحديد العضو بواسطة <bdi>DROPBOX_TEAM_MEMBER_ID</bdi> وتثبيت جذر مساحة الفريق بواسطة <bdi>DROPBOX_TEAM_NAMESPACE_ID</bdi>.</p>;
}

export function DropboxAuthorization({ connected, onConnected, onFeedback }: {
  connected: boolean;
  onConnected: (status: StorageStatus) => void;
  onFeedback: (message: { ok: boolean; text: string }) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [code, setCode] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [method, setMethod] = useState<'code' | 'token'>('code');
  const [accountMode, setAccountMode] = useState<DropboxAccountMode>('automatic');
  const [teamMemberId, setTeamMemberId] = useState('');
  const [members, setMembers] = useState<DropboxTeamMember[]>([]);
  const [memberCursor, setMemberCursor] = useState<string>();
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const validKey = validDropboxAppKey(appKey);
  const canConnect = validKey && Boolean(appSecret && (method === 'code' ? code : refreshToken)) && (accountMode === 'automatic' || validDropboxTeamMemberId(teamMemberId));
  const busy = saving || loadingMembers;

  function resetMemberList() {
    setMembers([]);
    setMemberCursor(undefined);
  }

  async function loadMembers(cursor?: string) {
    if (busy || !validKey || !appSecret || !refreshToken) return;
    setLoadingMembers(true);
    setError('');
    try {
      const result = await storageClient.dropboxTeamMembers({ appKey, appSecret, refreshToken }, cursor);
      setMembers(previous => cursor ? [...previous, ...result.members.filter(member => !previous.some(item => item.id === member.id))] : result.members);
      setMemberCursor(result.cursor);
      if (!cursor && !result.members.length && !result.cursor) setError('لم يعثر Dropbox على أعضاء نشطين في هذا الفريق.');
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof TypeError) && reason.name !== 'TimeoutError' ? reason.message : 'تعذر عرض أعضاء فريق Dropbox. أعد المحاولة.');
    } finally {
      setLoadingMembers(false);
    }
  }

  async function connect() {
    if (!canConnect || busy) return;
    setSaving(true);
    setError('');
    try {
      const status = await storageClient.connectDropbox(appKey, appSecret, method === 'code' ? code : { refreshToken }, accountMode === 'member' ? teamMemberId : undefined);
      setAppKey('');
      setAppSecret('');
      setCode('');
      setRefreshToken('');
      setTeamMemberId('');
      resetMemberList();
      setShowSecret(false);
      if (details.current) details.current.open = false;
      onConnected(status);
      onFeedback({ ok: true, text: status.dropbox.folderNeedsSetup
        ? 'تم حفظ الربط بحساب Dropbox. لم يظهر مجلد التخزين المحفوظ في الحساب. يمكنك التحقق من المسار من إعدادات التخزين.'
        : 'تم التحقق من تفويض Dropbox وحفظ الربط.' });
    } catch (reason) {
      const text = reason instanceof Error && !(reason instanceof TypeError) && reason.name !== 'TimeoutError'
        ? reason.message
        : 'تعذر الحصول على رد الخادم. تحقق من حالة الربط ثم أعد المحاولة.';
      setError(text);
      onFeedback({ ok: false, text });
    } finally {
      setSaving(false);
    }
  }

  function submitCredentials(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement && event.target.type !== 'radio') {
      event.preventDefault();
      void connect();
    }
  }

  return <details ref={details} onKeyDown={submitCredentials} className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 p-4">
    <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-slate-900">{connected ? 'تجديد تفويض Dropbox' : 'ربط Dropbox'}</summary>
    <fieldset disabled={busy} className="mt-3 flex flex-wrap gap-x-5 text-sm">
      <legend className="font-semibold">طريقة الربط</legend>
      <label className="flex min-h-11 items-center gap-2"><input type="radio" name="dropbox-method" checked={method === 'code'} onChange={() => { setMethod('code'); setError(''); }} />طلب رمز موافقة من Dropbox</label>
      <label className="flex min-h-11 items-center gap-2"><input type="radio" name="dropbox-method" checked={method === 'token'} onChange={() => { setMethod('token'); setError(''); }} />لديّ Refresh token</label>
    </fieldset>
    <fieldset disabled={busy} className="mt-3 flex flex-wrap gap-x-5 text-sm">
      <legend className="font-semibold">حساب Dropbox للتخزين</legend>
      <label className="flex min-h-11 items-center gap-2"><input type="radio" name="dropbox-account" checked={accountMode === 'automatic'} onChange={() => { setAccountMode('automatic'); setError(''); }} />اختيار تلقائي</label>
      <label className="flex min-h-11 items-center gap-2"><input type="radio" name="dropbox-account" checked={accountMode === 'member'} onChange={() => { setAccountMode('member'); setError(''); }} />عضو من فريق Dropbox</label>
    </fieldset>
    <p className="text-sm text-slate-600">الاختيار التلقائي يستخدم الحساب المرتبط بالرمز، أو المسؤول الذي فوّض التطبيق إذا كان الرمز لفريق Dropbox.</p>
    {connected && <p className="mt-1 text-sm text-slate-600">عند تبديل الحساب أو جذر مساحة الفريق، تأكد من أن الحساب الجديد يستطيع فتح ملفات المكتبة المحفوظة في مساراتها السابقة.</p>}
    <ol className="mt-3 space-y-4 text-sm text-slate-700 list-decimal pr-5">
      {method === 'code' && <li>افتح تطبيقك في <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Dropbox App Console</a>. من تبويب Permissions فعّل <bdi>files.metadata.read</bdi> و<bdi>files.content.read</bdi> و<bdi>files.content.write</bdi> واحفظ الأذونات.</li>}
      {(method === 'code' || accountMode === 'member') && <li>مع تفويض فريق Dropbox، فعّل <bdi>team_data.member</bdi> و<bdi>account_info.read</bdi> و<bdi>{accountMode === 'member' ? 'members.read' : 'team_info.read'}</bdi>. لاستخدام مساحة الفريق، اختر تطبيقاً بصلاحية Full Dropbox.</li>}
      <li>انسخ بيانات التطبيق من تبويب Settings.
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label>App key<input dir="ltr" className={input} autoComplete="off" maxLength={40} value={appKey} disabled={busy} onChange={event => { setAppKey(event.target.value.trim()); setCode(''); setError(''); resetMemberList(); }} /></label>
          <div>
            <label htmlFor="dropbox-app-secret">App secret</label>
            <div className="flex items-center gap-1"><input id="dropbox-app-secret" dir="ltr" className={input} type={showSecret ? 'text' : 'password'} autoComplete="off" maxLength={200} value={appSecret} disabled={busy} onChange={event => { setAppSecret(event.target.value.trim()); setError(''); resetMemberList(); }} /><PasswordVisibilityButton visible={showSecret} onClick={() => setShowSecret(value => !value)} /></div>
          </div>
        </div>
      </li>
      {method === 'code' && <li>{validKey
        ? <a href={dropboxAuthorizationUrl(appKey)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-blue-700 underline"><ExternalLink className="h-4 w-4" aria-hidden="true" />افتح صفحة الموافقة في Dropbox</a>
        : <span>أدخل App key الصحيح ليظهر رابط الموافقة.</span>}
      </li>}
      <li>{method === 'code' ? <>
          <label>رمز التفويض من Dropbox<input className={`${input} sm:max-w-sm`} dir="ltr" autoComplete="off" spellCheck={false} maxLength={400} value={code} disabled={saving} onChange={event => { setCode(event.target.value.trim()); setError(''); }} /></label>
          <p className="mt-1 text-slate-600">بعد الموافقة، عد إلى هذه الصفحة والصق الرمز الذي عرضه Dropbox.</p>
        </> : <>
          <label>Refresh token<input type="password" className={`${input} sm:max-w-lg`} dir="ltr" autoComplete="off" spellCheck={false} maxLength={4096} value={refreshToken} disabled={busy} onChange={event => { setRefreshToken(event.target.value.trim()); setError(''); resetMemberList(); }} /></label>
          <p className="mt-1 text-slate-600">الصق رمز التجديد الصادر للتطبيق نفسه. يتحقق الخادم منه قبل حفظه.</p>
        </>}
      </li>
      {accountMode === 'member' && <li>
        {method === 'token' && <div className="mb-2">
          {!members.length && !memberCursor && <button type="button" className="min-h-11 font-semibold text-blue-700 underline disabled:opacity-50" disabled={busy || !validKey || !appSecret || !refreshToken} onClick={() => void loadMembers()}>{loadingMembers ? 'جارٍ عرض الأعضاء…' : 'عرض أعضاء الفريق النشطين'}</button>}
          {members.length > 0 && <label>عضو الفريق النشط<select className={`${input} sm:max-w-lg`} disabled={busy} value={members.some(member => member.id === teamMemberId) ? teamMemberId : ''} onChange={event => { setTeamMemberId(event.target.value); setError(''); }}>
            <option value="">اختر العضو</option>
            {members.map(member => <option key={member.id} value={member.id}>{member.name}{member.email ? ` · ${member.email}` : ''}</option>)}
          </select></label>}
          {memberCursor && <button type="button" className="min-h-11 font-semibold text-blue-700 underline disabled:opacity-50" disabled={busy} onClick={() => void loadMembers(memberCursor)}>{loadingMembers ? 'جارٍ عرض الأعضاء…' : 'عرض المزيد من الأعضاء'}</button>}
        </div>}
        <label>معرّف عضو الفريق<input type="text" placeholder="dbmid:…" className={`${input} sm:max-w-lg`} dir="ltr" autoComplete="off" spellCheck={false} maxLength={134} value={teamMemberId} disabled={busy} onChange={event => { setTeamMemberId(event.target.value.trim()); setError(''); }} /></label>
      </li>}
    </ol>
    <button type="button" disabled={!canConnect || busy} onClick={() => void connect()} className="mt-2 min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'جارٍ الربط…' : 'ربط'}</button>
    {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    <details className="mt-4 text-sm"><summary className="cursor-pointer py-2 font-semibold">الربط عبر متغيرات البيئة</summary><DropboxEnvironmentKeys /></details>
  </details>;
}
