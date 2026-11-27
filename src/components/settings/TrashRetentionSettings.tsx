import { useState } from 'react';
import { ArchiveRestore } from 'lucide-react';
import { apiService } from '../../services/api';
import { authClient } from '../../services/authClient';
import { dataStore } from '../../services/dataStore';
import { confirmDialog } from '../../services/dialogs';
import { SINGLETON_ID } from '../../shared/collections';
import { DEFAULT_TRASH_RETENTION_DAYS, MAX_TRASH_RETENTION_DAYS, TRASH_COLLECTIONS, TRASH_SECTIONS, trashRetentionError, type TrashCollection, type TrashRetentionDays } from '../../shared/trash';

type Draft = Partial<Record<TrashCollection, string>>;
const retentionOf = () => apiService.getSettings().trashRetentionDays ?? {};
const same = (a: TrashRetentionDays, b: TrashRetentionDays) => TRASH_COLLECTIONS.every(collection => a[collection] === b[collection]);

export function TrashRetentionSettings() {
  const fallback = authClient.getSession()?.trashRetentionDays ?? DEFAULT_TRASH_RETENTION_DAYS;
  const [saved, setSaved] = useState<TrashRetentionDays>(retentionOf);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const next = { ...saved };
  for (const collection of TRASH_COLLECTIONS) {
    const value = draft[collection];
    if (value === '') delete next[collection];
    else if (value !== undefined) next[collection] = Number(value);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || same(next, saved)) return;
    const error = trashRetentionError(next);
    if (error) {
      setStatus({ ok: false, text: error });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      if (TRASH_COLLECTIONS.some(collection => next[collection] !== saved[collection] && (next[collection] ?? fallback) > 0)) {
        const confirmed = await confirmDialog({
          title: 'تحديث مدد الحذف النهائي',
          message: 'تُحسب كل مدة من يوم نقل السجل إلى السلة. قد تحذف دورة التنظيف القادمة السجلات التي تجاوزت المدة الجديدة.',
          confirmLabel: 'حفظ المدد', danger: true,
        });
        if (!confirmed) return;
      }
      if (!same(retentionOf(), saved)) {
        setSaved(retentionOf());
        throw new Error('غيّر زميل مدد الاحتفاظ. راجع القيم الحالية ثم أعد الحفظ.');
      }
      apiService.saveSettings({ trashRetentionDays: next });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم حفظ المدد.');
      setSaved(next);
      setDraft({});
      setStatus({ ok: true, text: 'حُفظت مدد الاحتفاظ بالمحذوفات.' });
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : 'تعذّر حفظ مدد الاحتفاظ بالمحذوفات.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-labelledby="trash-retention-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 lg:col-span-2">
      <h3 id="trash-retention-title" className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <ArchiveRestore className="size-4 text-blue-600" aria-hidden="true" /> مدد الاحتفاظ بالمحذوفات
      </h3>
      <p id="trash-retention-help" className="mt-2 text-sm leading-relaxed text-slate-600">
        تحدد المدة بالأيام لكل نوع. اترك الحقل فارغًا لاستخدام {fallback ? `افتراضي الخادم البالغ ${fallback} يومًا` : 'افتراضي الخادم للاحتفاظ الدائم'}. اختر 0 للاحتفاظ دون حد زمني.
      </p>
      <fieldset disabled={busy} aria-describedby="trash-retention-help" className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {TRASH_COLLECTIONS.map(collection => (
          <label key={collection} className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium text-slate-800">
            <span>{TRASH_SECTIONS[collection].label}</span>
            <input
              type="number" inputMode="numeric" min={0} max={MAX_TRASH_RETENTION_DAYS} step={1} dir="ltr"
              value={draft[collection] ?? saved[collection] ?? ''}
              placeholder={String(fallback)}
              onChange={event => setDraft(previous => ({ ...previous, [collection]: event.target.value }))}
              className="min-h-11 w-24 shrink-0 rounded-lg border border-slate-300 px-3 text-slate-900 placeholder:text-slate-500"
            />
          </label>
        ))}
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || same(next, saved)} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? 'جارٍ الحفظ…' : 'حفظ مدد الاحتفاظ'}
        </button>
        {status && <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'text-sm text-emerald-800' : 'text-sm text-rose-800'}>{status.text}</p>}
      </div>
    </form>
  );
}
