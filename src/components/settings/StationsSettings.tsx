import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { confirmDialog } from '../../services/dialogs';
import { SINGLETON_ID } from '../../shared/collections';
import { newId } from '../../shared/ids';
import { MAX_STEP_TYPES, stepTypesError, stepTypesOf, type StepType } from '../../shared/productionCards';
import { countLabel } from '../../shared/arabicPlural';
import { MAX_STATION_GROUPS, MAX_STATIONS, stationGroupsError, stationGroupsOf, stationScope, stationsError, stationsOf, type Station, type StationGroup } from '../../shared/stations';

const INPUT = 'w-full min-h-11 px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-900';
const COLLEAGUES = { one: 'زميل واحد', two: 'زميلان', few: 'زملاء', many: 'زميلاً', zero: 'لا زملاء' };
const TYPE_ROW = 'grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem_2.75rem] gap-2';
const STEPS = { one: 'خطوة واحدة', two: 'خطوتان', few: 'خطوات', many: 'خطوة' };

type Usage = Awaited<ReturnType<typeof apiService.getStationUsage>>;

/** How many card steps (finished ones included) use each step type: deleting a used type changes history and workload points. */
function stepTypeUsage(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of apiService.getCards()) for (const step of card.steps || []) counts.set(step.type, (counts.get(step.type) || 0) + 1);
  return counts;
}

/**
 * Stations of the newsroom (add, remove, main station and branches, which stations work together),
 * groups of stations (regions a general manager can follow) and the kinds of assignment steps with
 * their weights. Removing a saved station goes through the server: its colleagues and open steps
 * move to a station the administrator picks, and its name stays on finished work.
 */
