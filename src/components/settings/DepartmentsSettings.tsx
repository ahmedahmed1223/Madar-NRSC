import { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Plus, Save, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { SINGLETON_ID } from '../../shared/collections';
import { newId } from '../../shared/ids';
import { departmentIdOf, departmentsError, departmentsOf, MAX_DEPARTMENTS, type Department } from '../../shared/departments';
import { stationsOf } from '../../shared/stations';

const INPUT = 'w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl bg-white text-sm text-slate-900';

/** How many colleagues, duty shifts and open requests point at each department. */
function departmentUsage(): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string) => counts.set(id, (counts.get(id) || 0) + 1);
  apiService.getUsers().filter((u) => !u.deletedAt).forEach((u) => add(departmentIdOf(u)));
  apiService.getRoster().forEach((r: any) => !r.deletedAt && r.departmentId && add(r.departmentId));
  apiService.getRequests().forEach((r: any) => !r.deletedAt && !['DONE', 'REJECTED', 'CANCELLED'].includes(r.status) && add(r.departmentId));
  return counts;
}

/**
 * «الأقسام الإدارية»: the organisation's departments (غرفة التحرير، الإنتاج، المونتاج…), which route
 * users, duty rosters, requests and assignments. Each may sit under a parent department, have a head
 * (who hears about requests sent to it) and exist at some stations only. A department in use is
 * archived rather than deleted, and ids never change, so history keeps its names.
 */
export function DepartmentsSettings() {
  const [list, setList] = useState<Department[]>(() => departmentsOf(apiService.getSettings()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(list));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(list) !== baseline;
  const stations = stationsOf(apiService.getSettings());
  const people = apiService.getUsers().filter((u) => !u.deletedAt && u.isActive !== false).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  const usage = useMemo(departmentUsage, []);

  useEffect(() => {
    setError('');
    setSaved(false);
  }, [list]);

  const patch = (id: string, changes: Partial<Department>) => setList((all) => all.map((d) => (d.id === id ? { ...d, ...changes } : d)));
  const toggleStation = (d: Department, stationId: string) => {
    const current = d.stationIds || [];
    const next = current.includes(stationId) ? current.filter((x) => x !== stationId) : [...current, stationId];
    patch(d.id, { stationIds: next.length ? next : undefined });
  };
  /** Parents a department may take: any other department that is not below it (no loops). */
  const parentOptions = (d: Department) => {
    const below = new Set<string>([d.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of list) if (x.parentId && below.has(x.parentId) && !below.has(x.id)) { below.add(x.id); grew = true; }
    }
    return list.filter((x) => !below.has(x.id));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const clean = list.map((d) => ({ ...d, name: d.name.trim() }));
    const invalid = departmentsError(clean, { stationIds: stations.map((s) => s.id) });
    if (invalid) {
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
      setTimeout(() => setSaved(true));
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
          أقسام المؤسسة التي ينتمي إليها الزملاء وتُوجَّه إليها الطلبات والمناوبات والتكليفات (غرفة التحرير، الإنتاج، المونتاج…). تختلف عن «تصنيفات الأخبار» التي تصنّف المواد.
          القسم المستخدم يُؤرشف ولا يُحذف، فيبقى اسمه في السجلات.
        </p>
      </div>
      <fieldset disabled={saving} className="space-y-3">
        <ul className="space-y-3">
          {list.map((d) => {
            const uses = usage.get(d.id) || 0;
            const isNew = !(JSON.parse(baseline) as Department[]).some((x) => x.id === d.id);
            return (
              <li key={d.id} className={`border rounded-2xl p-4 space-y-3 ${d.archived ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
                  <div>
                    <label htmlFor={`dept-name-${d.id}`} className="block text-xs font-bold text-slate-700 mb-1">
                      اسم القسم {d.archived && <span className="text-amber-800">(مؤرشف)</span>}
                    </label>
                    <input id={`dept-name-${d.id}`} value={d.name} maxLength={60} required onChange={(e) => patch(d.id, { name: e.target.value })} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor={`dept-parent-${d.id}`} className="block text-xs font-bold text-slate-700 mb-1">تابع لقسم</label>
                    <select id={`dept-parent-${d.id}`} value={d.parentId || ''} onChange={(e) => patch(d.id, { parentId: e.target.value || undefined })} className={INPUT}>
                      <option value="">قسم رئيسي</option>
                      {parentOptions(d).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`dept-head-${d.id}`} className="block text-xs font-bold text-slate-700 mb-1">رئيس القسم</label>
                    <select id={`dept-head-${d.id}`} value={d.headUserId || ''} onChange={(e) => patch(d.id, { headUserId: e.target.value || undefined })} className={INPUT}>
                      <option value="">بلا رئيس محدد</option>
                      {people.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => patch(d.id, { archived: d.archived ? undefined : true })}
                      aria-label={d.archived ? `إعادة تفعيل قسم ${d.name}` : `أرشفة قسم ${d.name}`}
                      title={d.archived ? 'إعادة تفعيل' : 'أرشفة'}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-300 text-slate-700"
                    >
                      {d.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    </button>
                    {(isNew || uses === 0) && (
                      <button type="button" onClick={() => setList((all) => all.filter((x) => x.id !== d.id).map((x) => (x.parentId === d.id ? { ...x, parentId: undefined } : x)))} aria-label={`حذف قسم ${d.name}`} title="حذف (غير مستخدم)" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-rose-200 text-rose-700">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <span className="text-xs font-bold text-slate-600">المحطات:</span>
                  <label className="flex items-center gap-2 min-h-9">
                    <input type="checkbox" checked={!d.stationIds?.length} onChange={() => patch(d.id, { stationIds: undefined })} />
                    كل المحطات
                  </label>
                  {stations.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 min-h-9">
                      <input type="checkbox" checked={!!d.stationIds?.includes(s.id)} onChange={() => toggleStation(d, s.id)} />
                      {s.name}
                    </label>
                  ))}
                  <span className="ms-auto text-xs text-slate-500">{uses ? `مستخدم: ${uses} (زملاء ومناوبات وطلبات مفتوحة)` : 'غير مستخدم'}</span>
                </div>
              </li>
            );
          })}
        </ul>
        {list.length < MAX_DEPARTMENTS && (
          <button type="button" onClick={() => setList((all) => [...all, { id: newId('dep'), name: '' }])} className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-dashed border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" />
            إضافة قسم
          </button>
        )}
      </fieldset>
      {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
      {saved && <p role="status" className="text-sm font-bold text-emerald-700">حُفظت الأقسام الإدارية</p>}
      {dirty && !saving && <p className="text-sm text-amber-800">لديك تعديلات غير محفوظة.</p>}
      <button type="submit" disabled={!dirty || saving} className="min-h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
        <Save className="w-4 h-4" />
        {saving ? 'جارٍ الحفظ…' : 'حفظ الأقسام'}
      </button>
    </form>
  );
}
