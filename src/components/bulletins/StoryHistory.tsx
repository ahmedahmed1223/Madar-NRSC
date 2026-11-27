import { useEffect, useState } from 'react';
import { plainText, storyStatusName, type BulletinStory } from '../../shared/bulletins';
import type { EntityRow } from '../../shared/collections';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { confirmDialog } from '../../services/dialogs';
import { apiFetch } from '../../services/http';
import { dataStore } from '../../services/dataStore';
import { Modal } from '../common/Modal';

interface Props {
  bulletinId: string;
  storyId: string;
  allowRestore: boolean;
  onClose: () => void;
  onRestored: (row: EntityRow) => void;
}

interface StoryVersions {
  current: EntityRow;
  versions: { version: number; data: BulletinStory; changedByName?: string; changedAt: string }[];
  canRestore: boolean;
}

export function StoryHistory({ bulletinId, storyId, allowRestore, onClose, onRestored }: Props) {
  const url = `/api/v1/bulletins/${encodeURIComponent(bulletinId)}/stories/${encodeURIComponent(storyId)}/history`;
  const [record, setRecord] = useState<StoryVersions>();
  const [selection, setSelection] = useState('current');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSelection('current');
    apiFetch<{ data: StoryVersions }>(url, { signal: controller.signal })
      .then(result => setRecord(result.data))
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'تعذر تحميل سجل النسخ'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, reload]);

  const selected = record?.versions.find(entry => String(entry.version) === selection);
  const preview: BulletinStory | undefined = selected?.data ?? record?.current.d;

  const restore = async () => {
    if (!record?.canRestore || !allowRestore || !selected || saving || loading) return;
    setSaving(true); setError('');
    try {
      if (!await confirmDialog({ title: 'استعادة نسخة كمسودة', message: 'سيُعاد النص المختار إلى القصة الحالية ويحتاج إلى اعتماد تحريري جديد. يبقى ترتيب القصة محفوظاً.', confirmLabel: 'استعادة المسودة' })) return;
      const result = await apiFetch<{ data: EntityRow }>(`${url}/restore`, { method: 'POST', json: { version: selected.version, baseV: record.current.v } });
      void dataStore.pull();
      onRestored(result.data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذرت استعادة المسودة');
    } finally { setSaving(false); }
  };

  return <Modal isOpen onClose={saving ? () => {} : onClose} title="سجل نسخ قصة النشرة" maxWidth="lg">
    <div className="space-y-3">
      {loading && <p role="status">جارٍ تحميل النسخ…</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {preview && record && <>
        <label className="block text-sm font-semibold">النسخة المعروضة
          <select value={selection} disabled={saving || loading} onChange={event => setSelection(event.target.value)} className="mt-1 block w-full min-h-11 rounded-lg border border-slate-300 px-2">
            <option value="current">النسخة الحالية ({record.current.v})</option>
            {record.versions.map(entry => <option key={entry.version} value={entry.version}>النسخة {entry.version} · عدّلها لاحقًا {entry.changedByName || 'النظام'} · {new Date(entry.changedAt).toLocaleString(appLocale(), zoneOptions())}</option>)}
          </select>
        </label>
        {record.versions.length === 0 && <p className="text-sm text-slate-600">تظهر النسخ السابقة بعد أول تعديل محفوظ.</p>}
        <section className="space-y-2 rounded-lg border border-slate-200 p-3">
          <h3 className="font-semibold break-words">{preview.slug}</h3>
          <p className="text-sm text-slate-600">{storyStatusName(preview.status)} · ترتيب {preview.rank}</p>
          <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{plainText(preview.script || '') || 'لا نص في هذه النسخة.'}</p>
        </section>
      </>}
      {record?.canRestore && !allowRestore && <p className="text-sm text-amber-800">احفظ تعديلاتك الحالية أو استبعدها قبل استعادة نسخة سابقة.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={loading || saving} onClick={() => setReload(value => value + 1)} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold">تحديث السجل</button>
        {record?.canRestore && selected && <button type="button" disabled={saving || loading || !allowRestore} onClick={() => void restore()} className="min-h-11 rounded-lg bg-blue-700 px-3 font-semibold text-white disabled:opacity-50">استعادة كمسودة</button>}
      </div>
    </div>
  </Modal>;
}
