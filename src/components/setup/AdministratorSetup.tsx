import { useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from '../../types';
import { apiFetch } from '../../services/http';
import { dataStore } from '../../services/dataStore';
import type { EntityRow } from '../../shared/collections';
import { RbacService } from '../../services/rbacService';
import { validatePasswordStrength } from '../../shared/passwords';
import { PasswordFeedback, PasswordVisibilityButton } from '../auth/PasswordFields';

const fieldClass = 'block mt-1 w-full min-h-11 px-3 rounded-lg border border-slate-300 bg-white text-slate-900';
const buttonClass = 'min-h-11 px-4 rounded-lg border border-slate-300 text-sm font-bold disabled:opacity-50';

export function AdministratorSetup({ currentUser, busy, onBack, onContinue, onSkip }: {
  currentUser: User; busy: boolean; onBack: () => void; onContinue: () => void; onSkip: () => void;
}) {
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role);
  const canCreate = isAdmin && RbacService.hasPermission(currentUser, 'users.create') && RbacService.hasPermission(currentUser, 'users.manage_roles_permissions');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    const email = String(form.get('email') || '').trim();
    const invalid = validatePasswordStrength(password);
    if (invalid || password !== form.get('confirmation')) {
      setError(invalid || 'تأكيد كلمة المرور غير مطابق');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { row } = await apiFetch<{ row: EntityRow }>('/api/v1/admin/setup/administrator', { method: 'POST', json: { fullName: form.get('fullName'), email, role: form.get('role'), password }, signal: AbortSignal.timeout(20_000) });
      dataStore.mergeSearchRows([row]);
      setCreated(email);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4 max-w-2xl text-sm">
      {isAdmin && <p>دخلت بحساب الإدارة <b>{currentUser.fullName}</b> (<bdi>{currentUser.email}</bdi>). يمكنك متابعة الإعداد بهذا الحساب.</p>}
      {canCreate && !creating && !created && <button type="button" className={buttonClass} onClick={() => setCreating(true)}>إنشاء حساب مسؤول</button>}
      {!isAdmin && <p>يتولى مدير النظام إنشاء حسابات الإدارة. يمكنك متابعة إعداد المؤسسة.</p>}
      {created && <p role="status">أُنشئ حساب المسؤول <bdi>{created}</bdi>. سلّم كلمة المرور المؤقتة لصاحب الحساب ليغيّرها عند أول دخول.</p>}
      {creating && (
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label>اسم المسؤول<input name="fullName" required maxLength={120} autoComplete="off" className={fieldClass} /></label>
          <label>بريد المسؤول<input name="email" type="email" dir="ltr" required maxLength={254} autoComplete="off" className={fieldClass} /></label>
          <label className="sm:col-span-2">مستوى الإدارة<select name="role" defaultValue="ADMIN" className={fieldClass}><option value="ADMIN">مدير النظام</option>{currentUser.role === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">مدير النظام العام</option>}</select></label>
          <label>كلمة المرور المؤقتة<input type={showPasswords ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} dir="ltr" autoComplete="new-password" name="password" required minLength={10} maxLength={200} aria-describedby="admin-password-hint" className={fieldClass} /></label>
          <label>تأكيد كلمة المرور<input type={showPasswords ? 'text' : 'password'} value={confirmation} onChange={event => setConfirmation(event.target.value)} dir="ltr" autoComplete="new-password" name="confirmation" required className={fieldClass} /></label>
          <p id="admin-password-hint" className="text-slate-600 sm:col-span-2">استخدم عشرة أحرف وأرقام على الأقل. يختار المسؤول كلمة مرور خاصة به عند أول دخول.</p>
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2"><PasswordFeedback password={password} confirmation={confirmation} /><PasswordVisibilityButton visible={showPasswords} onClick={() => setShowPasswords(value => !value)} /></div>
          {error && <p role="alert" className="text-rose-700 sm:col-span-2">{error}</p>}
          <button type="submit" disabled={saving} className={buttonClass}>{saving ? 'جارٍ الإنشاء…' : 'حفظ حساب المسؤول'}</button>
          <button type="button" disabled={saving} className={buttonClass} onClick={() => { setCreating(false); setError(''); }}>إلغاء</button>
        </form>
      )}
      {!creating && <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200">
        <button type="button" disabled={busy} className={`${buttonClass} bg-blue-600 text-white`} onClick={isAdmin ? onContinue : onSkip}>{created || !isAdmin ? 'متابعة' : 'متابعة بالحساب الحالي'}</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={onBack}>السابق</button>
      </div>}
    </div>
  );
}
