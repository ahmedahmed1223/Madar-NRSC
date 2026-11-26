import { useState, type FormEvent } from 'react';
import { LayoutGrid, Save } from 'lucide-react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { RbacService } from '../../services/rbacService';
import { SINGLETON_ID } from '../../shared/collections';
import { departmentsOf } from '../../shared/departments';
import { matchesQuery } from '../../shared/search';
import { ModuleAccessPreview } from './ModuleAccessPreview';
import { MODULE_IDS, MODULE_LABELS, moduleAccessError, moduleRule, type ModuleAccessSettings as ModulePolicy, type ModuleMode, type ModuleRule } from '../../shared/moduleAccess';

const modes: { value: ModuleMode; label: string }[] = [
  { value: 'everyone', label: 'متاحة حسب الصلاحيات' },
  { value: 'selected', label: 'أدوار أو مستخدمون محددون' },
  { value: 'disabled', label: 'معطّلة للجميع' },
];

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
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const settings = apiService.getSettings();
  const current = settings.moduleAccess;
  const roleDefinitions = RbacService.getRoleDefinitions();
  const roles = roleDefinitions.map(role => ({ id: role.id, name: role.nameAr }));
  const users = apiService.getUsers().filter(user => user.isActive && !user.deletedAt)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  const userOptions = users.map(user => ({ id: user.id, name: user.fullName, description: user.email }));
  const dirty = Object.keys(draft).length > 0;

  function change(id: keyof ModulePolicy, rule: ModuleRule) {
    setDraft(previous => ({ ...previous, [id]: rule }));
    setNotice('');
    setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    const moduleAccess = { ...apiService.getSettings().moduleAccess, ...draft };
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
        <fieldset disabled={saving} className="grid items-start gap-3 xl:grid-cols-2">
          <legend className="sr-only">إتاحة البرامج والتكليفات</legend>
          {MODULE_IDS.map(id => {
            const rule = draft[id] ?? moduleRule(current, id);
            return (
              <div key={id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                <label htmlFor={`module-access-${id}`} className="block text-sm font-bold text-slate-900">{MODULE_LABELS[id]}</label>
                <select
                  id={`module-access-${id}`}
                  value={rule.mode}
                  onChange={event => change(id, { ...rule, mode: event.target.value as ModuleMode })}
                  className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {modes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                </select>
                {rule.mode === 'selected' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <AudienceOptions label="الأدوار" options={roles} selected={rule.roleIds ?? []} onChange={roleIds => change(id, { ...rule, roleIds })} />
                    <AudienceOptions label="المستخدمون" options={userOptions} selected={rule.userIds ?? []} onChange={userIds => change(id, { ...rule, userIds })} />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        <ModuleAccessPreview policy={{ ...current, ...draft }} users={users} roles={roleDefinitions} departments={departmentsOf(settings)} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-50">
            <Save aria-hidden="true" className="size-4" /> حفظ إتاحة الوحدات
          </button>
          <p role="status" className="text-sm text-slate-700">{saving ? 'بانتظار تأكيد الخادم' : notice}</p>
        </div>
        {error && <p role="alert" className="text-sm font-bold text-rose-800">{error}</p>}
      </form>
    </section>
  );
}
