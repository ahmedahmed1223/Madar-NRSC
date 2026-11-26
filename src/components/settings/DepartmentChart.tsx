import { useState } from 'react';
import { GitBranch, Move, Plus } from 'lucide-react';
import { departmentHead, departmentStationIds, MAX_DEPARTMENTS, type Department } from '../../shared/departments';

interface Props {
  departments: Department[];
  selectedId?: string;
  stations: readonly { id: string; name: string }[];
  users: readonly { id: string; fullName: string }[];
  onSelect: (id: string) => void;
  onAdd: (parent?: Department) => void;
  parents: Department[];
  onMove: (id: string, parentId?: string) => void;
}

export function DepartmentChart({ departments, selectedId, stations, users, onSelect, onAdd, parents, onMove }: Props) {
  const [sourceId, setSourceId] = useState<string>();
  const selectedDepartment = departments.find(d => d.id === selectedId);
  const moving = !!selectedDepartment && sourceId === selectedId;
  const move = (parentId?: string) => {
    if (!selectedDepartment) return;
    onMove(selectedDepartment.id, parentId);
    setSourceId(undefined);
  };
  const children = new Map<string, Department[]>();
  for (const department of departments) {
    const parent = department.parentId || '';
    const siblings = children.get(parent) || [];
    siblings.push(department);
    children.set(parent, siblings);
  }
  const renderBranch = (department: Department, depth: number) => {
    const stationIds = departmentStationIds(department, departments);
    const scope = stationIds?.map(id => stations.find(station => station.id === id)?.name || id).join('، ') ?? 'كل المحطات';
    const head = departmentHead(department.id, departments);
    const person = users.find(user => user.id === head);
    const reports = children.get(department.id);
    const selected = selectedId === department.id;
    return (
      <li key={department.id} className="min-w-0">
        <button type="button" aria-pressed={selected}
          disabled={moving && (department.archived || selectedDepartment.parentId === department.id || !parents.some(p => p.id === department.id))}
          onClick={() => moving ? move(department.id) : onSelect(department.id)}
          className={`w-full min-h-11 break-words rounded-lg border px-3 py-2 text-start disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600 ${selected ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-500'}`}>
          <span className="block text-sm font-bold text-slate-900">{department.name.trim() || 'قسم جديد'} {department.archived && '(مؤرشف)'}</span>
          <span className="block text-xs leading-5 text-slate-600">{scope} · {person?.fullName || (head ? 'حساب غير نشط' : 'بلا رئيس محدد')}</span>
        </button>
        {reports && <ul aria-label={`فروع ${department.name || 'القسم الجديد'}`} className={`mt-2 space-y-2 ${depth < 3 ? 'ms-3 border-s-2 border-slate-300 ps-2' : 'sm:border-s sm:border-slate-300'}`}>
          {reports.map(child => renderBranch(child, depth + 1))}
        </ul>}
      </li>
    );
  };

  return (
    <section aria-label="مخطط الأقسام" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900"><GitBranch size={18} aria-hidden="true" />الهيكل الإداري</h3>
        <div className="flex flex-wrap gap-1">
          {!moving && selectedDepartment && <button type="button" onClick={() => setSourceId(selectedId)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-bold text-blue-700 hover:bg-blue-50"><Move size={16} aria-hidden="true" />نقل القسم المحدد</button>}
          {!moving && <button type="button" disabled={departments.length >= MAX_DEPARTMENTS} onClick={() => onAdd()} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Plus size={16} />إضافة قسم رئيسي</button>}
        </div>
      </div>
      {moving && <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
        <p role="status" className="text-blue-900">اختر من المخطط القسم الأعلى الجديد لـ«{selectedDepartment.name || 'قسم جديد'}».</p>
        <div className="flex flex-wrap gap-3">
          {selectedDepartment.parentId && <button type="button" className="min-h-11 font-bold text-blue-800" onClick={() => move()}>نقل إلى المستوى الرئيسي</button>}
          <button type="button" className="min-h-11 text-slate-700 underline" onClick={() => setSourceId(undefined)}>إلغاء النقل</button>
        </div>
      </div>}
      <ul className="grid items-start gap-3 sm:grid-cols-2">{children.get('')?.map(department => renderBranch(department, 0))}</ul>
    </section>
  );
}
