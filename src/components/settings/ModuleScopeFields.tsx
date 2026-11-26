import { departmentOptionLabel, type Department } from '../../shared/departments';
import type { ModuleAudience } from '../../shared/moduleAccess';

type Option = { id: string; name: string };
export const MODULE_CONTROL = 'block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm';

export function ModuleScopePicker({ stations, departments, people, stationId, departmentId, onStation, onDepartment }: {
  stations: readonly Option[];
  departments: readonly Department[];
  people: readonly { id: string; fullName: string }[];
  stationId: string;
  departmentId: string;
  onStation: (id: string) => void;
  onDepartment: (id: string) => void;
}) {
  return <fieldset className="grid gap-3 sm:grid-cols-2">
    <legend className="mb-2 text-sm font-bold">نطاق التغيير</legend>
    <label className="space-y-1 text-sm">
      <span>المحطة</span>
      <select className={MODULE_CONTROL} value={stationId} onChange={e => onStation(e.target.value)}>
        <option value="">كل المحطات</option>
        {stations.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
    <label className="space-y-1 text-sm">
      <span>القسم</span>
      <select className={MODULE_CONTROL} value={departmentId} onChange={e => onDepartment(e.target.value)}>
        <option value="">كل الأقسام</option>
        {departments.filter(d => !d.archived).map(d => <option key={d.id} value={d.id}>{departmentOptionLabel(d, departments, stations, people)}</option>)}
      </select>
    </label>
  </fieldset>;
}

export function ScopeAudienceFields({ audiences, roles, users, onChange }: {
  audiences: ModuleAudience[];
  roles: Option[];
  users: Option[];
  onChange: (audiences: ModuleAudience[]) => void;
}) {
  return <div className="space-y-3">
    <p className="text-xs text-slate-600">يجب أن يطابق الموظف جميع الشروط في قاعدة واحدة على الأقل.</p>
    {audiences.map((audience, index) => (
      <fieldset key={index} className="space-y-2 rounded-lg border border-slate-200 p-2">
        <legend className="px-1 text-xs font-semibold">قاعدة الجمهور {index + 1}</legend>
        {([{ key: 'roleIds', name: 'الأدوار', options: roles }, { key: 'userIds', name: 'الحسابات', options: users }] as const).map(({ key, name, options }) =>
          <label key={key} className="block text-xs font-semibold">{name}
            <select className={MODULE_CONTROL} multiple size={3} value={audience[key] ?? []} onChange={e => {
              const selected = Array.from(e.target.selectedOptions, option => option.value);
              onChange(audiences.map((entry, position) => position === index ? { ...entry, [key]: selected } : entry));
            }}>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
          </label>)}
        <button type="button" className="min-h-11 text-sm text-rose-700" onClick={() => onChange(audiences.filter((_, position) => position !== index))}>إزالة هذه القاعدة</button>
      </fieldset>
    ))}
    <button type="button" className="min-h-11 text-sm font-bold text-blue-700" onClick={() => onChange([...audiences, {}])}>إضافة قاعدة جمهور</button>
  </div>;
}