export function StationsSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [stations, setStations] = useState<Station[]>(() => stationsOf(apiService.getSettings()));
  const [groups, setGroups] = useState<StationGroup[]>(() => stationGroupsOf(apiService.getSettings()));
  const [types, setTypes] = useState<StepType[]>(() => stepTypesOf(apiService.getSettings()));
  const [baseline, setBaseline] = useState(() => JSON.stringify({ stations, groups, types }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [removal, setRemoval] = useState<{ station: Station; usage: Usage | null; replacementId: string; error: string; busy: boolean } | null>(null);
  const dirty = JSON.stringify({ stations, groups, types }) !== baseline;
  const savedStations = (JSON.parse(baseline).stations as Station[]) || [];
  const members = (id: string) => apiService.getUsers().filter((u) => u.stationId === id && !u.deletedAt).length;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  // A message about an earlier attempt goes as soon as the form changes again.
  useEffect(() => {
    setError('');
    if (dirty) setSaved(false);
  }, [stations, groups, types, dirty]);

  const reload = () => {
    const settings = apiService.getSettings();
    const next = { stations: stationsOf(settings), groups: stationGroupsOf(settings), types: stepTypesOf(settings) };
    setStations(next.stations);
    setGroups(next.groups);
    setTypes(next.types);
    setBaseline(JSON.stringify(next));
    setSaved(false);
  };

  const patch = (id: string, changes: Partial<Station>) => setStations((list) => list.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  const setMain = (id: string | null) => setStations((list) => list.map((s) => ({ ...s, isMain: s.id === id ? true : undefined })));
  const toggleLink = (station: Station, otherId: string) => {
    const links = station.linkedIds || [];
    patch(station.id, { linkedIds: links.includes(otherId) ? links.filter((x) => x !== otherId) : [...links, otherId] });
  };
  const dropLocally = (stationId: string) => {
    setStations((list) => list.filter((s) => s.id !== stationId).map((s) => (s.linkedIds ? { ...s, linkedIds: s.linkedIds.filter((x) => x !== stationId) } : s)));
    setGroups((list) => list.map((g) => ({ ...g, stationIds: g.stationIds.filter((x) => x !== stationId) })));
  };

  const removeStation = async (station: Station) => {
    // A station added in this form and never saved has nothing attached to it.
    if (!savedStations.some((s) => s.id === station.id)) return dropLocally(station.id);
    if (dirty) {
      setError('احفظ تعديلاتك الحالية أو تراجع عنها قبل حذف محطة محفوظة.');
      return;
    }
    setRemoval({ station, usage: null, replacementId: '', error: '', busy: true });
    try {
      const usage = await apiService.getStationUsage(station.id);
      setRemoval({ station, usage, replacementId: '', error: '', busy: false });
    } catch (err) {
      setRemoval({ station, usage: null, replacementId: '', error: err instanceof Error ? err.message : 'تعذر قراءة ما يتبع المحطة', busy: false });
    }
  };

  const confirmRemoval = async () => {
    if (!removal?.usage) return;
    const needsReplacement = removal.usage.members.length > 0 || removal.usage.openSteps.length > 0 || removal.usage.openCardsOwned > 0;
    if (needsReplacement && !removal.replacementId) {
      setRemoval({ ...removal, error: 'اختر المحطة التي ينتقل إليها الزملاء والمهام المفتوحة.' });
      return;
    }
    setRemoval({ ...removal, busy: true, error: '' });
    try {
      const result = await apiService.removeStation(removal.station.id, removal.replacementId || undefined);
      reload();
      setRemoval(null);
      setSaved(false);
      setError('');
      const target = stations.find((s) => s.id === removal.replacementId)?.name;
      await confirmDialog({ title: `حُذفت محطة ${removal.station.name}`, message: target ? `انتقل ${result.movedUsers} من الزملاء و${result.movedSteps} مهمة مفتوحة إلى ${target}. الأعمال المنجزة تبقى منسوبة إلى «${removal.station.name}» في التقارير.` : 'لم يكن في المحطة زملاء ولا مهام مفتوحة. يبقى اسمها في سجل الأعمال المنجزة.', confirmLabel: 'حسناً', cancelLabel: 'إغلاق' });
    } catch (err) {
      setRemoval((r) => (r ? { ...r, busy: false, error: err instanceof Error ? err.message : 'تعذر حذف المحطة' } : r));
    }
  };

  const removeType = async (type: StepType) => {
    const uses = stepTypeUsage().get(type.id) || 0;
    if (uses && !(await confirmDialog({ title: `حذف نوع «${type.name}»`, message: `تستخدمه ${countLabel(uses, STEPS)} في التكليفات (المنجزة منها أيضاً). ستظهر هذه الخطوات بعد الحذف كـ«مهمة» بوزن 1، فتتغير نقاط الأعباء وتقارير المحطات بأثر رجعي. يُفضّل إعادة تسميته أو تعديل وزنه بدلاً من حذفه.`, confirmLabel: 'حذف رغم ذلك', cancelLabel: 'إبقاء النوع', danger: true }))) return;
    setTypes((list) => list.filter((t) => t.id !== type.id));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const cleanStations = stations.map((s) => ({ ...s, name: s.name.trim() }));
    const cleanGroups = groups.map((g) => ({ ...g, name: g.name.trim() }));
    const cleanTypes = types.map((t) => ({ ...t, name: t.name.trim() }));
    const invalid = stationsError(cleanStations) || stationGroupsError(cleanGroups, cleanStations) || stepTypesError(cleanTypes);
    setSaved(false);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      apiService.saveSettings({ stations: cleanStations, stationGroups: cleanGroups, cardStepTypes: cleanTypes });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم الحفظ');
      setStations(cleanStations);
      setGroups(cleanGroups);
      setTypes(cleanTypes);
      setBaseline(JSON.stringify({ stations: cleanStations, groups: cleanGroups, types: cleanTypes }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const usageCount = removal?.usage ? removal.usage.members.length + removal.usage.openSteps.length + removal.usage.openCardsOwned : 0;
  const typeUses = stepTypeUsage();

  return (
    <form onSubmit={save} className="py-4 space-y-8" aria-label="المحطات والتكليفات">
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
            const follows = [...stationScope(stations, station.id, groups)].filter((id) => id !== station.id).map((id) => stations.find((s) => s.id === id)?.name);
            const restrictedOthers = others.filter((o) => !o.isMain && o.linkedIds !== undefined && !o.linkedIds.includes(station.id));
            return (
              <li key={station.id} className="border border-slate-200 rounded-xl bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48">
                    <label htmlFor={`station-name-${station.id}`} className="block text-sm font-bold text-slate-700 mb-1">اسم المحطة {index + 1}</label>
                    <input id={`station-name-${station.id}`} value={station.name} maxLength={60} required onChange={(e) => patch(station.id, { name: e.target.value })} className={INPUT} />
                  </div>
                  <label className="flex items-center gap-2 min-h-11 text-sm font-bold text-slate-700">
                    <input type="radio" name="main-station" checked={!!station.isMain} onChange={() => setMain(station.id)} />
                    المحطة الرئيسية
                  </label>
                  <span className="min-h-11 flex items-center text-sm text-slate-600 tabular-nums">{countLabel(members(station.id), COLLEAGUES)}</span>
                  <button type="button" onClick={() => void removeStation(station)} aria-label={`حذف محطة ${station.name}`} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {station.isMain ? (
                  <p className="text-sm text-slate-600">المحطة الرئيسية تتابع كل المحطات وتكلّف أي زميل فيها.</p>
                ) : others.length > 0 ? (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 min-h-11 text-sm">
                      <input type="checkbox" checked={open} onChange={(e) => patch(station.id, { linkedIds: e.target.checked ? undefined : [] })} />
                      مفتوحة لكل المحطات غير المقيّدة
                    </label>
                    {open && restrictedOthers.length > 0 && (
                      <p className="text-xs text-amber-800">لا تشمل المحطات المقيّدة التي لم تربطها بها: {restrictedOthers.map((o) => o.name).join('، ')}.</p>
                    )}
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
          <button type="button" onClick={() => setStations((list) => [...list, { id: newId('st'), name: '' }])} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-lg border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة محطة
          </button>
        )}
      </fieldset>

      {removal && (
        <section role="dialog" aria-modal="false" aria-labelledby="station-removal-title" className="border-2 border-rose-200 rounded-2xl bg-rose-50/40 p-4 space-y-3">
          <h3 id="station-removal-title" className="text-base font-bold text-rose-900">حذف محطة {removal.station.name}</h3>
          {!removal.usage && removal.busy && <p role="status" className="text-sm text-slate-700">جارٍ جمع ما يتبع المحطة…</p>}
          {removal.usage && (
            <>
              {usageCount === 0 ? (
                <p className="text-sm text-slate-700">لا زملاء ولا مهام مفتوحة في هذه المحطة. يبقى اسمها في سجل الأعمال المنجزة.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <div>
                    <h4 className="font-bold text-slate-800">الزملاء ({removal.usage.members.length})</h4>
                    <ul className="list-disc pr-5 text-slate-700 max-h-40 overflow-auto">
                      {removal.usage.members.map((m) => <li key={m.id}>{m.fullName}</li>)}
                      {!removal.usage.members.length && <li className="list-none">لا أحد</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">المهام المفتوحة ({removal.usage.openSteps.length})</h4>
                    <ul className="list-disc pr-5 text-slate-700 max-h-40 overflow-auto">
                      {removal.usage.openSteps.map((s) => <li key={`${s.cardId}-${s.stepId}`}>{s.cardTitle}{s.assigneeName ? ` — ${s.assigneeName}` : ''}</li>)}
                      {!removal.usage.openSteps.length && <li className="list-none">لا شيء</li>}
                    </ul>
                    {removal.usage.openCardsOwned > 0 && <p className="text-xs text-slate-600 mt-1">و{removal.usage.openCardsOwned} تكليفاً جارياً تملكه المحطة.</p>}
                  </div>
                </div>
              )}
              {removal.usage.managers.length > 0 && <p className="text-xs text-slate-600">يتابعها {removal.usage.managers.map((m) => m.fullName).join('، ')}؛ تُزال من قائمتهم.</p>}
              {usageCount > 0 && (
                <div className="max-w-sm">
                  <label htmlFor="station-replacement" className="block text-sm font-bold text-slate-700 mb-1">ينتقلون إلى محطة *</label>
                  <select id="station-replacement" value={removal.replacementId} onChange={(e) => setRemoval({ ...removal, replacementId: e.target.value, error: '' })} className={INPUT}>
                    <option value="">اختر المحطة البديلة</option>
                    {stations.filter((s) => s.id !== removal.station.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          {removal.error && <p role="alert" className="text-sm font-bold text-rose-700">{removal.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={removal.busy || !removal.usage} onClick={() => void confirmRemoval()} className="min-h-11 px-4 rounded-xl bg-rose-700 text-white text-sm font-bold disabled:opacity-50">
              {removal.busy && removal.usage ? 'جارٍ الحذف…' : usageCount ? 'نقلهم وحذف المحطة' : 'حذف المحطة'}
            </button>
            <button type="button" disabled={removal.busy && !!removal.usage} onClick={() => setRemoval(null)} className="min-h-11 px-4 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">
              تراجع
            </button>
          </div>
        </section>
      )}

      <fieldset disabled={saving} className="space-y-3">
        <legend className="text-lg font-bold text-slate-900">مجموعات المحطات (المناطق)</legend>
        <p className="text-sm text-slate-600 max-w-3xl">
          تجمع عدة محطات تحت اسم واحد (مثل «منطقة الشمال»). يُسنَد للمدير العام مجموعة أو أكثر فيتابع كل محطاتها، وتظهر المجموعات في الهيكل التنظيمي.
        </p>
        {groups.length === 0 && <p className="text-sm text-slate-500">لا توجد مجموعات بعد.</p>}
        <ul className="space-y-3">
          {groups.map((group, index) => (
            <li key={group.id} className="border border-slate-200 rounded-xl bg-white p-4 space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48">
                  <label htmlFor={`group-name-${group.id}`} className="block text-sm font-bold text-slate-700 mb-1">اسم المجموعة {index + 1}</label>
                  <input id={`group-name-${group.id}`} value={group.name} maxLength={60} required onChange={(e) => setGroups((list) => list.map((g) => (g.id === group.id ? { ...g, name: e.target.value } : g)))} className={INPUT} />
                </div>
                <button type="button" onClick={() => setGroups((list) => list.filter((g) => g.id !== group.id))} aria-label={`حذف مجموعة ${group.name}`} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div role="group" aria-label={`محطات مجموعة ${group.name}`} className="flex flex-wrap gap-x-5 gap-y-1">
                {stations.map((station) => (
                  <label key={station.id} className="flex items-center gap-2 min-h-11 text-sm">
                    <input
                      type="checkbox"
                      checked={group.stationIds.includes(station.id)}
                      onChange={() => setGroups((list) => list.map((g) => (g.id === group.id ? { ...g, stationIds: g.stationIds.includes(station.id) ? g.stationIds.filter((x) => x !== station.id) : [...g.stationIds, station.id] } : g)))}
                    />
                    {station.name || 'محطة بلا اسم'}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {groups.length < MAX_STATION_GROUPS && (
          <button type="button" onClick={() => setGroups((list) => [...list, { id: newId('grp'), name: '', stationIds: [] }])} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-lg border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة مجموعة
          </button>
        )}
      </fieldset>

      <fieldset disabled={saving} className="space-y-3">
        <legend className="text-lg font-bold text-slate-900">أنواع خطوات التكليفات</legend>
        <p className="text-sm text-slate-600 max-w-3xl">
          الوزن (من 1 إلى 10) يعبّر عن ثقل هذا النوع من العمل. نقاط المهمة = الوزن × درجة التعقيد (بسيطة 1، متوسطة 2، معقدة 3)، وبها تُقارن أعباء الأفراد والمحطات.
        </p>
        <div className={`${TYPE_ROW} px-1 text-xs font-bold text-slate-600`} aria-hidden="true">
          <span>النوع</span>
          <span>الوزن</span>
          <span className="hidden sm:block">الاستخدام</span>
          <span />
        </div>
        <ul className="space-y-2">
          {types.map((type, index) => {
            const uses = typeUses.get(type.id) || 0;
            return (
              <li key={type.id} className={`${TYPE_ROW} items-center`}>
                <div>
                  <label htmlFor={`type-name-${type.id}`} className="sr-only">نوع المهمة {index + 1}</label>
                  <input id={`type-name-${type.id}`} value={type.name} maxLength={60} required aria-describedby={`type-uses-${type.id}`} onChange={(e) => setTypes((list) => list.map((t) => (t.id === type.id ? { ...t, name: e.target.value } : t)))} className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`type-weight-${type.id}`} className="sr-only">وزن {type.name || `نوع المهمة ${index + 1}`}</label>
                  <input id={`type-weight-${type.id}`} type="number" min={1} max={10} step={1} inputMode="numeric" value={type.weight} onChange={(e) => setTypes((list) => list.map((t) => (t.id === type.id ? { ...t, weight: Math.round(Number(e.target.value)) } : t)))} className={`${INPUT} tabular-nums`} />
                </div>
                <p id={`type-uses-${type.id}`} className="hidden sm:block text-xs text-slate-500">{uses ? `في ${countLabel(uses, STEPS)}` : 'غير مستخدم'}</p>
                <button type="button" disabled={types.length === 1} onClick={() => void removeType(type)} aria-label={`حذف نوع ${type.name}`} title="حذف النوع" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-40">
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {types.length < MAX_STEP_TYPES && (
          <button type="button" onClick={() => setTypes((list) => [...list, { id: newId('ty'), name: '', weight: 2 }])} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-lg border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة نوع مهمة
          </button>
        )}
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-slate-100/95 border-t border-slate-200 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!dirty || saving} className="min-h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
          <Save className="w-4 h-4" aria-hidden="true" />
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
        {saved && <p role="status" className="text-sm font-bold text-emerald-700">حُفظت المحطات والمجموعات وأنواع المهام</p>}
        {dirty && !saving && !error && <p className="text-sm text-amber-800">لديك تعديلات غير محفوظة.</p>}
      </div>
    </form>
  );
}
