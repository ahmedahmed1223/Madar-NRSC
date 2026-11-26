import { useEffect, useState, type FormEvent } from 'react';
import { LayoutGrid, Save } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { SINGLETON_ID } from '../../shared/collections';
import { departmentsOf } from '../../shared/departments';
import { matchesQuery } from '../../shared/search';
import { apiFetch } from '../../services/http';
import { findUserRole } from '../../shared/rbac';
import { stationsOf } from '../../shared/stations';
import { ModuleScopePicker, ScopeAudienceFields } from './ModuleScopeFields';
import { ModuleAccessPreview } from './ModuleAccessPreview';
import { allowsModule, FEATURE_PARENTS, moduleAllowsNewWork, moduleSubject, MODULE_IDS, MODULE_LABELS, moduleAccessError, moduleRule, type ModuleAccessSettings as ModulePolicy, type ModuleMode, type ModuleRule, type ModuleId, type ModuleScope } from '../../shared/moduleAccess';

type ModuleRevision = { version: number; changedByName: string; changedAt: string; policy: ModulePolicy };

const presets: Record<string, ModuleId[]> = {
  work: ['tasks', 'assignments', 'requests', 'personalTasks'],
  newsroom: ['news', 'bulletins', 'media', 'planning', 'reports', 'editorialAi'],
  production: ['programmes', 'media', 'planning', 'assignments', 'transcription'],
};
const modes: { value: ModuleMode; label: string }[] = [
  { value: 'everyone', label: 'متاحة حسب الصلاحيات' },
  { value: 'selected', label: 'أدوار أو مستخدمون محددون' },
  { value: 'disabled', label: 'معطّلة للجميع' },
];

function moduleRuleKey(rule: ModuleRule) {
  const ids = (values?: string[]) => [...(values ?? [])].sort();
  const audiences = (values?: ModuleRule['audiences']) => (values ?? []).map(audience =>
    JSON.stringify([ids(audience.roleIds), ids(audience.userIds), ids(audience.stationIds), ids(audience.departmentIds)])
  ).sort();
  const scopes = (rule.scopes ?? []).map(scope => JSON.stringify([
    scope.stationId, scope.departmentId, scope.mode, scope.descendants ?? false, audiences(scope.audiences),
  ])).sort();
  return JSON.stringify([rule.mode, ids(rule.roleIds), ids(rule.userIds), audiences(rule.audiences), scopes]);
}

function AudienceOptions({ label, options, selected, onChange }: {
  label: string;
  options: { id: string; name: string; description?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const searchLabel = label === 'الأدوار' ? 'البحث عن دور' : 'البحث عن مستخدم';
  const visible = options.filter(option => matchesQuery(query, option.name, option.description));
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-semibold text-slate-700">{label}</legend>
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={searchLabel}
        placeholder={searchLabel} className="mb-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" />
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
        {visible.map(option => (
          <label key={option.id} className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-slate-100 px-3 text-sm last:border-b-0">
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={event => onChange(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))}
              className="size-4 shrink-0 accent-blue-700"
            />
            <span className="min-w-0 break-words">{option.name}{option.description && <bdi className="block break-all text-xs text-slate-600">{option.description}</bdi>}</span>
          </label>
        ))}
        {!visible.length && <p className="px-3 py-2 text-xs text-slate-600">{query ? 'لا توجد نتائج لهذا البحث' : 'لا توجد خيارات متاحة'}</p>}
      </div>
    </fieldset>
  );
}

