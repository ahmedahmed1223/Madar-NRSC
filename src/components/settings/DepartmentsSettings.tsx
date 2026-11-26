import { useMemo, useState } from 'react';
import { GitBranch, List, Plus, Save } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { SINGLETON_ID } from '../../shared/collections';
import { newId } from '../../shared/ids';
import { departmentOptionLabel, departmentIdOf, departmentStationIds, departmentsError, departmentsOf, MAX_DEPARTMENTS, type Department } from '../../shared/departments';
import { stationsOf } from '../../shared/stations';
import { DepartmentChart } from './DepartmentChart';
import { DepartmentFields } from './DepartmentFields';

/** Count each linked assignment once even if several steps go to the same desk. */
function departmentUsage(): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string) => counts.set(id, (counts.get(id) || 0) + 1);
  apiService.getUsers().filter((u) => !u.deletedAt).forEach((u) => add(departmentIdOf(u)));
  apiService.getRoster().forEach(r => add(r.departmentId));
  apiService.getRequests().forEach(r => !r.deletedAt && r.departmentId && add(r.departmentId));
  for (const card of apiService.getCards()) {
    if (!card.deletedAt) {
      for (const id of new Set(card.steps.map(step => step.departmentId))) if (id) add(id);
    }
  }
  return counts;
}

/**
 * «الأقسام الإدارية»: the organisation's departments (غرفة التحرير، الإنتاج، المونتاج…), which route
 * users, duty rosters, requests and assignments. Each may sit under a parent department, have a head
 * (who hears about requests sent to it) and exist at some stations only. A department in use is
 * archived rather than deleted, and ids never change, so history keeps its names.
 */
