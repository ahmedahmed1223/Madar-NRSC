import { useState, type FormEvent } from 'react';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { confirmDialog, promptDialog } from '../../services/dialogs';
import { notify } from '../../services/notify';
import { useLiveData } from '../../hooks/useLiveData';
import { newId } from '../../shared/ids';

const usedLabel = (n: number) => (n === 1 ? 'برنامج واحد' : n === 2 ? 'برنامجين' : n <= 10 ? `${n} برامج` : `${n} برنامجاً`);

/** Program types (حواري، نشرة، صباحي…) used by the program form and the programs filter. */
export function ProgramTypesSettings({ currentUser }: { currentUser: User }) {
  useLiveData(['programTypes', 'programs']);
  const canEdit = RbacService.hasPermission(currentUser, 'system.settings');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const types = apiService.getProgramTypes();

  const confirmWrite = async (id: string, success: string) => {
    const outcome = await dataStore.awaitWrite('programTypes', id);
    if (outcome.ok) notify({ type: 'success', message: success });
    // A refusal is already announced with the server's reason (App's sync-error toast).
    else if (outcome.pending) notify({ type: 'warning', title: 'لم يؤكد الخادم الحفظ بعد', message: outcome.message || '' });
    return outcome.ok;
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !canEdit) return;
    setError('');
    const id = newId('ptype');
    setBusy('new');
    try {
      apiService.saveProgramType({ id, nameAr: name });
      if (await confirmWrite(id, 'أُضيف نوع البرنامج')) setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ نوع البرنامج');
    } finally {
      setBusy(null);
    }
  };

  const rename = async (id: string, current: string) => {
    if (busy || !canEdit) return;
    const next = await promptDialog({ title: 'تعديل نوع البرنامج', label: 'اسم النوع', defaultValue: current, required: true, confirmLabel: 'حفظ الاسم' });
    if (next === null || next.trim() === current.trim()) return;
    setBusy(id);
    try {
      apiService.saveProgramType({ id, nameAr: next });
      await confirmWrite(id, 'عُدّل اسم نوع البرنامج؛ تتحدث البرامج المرتبطة به تلقائياً');
    } catch (err) {
      notify({ type: 'error', message: err instanceof Error ? err.message : 'تعذر حفظ نوع البرنامج' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, label: string) => {
    if (busy || !canEdit) return;
    try {
      const used = apiService.countProgramsOfType(id);
      if (used > 0) {
        notify({ type: 'warning', message: `لا يمكن حذف النوع (${label}) لأنه مستخدم في ${usedLabel(used)}؛ انقل البرامج إلى نوع آخر أولاً.` });
        return;
      }
      if (!await confirmDialog({ title: 'حذف نوع البرنامج', message: `حذف النوع (${label}) من القائمة؟`, confirmLabel: 'حذف النوع', danger: true })) return;
      setBusy(id);
      apiService.deleteProgramType(id);
      await confirmWrite(id, 'حُذف نوع البرنامج');
    } catch (err) {
      notify({ type: 'warning', message: err instanceof Error ? err.message : 'تعذر حذف نوع البرنامج' });
    } finally {
      setBusy(null);
    }
  };

  const inputClass = 'mt-1 block w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-slate-900';
  return (
    <section className="space-y-4 py-4 border-t border-slate-200" aria-labelledby="program-types-heading">
      <div>
        <h2 id="program-types-heading" className="text-lg font-bold">أنواع البرامج</h2>
        <p className="text-sm text-slate-600">تظهر في نموذج البرنامج وفي تصفية قائمة البرامج.</p>
      </div>
      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3" aria-busy={busy === 'new'}>
          <label className="flex-1 min-w-48 text-sm">
            اسم نوع جديد
            <input required maxLength={80} value={name} disabled={busy === 'new'} onChange={(e) => { setName(e.target.value); setError(''); }} className={inputClass} aria-invalid={!!error} aria-describedby={error ? 'program-type-error' : undefined} />
          </label>
          <button type="submit" disabled={!!busy || !name.trim()} className="inline-flex items-center gap-2 min-h-11 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            <Plus className="w-4 h-4" />
            {busy === 'new' ? 'جارٍ الحفظ...' : 'إضافة نوع'}
          </button>
          {error && <p id="program-type-error" role="alert" className="basis-full text-sm text-rose-700">{error}</p>}
        </form>
      ) : (
        <p className="text-sm text-slate-600">إدارة أنواع البرامج تتطلب صلاحية إعدادات النظام.</p>
      )}
      {types.length === 0 && <p role="status" className="text-sm text-slate-600 py-2">لا توجد أنواع برامج بعد</p>}
      <ul className="divide-y divide-slate-200">
        {types.map((t) => {
          const label = t.nameAr || t.name || t.id;
          const used = apiService.countProgramsOfType(t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <strong className="block text-sm break-words">{label}</strong>
                <span className="text-xs text-slate-600">{used === 0 ? 'غير مستخدم' : `مستخدم في ${usedLabel(used)}`}</span>
              </div>
              {canEdit && (
                <>
                  <button type="button" disabled={!!busy} aria-label={`تعديل ${label}`} title={`تعديل ${label}`} onClick={() => void rename(t.id, label)} className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-blue-700 border border-slate-200 rounded-lg disabled:opacity-50">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button type="button" disabled={!!busy} aria-label={`حذف ${label}`} title={used ? 'مستخدم في برامج؛ انقلها إلى نوع آخر قبل الحذف' : `حذف ${label}`} onClick={() => void remove(t.id, label)} className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-red-700 border border-slate-200 rounded-lg disabled:opacity-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
