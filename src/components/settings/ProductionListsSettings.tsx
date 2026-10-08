import { useRef, useState } from 'react';
import { Edit2, Plus, Save } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { notify } from '../../services/notify';
import { useLiveData } from '../../hooks/useLiveData';
import { useFormDraft } from '../../hooks/useFormDraft';
import { newId } from '../../shared/ids';
import { normalizeProductionName, productionPersonError, type ProductionRole } from '../../shared/productionPeople';
import { FilterTabs } from '../common/FilterTabs';
import { FormPage } from '../common/FormPage';

type DirectoryTab = ProductionRole | 'STUDIO';
type EntryForm = { id: string; name: string; roles: ProductionRole[]; active: boolean; notes: string; location: string };
const empty: EntryForm = { id: '', name: '', roles: ['PRESENTER'], active: true, notes: '', location: '' };

export function ProductionListsSettings({ currentUser }: { currentUser: User }) {
  useLiveData(['productionPeople', 'resources']);
  const [tab, setTab] = useState<DirectoryTab>('PRESENTER');
  const [search, setSearch] = useState('');
  const [inactive, setInactive] = useState(false);
  const [form, setForm] = useState<EntryForm | null>(null);
  const [draftKey, setDraftKey] = useState('new');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const baseline = useRef<string | undefined>(undefined);
  const studio = tab === 'STUDIO';
  const canEdit = RbacService.hasPermission(currentUser, studio ? 'resources.manage' : 'system.settings');
  const draft = useFormDraft(`production-list:${currentUser.id}:${tab}:${draftKey}`, !!form, form || empty, recovered => setForm(recovered));
  const people = apiService.getProductionPeople();
  const rows = studio
    ? apiService.getResources().filter(r => r.kind === 'STUDIO').map(r => ({ ...r, active: r.isActive }))
    : people.filter(p => p.roles.includes(tab));
  const visible = rows.filter(r => (inactive || r.active) && normalizeProductionName(`${r.name} ${r.notes || ''}`).includes(normalizeProductionName(search)));
  const change = (value: Partial<EntryForm>) => setForm(old => old ? { ...old, ...value } : old);
  const open = (id?: string) => {
    const row = id ? rows.find(r => r.id === id) : undefined;
    baseline.current = row?.updatedAt;
    setDraftKey(id || 'new'); setError(''); setPending(false);
    setForm({ id: id || newId(studio ? 'res' : 'person'), name: row?.name || '', roles: row && 'roles' in row ? row.roles : [studio ? 'PRESENTER' : tab], active: row?.active ?? true, notes: row?.notes || '', location: row && 'location' in row ? row.location || '' : '' });
  };
  const save = async () => {
    if (!form || saving || !canEdit) return;
    if (!pending) {
      const invalid = studio ? (!form.name.trim() || form.name.length > 120 ? 'اسم الاستديو مطلوب حتى 120 حرفاً' : null) : productionPersonError(form);
      if (invalid) { setError(invalid); return; }
      if (!studio && people.some(p => p.id !== form.id && normalizeProductionName(p.name) === normalizeProductionName(form.name))) { setError('الاسم موجود بالفعل في قوائم الإنتاج'); return; }
      const latest = studio ? apiService.getResources().find(r => r.id === form.id) : people.find(p => p.id === form.id);
      if (baseline.current && latest?.updatedAt !== baseline.current) { setError('تغير السجل لدى زميل آخر. أعد فتحه لمراجعة النسخة الحالية؛ تبقى مسودتك محفوظة.'); return; }
    }
    setSaving(true); setError('');
    try {
      if (!pending) {
        if (studio) apiService.saveResource({ id: form.id, name: form.name.trim(), kind: 'STUDIO', isActive: form.active, notes: form.notes, location: form.location });
        else apiService.saveProductionPerson({ id: form.id, name: form.name, roles: form.roles, active: form.active, notes: form.notes });
      }
      const result = await dataStore.awaitWrite(studio ? 'resources' : 'productionPeople', form.id);
      if (!result.ok) { setPending(!!result.pending); throw new Error(result.message || 'لم يؤكد الخادم الحفظ؛ أعد المحاولة'); }
      draft.clearDraft(); setPending(false); setForm(null);
      notify({ type: 'success', message: studio ? 'حُفظ الاستديو' : 'حُفظ اسم الإنتاج' });
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر الحفظ'); }
    finally { setSaving(false); }
  };
  const inputClass = 'mt-1 block w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-slate-900';
  return <section className="space-y-4 py-4" aria-label="إدارة قوائم الإنتاج">
    <h2 className="text-lg font-bold">قوائم الإنتاج</h2>
    <FilterTabs label="نوع قائمة الإنتاج" tabs={[{ id: 'PRESENTER', label: 'المذيعون' }, { id: 'DIRECTOR', label: 'المخرجون' }, { id: 'STUDIO', label: 'الاستديوهات' }]} active={tab} onChange={next => { setTab(next); setSearch(''); setInactive(false); }} />
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex-1 min-w-0 text-sm">بحث في القائمة<input type="search" value={search} onChange={e => setSearch(e.target.value)} className={inputClass} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />عرض الأسماء المعطلة</label>
      {canEdit && <button type="button" onClick={() => open()} className="inline-flex items-center gap-2 min-h-11 px-3 rounded-lg bg-blue-600 text-white"><Plus className="w-4 h-4" />{studio ? 'إضافة استديو' : 'إضافة اسم'}</button>}
    </div>
    {!canEdit && <p className="text-sm text-slate-600">إدارة الاستديوهات تتطلب صلاحية إدارة الموارد.</p>}
    {visible.length === 0 && <p role="status" className="text-sm text-slate-600 py-4">لا توجد أسماء مطابقة</p>}
    <ul className="divide-y divide-slate-200">
      {visible.map(row => <li key={row.id} className="flex items-center gap-3 py-3">
        <div className="flex-1 min-w-0"><strong className="block text-sm break-words">{row.name}</strong><span className="text-xs text-slate-600">{row.active ? 'نشط' : 'معطل'}{'roles' in row ? ` · ${row.roles.map(role => role === 'PRESENTER' ? 'مذيع' : 'مخرج').join('، ')}` : ''}</span></div>
        {canEdit && <button type="button" aria-label={`تعديل ${row.name}`} title={`تعديل ${row.name}`} onClick={() => open(row.id)} className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-blue-700 border border-slate-200 rounded-lg"><Edit2 className="w-4 h-4" /></button>}
      </li>)}
    </ul>
    <FormPage isOpen={!!form} onClose={() => { if (saving) return false; setForm(null); }} title={studio ? 'بيانات الاستديو' : 'بيانات اسم الإنتاج'} draft={draft}>
      {form && <form aria-label={studio ? 'بيانات الاستديو' : 'بيانات اسم الإنتاج'} onSubmit={e => { e.preventDefault(); void save(); }} onKeyDown={e => {
        if (!e.defaultPrevented && !e.repeat && !e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey) && !e.altKey && !document.querySelector('[role=dialog], [role=alertdialog]') && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) { e.preventDefault(); e.currentTarget.requestSubmit(); }
      }} className="space-y-4">
        <fieldset disabled={saving || pending} className="space-y-4">
          <label className="block text-sm">الاسم<input required maxLength={120} value={form.name} onChange={e => change({ name: e.target.value })} className={inputClass} /></label>
          {!studio && <fieldset className="flex flex-wrap gap-4"><legend className="text-sm mb-2">الدور</legend>{(['PRESENTER', 'DIRECTOR'] as const).map(role => <label key={role} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.roles.includes(role)} onChange={e => change({ roles: e.target.checked ? [...form.roles, role] : form.roles.filter(r => r !== role) })} />{role === 'PRESENTER' ? 'مذيع' : 'مخرج'}</label>)}</fieldset>}
          {studio && <label className="block text-sm">الموقع<input maxLength={200} value={form.location} onChange={e => change({ location: e.target.value })} className={inputClass} /></label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => change({ active: e.target.checked })} />نشط</label>
          <label className="block text-sm">ملاحظات<textarea rows={3} maxLength={2000} value={form.notes} onChange={e => change({ notes: e.target.value })} className={`${inputClass} py-2`} /></label>
        </fieldset>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={saving} className="min-h-11 px-4 rounded-lg bg-blue-600 text-white inline-flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'جارٍ الحفظ...' : pending ? 'إعادة تأكيد الحفظ' : 'حفظ'}</button>
      </form>}
    </FormPage>
  </section>;
}