export function DepartmentsSettings() {
  const [chart, setChart] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const [list, setList] = useState<Department[]>(() => departmentsOf(apiService.getSettings()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(list));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const selected = list.find(d => d.id === selectedId) ?? list[0];
  const visible = chart ? (selected ? [selected] : []) : list;
  const savedIds = useMemo(() => new Set((JSON.parse(baseline) as Department[]).map(d => d.id)), [baseline]);
  const focusName = (id: string) => requestAnimationFrame(() => document.getElementById('dept-name-' + id)?.focus());
  const select = (id: string) => { setSelectedId(id); focusName(id); };
  const editList = (update: (previous: Department[]) => Department[]) => {
    setError('');
    setSaved(false);
    setList(update);
  };
  const add = (parent?: Department) => {
    const id = newId('dep');
    editList(all => [...all, { id, name: '', parentId: parent?.id }]);
    select(id);
  };
  const dirty = JSON.stringify(list) !== baseline;
  const stations = stationsOf(apiService.getSettings());
  const people = apiService.getUsers().filter((u) => !u.deletedAt && u.isActive !== false).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  const usage = useMemo(departmentUsage, []);

  const patch = (id: string, changes: Partial<Department>) => editList((all) => all.map((d) => (d.id === id ? { ...d, ...changes } : d)));
  const availableStations = (d: Department) => {
    const parent = list.find(other => other.id === d.parentId);
    const allowed = parent && departmentStationIds(parent, list);
    return allowed ? stations.filter(station => allowed.includes(station.id)) : stations;
  };
  const toggleStation = (d: Department, stationId: string) => {
    const available = availableStations(d);
    const current = d.stationIds?.length ? d.stationIds.filter(id => available.some(s => s.id === id)) : available.map(s => s.id);
    const next = current.includes(stationId) ? current.filter((x) => x !== stationId) : [...current, stationId];
    if (!next.length) return;
    patch(d.id, { stationIds: available.every((s) => next.includes(s.id)) ? undefined : next });
  };
  /** Parents a department may take: any other department that is not below it (no loops). */
  const parentOptions = (d: Department) => {
    const below = new Set<string>([d.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of list) if (x.parentId && below.has(x.parentId) && !below.has(x.id)) { below.add(x.id); grew = true; }
    }
    return list.filter((x) => !below.has(x.id) && (!x.archived || d.parentId === x.id));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (JSON.stringify(departmentsOf(apiService.getSettings())) !== baseline) {
      setConflict(true);
      setSaved(false);
      setError('تغيّر الهيكل أو صلاحيات أحد الأقسام منذ فتح الصفحة. حمّل النسخة الحالية لمراجعتها قبل المتابعة.');
      return;
    }
    const clean = list.map((d) => ({ ...d, name: d.name.trim() }));
    const invalid = departmentsError(clean, { stationIds: stations.map((s) => s.id), previous: JSON.parse(baseline) });
    if (invalid) {
      const unnamed = clean.find(department => !department.name);
      if (unnamed) select(unnamed.id);
      setError(invalid);
      return;
    }
    setSaving(true);
    try {
      apiService.saveSettings({ departments: clean });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (!result.ok) throw new Error(result.message || 'لم يؤكد الخادم الحفظ');
      setList(clean);
      setBaseline(JSON.stringify(clean));
      setError('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الأقسام');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="py-4 space-y-4" aria-label="الأقسام الإدارية">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-slate-900">الأقسام الإدارية</h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          اختر قسماً من المخطط لتعديل رئيسه ومحطاته أو إضافة قسم تابع. يُستخدم هذا الهيكل في توجيه التكليفات والطلبات والمناوبات.
        </p>
      </div>
      <fieldset disabled={saving} className="space-y-3">
        <div role="group" aria-label="طريقة عرض الأقسام" className="inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {[{ value: true, icon: GitBranch, title: 'مخطط الهيكل' }, { value: false, icon: List, title: 'قائمة الأقسام' }].map(({ value, icon: Icon, title }) =>
            <button key={title} type="button" aria-pressed={chart === value} onClick={() => setChart(value)}
              className={`min-h-11 inline-flex items-center gap-2 rounded-md px-3 text-sm font-bold ${chart === value ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}><Icon size={16} />{title}</button>)}
        </div>
        <div className={chart ? 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)] items-start' : ''}>
        {chart && <DepartmentChart departments={list} stations={stations} users={people} selectedId={selected?.id}
          parents={selected ? parentOptions(selected) : []} onSelect={select} onAdd={add} onMove={(id, parentId) => patch(id, { parentId })} />}
        <ul className="min-w-0 space-y-3">
          {visible.map((d) => {
            const uses = usage.get(d.id) || 0;
            const isNew = !savedIds.has(d.id);
            return (
              <li key={d.id} className={`border rounded-xl p-4 space-y-2 ${d.archived ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                {chart && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-bold">تفاصيل القسم</h3>
                  <button type="button" disabled={list.length >= MAX_DEPARTMENTS || d.archived} onClick={() => add(d)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Plus size={16} />إضافة قسم تابع</button>
                </div>}
                <DepartmentFields department={d} parents={parentOptions(d)} stations={availableStations(d)} people={people} compact={chart}
                  removable={isNew || uses === 0} uses={uses} patch={patch} toggleStation={toggleStation}
                  label={(option) => departmentOptionLabel(option, list, stations, people)}
                  onRemove={() => editList((all) => all.filter((x) => x.id !== d.id).map((x) => x.parentId === d.id ? { ...x, parentId: undefined } : x))} />
              </li>
            );
          })}
        </ul>
        </div>
        {!chart && list.length < MAX_DEPARTMENTS && (
          <button type="button" onClick={() => add()} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-lg border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة قسم
          </button>
        )}
      </fieldset>
      <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-slate-100/95 border-t border-slate-200 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!dirty || saving} className="min-h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
          <Save className="w-4 h-4" aria-hidden="true" />
          {saving ? 'جارٍ الحفظ…' : 'حفظ الأقسام'}
        </button>
        {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
        {conflict && <button type="button" className="min-h-11 px-3 rounded-lg border border-slate-300 text-sm font-bold" onClick={() => {
          const latest = departmentsOf(apiService.getSettings());
          setList(latest);
          setBaseline(JSON.stringify(latest));
          setConflict(false);
          setError('');
        }}>تجاهل مسودتي وتحميل النسخة الحالية</button>}
        {saved && <p role="status" className="text-sm font-bold text-emerald-700">حُفظت الأقسام الإدارية</p>}
        {dirty && !saving && !error && <p className="text-sm text-amber-800">لديك تعديلات غير محفوظة.</p>}
      </div>
    </form>
  );
}
