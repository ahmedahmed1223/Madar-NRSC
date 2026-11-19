import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { confirmDialog } from '../../services/dialogs';
import { SINGLETON_ID } from '../../shared/collections';
import { newId } from '../../shared/ids';
import { MAX_STEP_TYPES, stepTypesError, stepTypesOf, type StepType } from '../../shared/productionCards';
import { MAX_STATIONS, stationScope, stationsError, stationsOf, type Station } from '../../shared/stations';

const INPUT = 'w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl bg-white text-sm text-slate-900';

/**
 * Stations of the newsroom (add, remove, main station and branches, which stations work together)
 * and the kinds of production-card steps with their weights.
 */
export function StationsSettings() {
  const [stations, setStations] = useState<Station[]>(() => stationsOf(apiService.getSettings()));
  const [types, setTypes] = useState<StepType[]>(() => stepTypesOf(apiService.getSettings()));
  const [baseline, setBaseline] = useState(() => JSON.stringify({ stations, types }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify({ stations, types }) !== baseline;
  const members = (id: string) => apiService.getUsers().filter((u) => u.stationId === id && !u.deletedAt).length;

  const patch = (id: string, changes: Partial<Station>) => setStations((list) => list.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  const setMain = (id: string | null) => setStations((list) => list.map((s) => ({ ...s, isMain: s.id === id ? true : undefined })));
  const toggleLink = (station: Station, otherId: string) => {
    const links = station.linkedIds || [];
    patch(station.id, { linkedIds: links.includes(otherId) ? links.filter((x) => x !== otherId) : [...links, otherId] });
  };
  const removeStation = async (station: Station) => {
    const count = members(station.id);
    if (count && !(await confirmDialog({ title: `حذف محطة ${station.name}`, message: `في المحطة ${count} من الزملاء؛ سيبقون في النظام بدون محطة حتى تنقلهم إلى محطة أخرى من «المستخدمون والصلاحيات». العمل الموثّق سابقاً يبقى محفوظاً.`, confirmLabel: 'حذف المحطة', cancelLabel: 'تراجع', danger: true }))) return;
    setStations((list) => list.filter((s) => s.id !== station.id).map((s) => (s.linkedIds ? { ...s, linkedIds: s.linkedIds.filter((x) => x !== station.id) } : s)));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const cleanStations = stations.map((s) => ({ ...s, name: s.name.trim() }));
    const cleanTypes = types.map((t) => ({ ...t, name: t.name.trim() }));
    const invalid = stationsError(cleanStations) || stepTypesError(cleanTypes);
    setSaved(false);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      apiService.saveSettings({ stations: cleanStations, cardStepTypes: cleanTypes });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم الحفظ');
      setStations(cleanStations);
      setTypes(cleanTypes);
      setBaseline(JSON.stringify({ stations: cleanStations, types: cleanTypes }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="py-4 space-y-8" aria-label="المحطات وبطاقات الإنتاج">
      <fieldset disabled={saving} className="space-y-3">
        <legend className="text-lg font-bold text-slate-900">المحطات</legend>
        <p className="text-sm text-slate-600 max-w-3xl">
          أضف أو احذف المحطات بحسب هيكل مؤسستك. المحطة الرئيسية تتابع كل الفروع، وكل فرع يتابع نفسه والمحطة الرئيسية والمحطات المرتبطة به. تُحدَّد محطة كل زميل من «المستخدمون والصلاحيات».
        </p>
        <label className="flex items-center gap-2 min-h-11 text-sm">
          <input type="radio" name="main-station" checked={!stations.some((s) => s.isMain)} onChange={() => setMain(null)} />
          بلا محطة رئيسية: كل المحطات متساوية
        </label>
        <ul className="space-y-3">
          {stations.map((station, index) => {
            const others = stations.filter((s) => s.id !== station.id);
            const open = station.linkedIds === undefined;
            const follows = [...stationScope(stations, station.id)].filter((id) => id !== station.id).map((id) => stations.find((s) => s.id === id)?.name);
            return (
              <li key={station.id} className="border border-slate-200 rounded-2xl bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48">
                    <label htmlFor={`station-name-${station.id}`} className="block text-sm font-bold text-slate-700 mb-1">اسم المحطة {index + 1}</label>
                    <input id={`station-name-${station.id}`} value={station.name} maxLength={60} required onChange={(e) => patch(station.id, { name: e.target.value })} className={INPUT} />
                  </div>
                  <label className="flex items-center gap-2 min-h-11 text-sm font-bold text-slate-700">
                    <input type="radio" name="main-station" checked={!!station.isMain} onChange={() => setMain(station.id)} />
                    المحطة الرئيسية
                  </label>
                  <span className="min-h-11 flex items-center text-sm text-slate-600">{members(station.id)} من الزملاء</span>
                  <button type="button" onClick={() => removeStation(station)} aria-label={`حذف محطة ${station.name}`} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-rose-200 text-rose-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {station.isMain ? (
                  <p className="text-sm text-slate-600">المحطة الرئيسية تتابع كل المحطات وتكلّف أي زميل فيها.</p>
                ) : others.length > 0 ? (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 min-h-11 text-sm">
                      <input type="checkbox" checked={open} onChange={(e) => patch(station.id, { linkedIds: e.target.checked ? undefined : [] })} />
                      تعمل مع كل المحطات
                    </label>
                    {!open && (
                      <div role="group" aria-label={`المحطات المرتبطة بمحطة ${station.name}`} className="flex flex-wrap gap-x-5 gap-y-1">
                        {others.map((other) => (
                          <label key={other.id} className="flex items-center gap-2 min-h-11 text-sm">
                            <input type="checkbox" checked={!!other.isMain || (station.linkedIds || []).includes(other.id)} disabled={!!other.isMain} onChange={() => toggleLink(station, other.id)} />
                            {other.name}
                            {other.isMain ? ' (الرئيسية)' : ''}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-slate-500">تتابع وتكلّف: {follows.length ? follows.join('، ') : 'نفسها فقط'}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {stations.length < MAX_STATIONS && (
          <button type="button" onClick={() => setStations((list) => [...list, { id: newId('st'), name: '' }])} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة محطة
          </button>
        )}
      </fieldset>

      <fieldset disabled={saving} className="space-y-3">
        <legend className="text-lg font-bold text-slate-900">أنواع مهام بطاقات الإنتاج</legend>
        <p className="text-sm text-slate-600 max-w-3xl">
          الوزن (من 1 إلى 10) يعبّر عن ثقل هذا النوع من العمل. نقاط المهمة = الوزن × درجة التعقيد (بسيطة 1، متوسطة 2، معقدة 3)، وبها تُقارن أعباء الأفراد والمحطات.
        </p>
        <ul className="space-y-2">
          {types.map((type, index) => (
            <li key={type.id} className="grid grid-cols-[1fr_6rem_auto] gap-2 items-end">
              <div>
                <label htmlFor={`type-name-${type.id}`} className="block text-xs font-bold text-slate-700 mb-1">نوع المهمة {index + 1}</label>
                <input id={`type-name-${type.id}`} value={type.name} maxLength={60} required onChange={(e) => setTypes((list) => list.map((t) => (t.id === type.id ? { ...t, name: e.target.value } : t)))} className={INPUT} />
              </div>
              <div>
                <label htmlFor={`type-weight-${type.id}`} className="block text-xs font-bold text-slate-700 mb-1">الوزن</label>
                <input id={`type-weight-${type.id}`} type="number" min={1} max={10} step={1} inputMode="numeric" value={type.weight} onChange={(e) => setTypes((list) => list.map((t) => (t.id === type.id ? { ...t, weight: Math.round(Number(e.target.value)) } : t)))} className={INPUT} />
              </div>
              <button type="button" disabled={types.length === 1} onClick={() => setTypes((list) => list.filter((t) => t.id !== type.id))} aria-label={`حذف نوع ${type.name}`} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-rose-200 text-rose-700 disabled:opacity-40">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        {types.length < MAX_STEP_TYPES && (
          <button type="button" onClick={() => setTypes((list) => [...list, { id: newId('ty'), name: '', weight: 2 }])} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة نوع مهمة
          </button>
        )}
      </fieldset>

      {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
      {saved && <p role="status" className="text-sm font-bold text-emerald-700">حُفظت المحطات وأنواع المهام</p>}
      <button type="submit" disabled={!dirty || saving} className="min-h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
        <Save className="w-4 h-4" />
        {saving ? 'جارٍ الحفظ…' : 'حفظ'}
      </button>
    </form>
  );
}
