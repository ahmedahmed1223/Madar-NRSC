import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { countLabel } from '../../shared/arabicPlural';
import type { Department } from '../../shared/departments';

const INPUT = 'w-full min-h-11 px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-900';
const USES = { one: 'سجل واحد', two: 'سجلان', few: 'سجلات', many: 'سجلاً' };

interface Props {
  department: Department;
  parents: Department[];
  stations: readonly { id: string; name: string }[];
  people: readonly { id: string; fullName: string }[];
  compact: boolean;
  removable: boolean;
  uses: number;
  label: (d: Department) => string;
  patch: (id: string, changes: Partial<Department>) => void;
  toggleStation: (d: Department, stationId: string) => void;
  onRemove: () => void;
}

export function DepartmentFields({ department: d, parents, stations, people, compact, removable, uses, label, patch, toggleStation, onRemove }: Props) {
  return <>
    <div className={compact ? "grid gap-3" : "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9.5rem] items-end"}>
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
          {parents.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`dept-head-${d.id}`} className="block text-xs font-bold text-slate-700 mb-1">رئيس القسم</label>
        <select id={`dept-head-${d.id}`} value={d.headUserId || ''} onChange={(e) => patch(d.id, { headUserId: e.target.value || undefined })} className={INPUT}>
          <option value="">بلا رئيس محدد</option>
          {people.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      </div>
      <div className="flex gap-2 sm:justify-end">
        <button
          type="button"
          onClick={() => patch(d.id, { archived: d.archived ? undefined : true })}
          aria-label={d.archived ? `إعادة تفعيل قسم ${d.name}` : `أرشفة قسم ${d.name}`}
          title={d.archived ? 'إعادة تفعيل' : 'أرشفة'}
          className="min-h-11 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-50"
        >
          {d.archived ? <ArchiveRestore className="w-4 h-4" aria-hidden="true" /> : <Archive className="w-4 h-4" aria-hidden="true" />}
          <span>{d.archived ? 'إعادة' : 'أرشفة'}</span>
        </button>
        {removable && (
          <button type="button" onClick={onRemove} aria-label={`حذف قسم ${d.name}`} title="حذف (غير مستخدم)" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <div role="group" aria-label={`محطات قسم ${d.name}`} className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="text-xs font-bold text-slate-600" aria-hidden="true">المحطات:</span>
        {stations.map((s) => (
          <label key={s.id} className="flex items-center gap-2 min-h-11 sm:min-h-9">
            <input type="checkbox" checked={!d.stationIds?.length || d.stationIds.includes(s.id)} onChange={() => toggleStation(d, s.id)} />
            {s.name}
          </label>
        ))}
        {!d.stationIds?.length && <span className="text-xs text-slate-500">{d.parentId ? 'يتبع محطات القسم الأعلى' : 'يشمل المحطات الجديدة أيضاً'}</span>}
        {d.parentId && !!d.stationIds?.length && <button type="button" className="min-h-11 px-2 font-bold text-blue-700" onClick={() => patch(d.id, { stationIds: undefined })}>استخدام محطات القسم الأعلى</button>}
      </div>
      <span className="ms-auto text-xs text-slate-500">{uses ? `مرتبط بـ ${countLabel(uses, USES)} ضمن الزملاء والمناوبات والطلبات والتكليفات` : 'غير مستخدم بعد'}</span>
    </div>
  </>;
}
