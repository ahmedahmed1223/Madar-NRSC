import { useId, useState, type FormEvent } from 'react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { notify } from '../../services/notify';
import { SINGLETON_ID } from '../../shared/collections';
import { stationsError, stationsOf, type Station } from '../../shared/stations';

const input = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const action = 'min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50';

export function StationNetworkEditor({ station, stations, onClose }: {
  station: Station;
  stations: readonly Station[];
  onClose: () => void;
}) {
  const formId = useId();
  const [baseline] = useState(() => JSON.stringify(stationsOf(apiService.getSettings())));
  const [draft, setDraft] = useState(station);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(station);
  const peers = stations.filter(peer => peer.id !== station.id && !peer.isMain);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    const latest = stationsOf(apiService.getSettings());
    if (JSON.stringify(latest) !== baseline) {
      setError('تغيّرت إعدادات المحطات منذ فتح المحرر. أغلقه وافتح المحطة مجددًا لمراجعة التغييرات.');
      return;
    }
    const next = latest.map(peer => peer.id === station.id
      ? { ...draft, name: draft.name.trim(), isMain: draft.isMain || undefined }
      : draft.isMain && peer.isMain ? { ...peer, isMain: undefined } : peer);
    const invalid = stationsError(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      apiService.saveSettings({ stations: next });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم حفظ المحطة');
      notify({ type: 'success', message: 'حُفظت المحطة في الخريطة' });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر حفظ المحطة');
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={save} aria-label="تحرير المحطة في الخريطة" className="border-t border-slate-200 p-4">
    <fieldset disabled={saving} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={formId} className="space-y-1 text-xs font-bold text-slate-800">
          <span>اسم المحطة</span>
          <input id={formId} required maxLength={60} className={input} value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={!!draft.isMain} onChange={event => setDraft({ ...draft, isMain: event.target.checked })} />
          تعيينها محطة رئيسية
        </label>
      </div>
      {!draft.isMain && <fieldset className="space-y-2">
        <legend className="text-xs font-bold text-slate-800">روابط التعاون الصادرة من هذه المحطة</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.linkedIds === undefined} onChange={event => setDraft({ ...draft, linkedIds: event.target.checked ? undefined : [] })} />
          التعاون المفتوح مع المحطات غير المقيدة
        </label>
        {draft.linkedIds !== undefined && <div className="flex flex-wrap gap-x-5">
          {peers.map(peer => <label key={peer.id} className="flex min-h-11 items-center gap-2 break-words text-sm">
            <input type="checkbox" checked={draft.linkedIds?.includes(peer.id) || false} onChange={event => {
              const selected = draft.linkedIds || [];
              setDraft({ ...draft, linkedIds: event.target.checked ? [...selected, peer.id] : selected.filter(id => id !== peer.id) });
            }} />
            {peer.name}
          </label>)}
        </div>}
      </fieldset>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!dirty || saving} className="min-h-11 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'جارٍ الحفظ…' : 'حفظ المحطة'}</button>
        <button type="button" onClick={onClose} className={action}>إلغاء تعديل المحطة</button>
      </div>
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm font-bold text-rose-700">{error}</p>}
  </form>;
}