export function ModuleAccessSettings() {
  useLiveData(['settings', 'roles', 'users']);
  const [draft, setDraft] = useState<ModulePolicy>({});
  const [stationId, setStationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [preset, setPreset] = useState('');
  const [search, setSearch] = useState('');
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [history, setHistory] = useState<ModuleRevision[]>([]);
  const [baseline, setBaseline] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const settings = apiService.getSettings();
  const current = settings.moduleAccess;
  const currentKey = JSON.stringify(current ?? {});
  const stations = stationsOf(settings);
  const departments = departmentsOf(settings);
  const scoped = !!(stationId || departmentId);
  const policy = { ...current, ...draft };
  const sameScope = (scope: { stationId?: string; departmentId?: string }) =>
    (scope.stationId ?? '') === stationId && (scope.departmentId ?? '') === departmentId;
  const asScope = (rule: ModuleRule) => rule.scopes?.find(sameScope);
  const withScope = (root: ModuleRule, value: Pick<ModuleScope, 'mode' | 'audiences' | 'descendants'>): ModuleRule => ({
    ...root,
    scopes: [
      ...root.scopes?.filter(scope => !sameScope(scope)) ?? [],
      ...(value.mode === 'everyone' ? [] : [{ stationId: stationId || undefined, departmentId: departmentId || undefined, mode: value.mode, audiences: value.audiences, descendants: departmentId ? value.descendants : undefined }]),
    ],
  });
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ rows: ModuleRevision[] }>('/api/v1/settings/module-history', { signal: controller.signal })
      .then(result => setHistory(result.rows)).catch(() => undefined);
    return () => controller.abort();
  }, [notice]);
  const roleDefinitions = RbacService.getRoleDefinitions();
  const roles = roleDefinitions.map(role => ({ id: role.id, name: role.nameAr }));
  const users = apiService.getUsers().filter(user => user.isActive && !user.deletedAt)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  const userOptions = users.map(user => ({ id: user.id, name: user.fullName, description: user.email }));
  const dirty = Object.keys(draft).length > 0;
  const original: ModulePolicy | undefined = baseline ? JSON.parse(baseline) : current;
  const modifiedIds = MODULE_IDS.filter(id => draft[id] && moduleRuleKey(draft[id]) !== moduleRuleKey(moduleRule(original, id)));
  const visibleModules = (modifiedOnly ? modifiedIds : MODULE_IDS).filter(id => matchesQuery(search, MODULE_LABELS[id]));
  const affected = users.filter(user => {
    const subject = moduleSubject(user, findUserRole(user, roleDefinitions)?.id, departments);
    return MODULE_IDS.some(id => allowsModule(current, id, subject) !== allowsModule(policy, id, subject)) ||
      moduleAllowsNewWork(current, 'assignments', subject) !== moduleAllowsNewWork(policy, 'assignments', subject);
  });
  const openCards = apiService.getCards().filter(card => card.status === 'OPEN' && !card.deletedAt);
  const checkCards = !!draft.assignments && JSON.stringify(current?.assignments) !== JSON.stringify(draft.assignments);

  function stage(proposed: ModulePolicy) {
    setBaseline(baseline ?? currentKey);
    setDraft(proposed);
    setNotice('');
    setError('');
  }

  function change(id: keyof ModulePolicy, rule: ModuleRule & Pick<ModuleScope, 'descendants'>) {
    const root = moduleRule(policy, id);
    stage({ ...draft, [id]: scoped ? withScope(root, rule) : rule });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    if (baseline !== JSON.stringify(apiService.getSettings().moduleAccess ?? {})) {
      setError('تغيّر ضبط الوحدات منذ بدء التعديل. ألغِ المسودة وراجع الإعداد المحفوظ قبل المحاولة.');
      return;
    }
    const moduleAccess = policy;
    const invalid = moduleAccessError(moduleAccess);
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      apiService.saveSettings({ moduleAccess });
      const result = await dataStore.awaitWrite('settings', SINGLETON_ID);
      if (result.ok) {
        setDraft({});
        setBaseline(undefined);
        setModifiedOnly(false);
        setNotice('حُفظت إتاحة الوحدات');
      } else if (result.pending) {
        setNotice(result.message || 'بانتظار تأكيد الخادم');
      } else {
        setError(result.message || 'تعذر حفظ إتاحة الوحدات');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ إتاحة الوحدات');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="module-access-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div>
        <h2 id="module-access-title" className="flex items-center gap-2 text-base font-bold text-slate-900">
          <LayoutGrid aria-hidden="true" className="size-4 text-blue-700" /> إتاحة الوحدات
        </h2>
        <p className="mt-1 text-xs text-slate-600">يحتاج المستخدم إلى الصلاحيات المناسبة للوحدة. يمكن استعادة الإتاحة من هذه الصفحة مع السجلات المحفوظة.</p>
      </div>
      <form onSubmit={save} className="space-y-4" aria-busy={saving}>
        <ModuleScopePicker stations={stations} departments={departments} people={users}
          stationId={stationId} departmentId={departmentId} onStation={setStationId} onDepartment={setDepartmentId} />
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">قالب تشغيل
            <select value={preset} onChange={event => setPreset(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3">
              <option value="">اختر قالباً</option>
              <option value="work">التكليفات والمهام</option>
              <option value="newsroom">غرفة الأخبار</option>
              <option value="production">إنتاج البرامج</option>
            </select>
          </label>
          <button type="button" disabled={!preset || saving} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-bold disabled:opacity-50"
            onClick={() => {
              const next = Object.fromEntries(MODULE_IDS.map(id => {
                const rule = moduleRule(policy, id);
                const mode = presets[preset].includes(id) ? 'everyone' : 'disabled';
                return [id, scoped ? withScope(rule, { mode }) : { ...rule, mode }];
              }));
              stage(next);
            }}>معاينة القالب ضمن النطاق</button>
          <label className="grid gap-1 text-sm">البحث في الوحدات
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" />
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm has-disabled:opacity-50">
            <input type="checkbox" checked={modifiedOnly} disabled={!dirty || saving} onChange={event => setModifiedOnly(event.target.checked)} />
            عرض الوحدات المعدلة فقط
          </label>
        </div>
        <fieldset disabled={saving} className="grid items-start gap-3 xl:grid-cols-2">
          <legend className="sr-only">إتاحة الوحدات والميزات</legend>
          {!visibleModules.length && <p className="text-sm text-slate-600">
            {search.trim() ? 'لا توجد وحدات تطابق البحث.' : 'لا توجد وحدات معدلة في المسودة.'}
          </p>}
          {visibleModules.map(id => {
            const root = moduleRule(policy, id);
            const local = asScope(root);
            const rule = scoped ? local ?? { mode: 'everyone' as const } : root;
            const parent = FEATURE_PARENTS[id];
            return (
              <div key={id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                <label htmlFor={`module-access-${id}`} className="block text-sm font-bold text-slate-900">{MODULE_LABELS[id]}</label>
                {parent && <p className="text-xs text-slate-600">ميزة ضمن {MODULE_LABELS[parent]}</p>}
                <select
                  id={`module-access-${id}`}
                  value={rule.mode}
                  onChange={event => change(id, { ...rule, mode: event.target.value as ModuleMode })}
                  className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {modes.map(mode => <option key={mode.value} value={mode.value}>{scoped && mode.value === 'everyone' ? 'يرث الإعداد الأعلى' : mode.label}</option>)}
                  {id === 'assignments' && <option value="finishing">إنهاء القائم وإيقاف الإسناد الجديد</option>}
                </select>
                {id === 'transcription' && rule.mode === 'disabled' && <p className="text-xs text-slate-600">تتوقف الطلبات الجديدة وينتظر الطابور إعادة التفعيل. قد تكتمل المادة التي أُرسلت إلى المزوّد بالفعل.</p>}
                {departmentId && local && <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" checked={local.descendants ?? false} onChange={event => change(id, { ...local, descendants: event.target.checked })} />
                  يشمل الأقسام التابعة
                </label>}
                {scoped && rule.mode === 'selected' && <ScopeAudienceFields audiences={rule.audiences ?? []} roles={roles} users={userOptions}
                  onChange={audiences => change(id, { ...rule, audiences })} />}
                {!scoped && rule.mode === 'selected' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <AudienceOptions label="الأدوار" options={roles} selected={root.roleIds ?? []} onChange={roleIds => change(id, { ...rule, roleIds })} />
                    <AudienceOptions label="المستخدمون" options={userOptions} selected={root.userIds ?? []} onChange={userIds => change(id, { ...rule, userIds })} />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        {dirty && <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p>تتغير إتاحة وحدة واحدة على الأقل لـ {affected.length} حساب بناءً على ضبط المسودة.</p>
          {checkCards && <p>يوجد {openCards.length} تكليف مفتوح ظاهر لحسابك. راجع الإسناد أو اختر إنهاء القائم قبل إغلاق الوصول.</p>}
          {!!modifiedIds.length && <p>{modifiedIds.map(id => MODULE_LABELS[id]).join('، ')}</p>}
        </div>}
        <ModuleAccessPreview policy={policy} users={users} roles={roleDefinitions} departments={departments} />
        {!!history.length && <details className="rounded-lg border border-slate-200 px-3">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-bold">استعادة إعداد سابق</summary>
          <ul className="divide-y divide-slate-200 pb-2">
            {history.map(revision => <li key={revision.version} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{revision.changedByName} · <time dateTime={revision.changedAt}>{new Date(revision.changedAt).toLocaleString('ar')}</time></span>
              <button type="button" disabled={saving} className="min-h-11 text-blue-700 font-bold" onClick={() =>
                stage(Object.fromEntries(MODULE_IDS.map(id => [id, moduleRule(revision.policy, id)])))}>
                معاينة المراجعة {revision.version}
              </button>
            </li>)}
          </ul>
        </details>}
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${dirty || notice ? 'max-sm:sticky max-sm:bottom-0 max-sm:z-20 max-sm:-mx-5 max-sm:border-t max-sm:border-slate-200 max-sm:bg-white max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]' : ''}`}>
          <button type="submit" disabled={saving || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-50">
            <Save aria-hidden="true" className="size-4" /> حفظ إتاحة الوحدات
          </button>
          {dirty && <button type="button" disabled={saving} className="min-h-11 px-3 text-sm font-bold" onClick={() => {
            setDraft({});
            setBaseline(undefined);
            setModifiedOnly(false);
            setNotice('');
            setError('');
          }}>إلغاء المسودة</button>}
          <p role="status" className={saving || notice ? 'basis-full text-sm text-slate-700 sm:basis-auto' : 'sr-only'}>{saving ? 'بانتظار تأكيد الخادم' : notice}</p>
          {error && <p role="alert" className="basis-full text-sm font-bold text-rose-800">{error}</p>}
        </div>
      </form>
    </section>
  );
}
