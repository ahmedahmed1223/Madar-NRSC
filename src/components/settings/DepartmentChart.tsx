import { useId, useState } from 'react';
import { Check, GitBranch, MapPin, Move, Plus, UserRound } from 'lucide-react';
import { departmentHead, departmentStationIds, MAX_DEPARTMENTS, type Department } from '../../shared/departments';

interface Props {
  departments: Department[];
  stations: readonly { id: string; name: string }[];
  users: readonly { id: string; fullName: string }[];
  editor?: {
    selectedId?: string;
    onSelect: (id: string) => void;
    onAdd: (parent?: Department) => void;
    parents: Department[];
    onMove: (id: string, parentId?: string) => void;
  };
}

const ACTION = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const CARD = 'block w-full min-h-11 min-w-0 rounded-lg border px-3 py-2 text-start [overflow-wrap:anywhere]';

export function DepartmentChart({ departments, stations, users, editor }: Props) {
  const chartId = useId();
  const [sourceId, setSourceId] = useState<string>();
  const selected = departments.find(d => d.id === editor?.selectedId);
  const source = selected?.id === sourceId ? selected : undefined;
  const canAdd = departments.length < MAX_DEPARTMENTS;
  const focusControl = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const move = (parentId?: string) => {
    if (!source || !editor) return;
    editor.onMove(source.id, parentId);
    setSourceId(undefined);
    focusControl(chartId + source.id);
  };

  const visible = editor ? departments : departments.filter(d => !d.archived);
  const visibleIds = new Set(visible.map(d => d.id));
  const children = new Map<string, Department[]>();
  for (const department of visible) {
    const parent = department.parentId && visibleIds.has(department.parentId) ? department.parentId : '';
    const siblings = children.get(parent) || [];
    siblings.push(department);
    children.set(parent, siblings);
  }

  const describe = (department: Department) => {
    const name = department.name.trim() || 'قسم جديد';
    const stationIds = departmentStationIds(department, departments);
    const locations = stationIds?.map(id => stations.find(s => s.id === id)?.name || id).join('، ');
    const scope = stationIds ? locations || 'خارج نطاق المحطات' : 'كل المحطات';
    const head = departmentHead(department.id, departments);
    const person = users.find(user => user.id === head);
    return { name, scope, headName: person?.fullName || (head ? 'حساب غير نشط' : 'بلا رئيس محدد') };
  };
  const sourceDetails = source && describe(source);

  const renderBranch = (department: Department, parent?: Department, across = false) => {
    const { name, scope, headName } = describe(department);
    const reports = children.get(department.id);
    const current = selected?.id === department.id;
    const unavailable = !!source && (
      department.archived || source.parentId === department.id || !editor?.parents.some(p => p.id === department.id)
    );
    // Keep wide or multi-level branches readable without a row wider than the canvas.
    const spread = !parent && !!reports && reports.length <= 3 && reports.every(child => !children.has(child.id));
    const cardContent = (
      <>
        <span className="flex items-start justify-between gap-2 text-sm font-bold text-slate-900">
          <span>{name}{department.archived && ' (مؤرشف)'}</span>
          {current && <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-blue-700" />}
        </span>
        <span className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-slate-700">
          <MapPin size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{scope}
        </span>
        <span className="flex items-start gap-1.5 text-xs leading-5 text-slate-600">
          <UserRound size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{headName}
        </span>
      </>
    );
    const branchPosition = parent
      ? 'not-last:pb-2 not-last:before:pointer-events-none not-last:before:absolute not-last:before:-start-4 not-last:before:inset-y-0 not-last:before:border-s not-last:before:border-slate-400'
      : reports ? '@sm:col-span-2' : '';
    const rowPosition = across
      ? '@lg:flex-1 @lg:px-1.5 @lg:pt-5 @lg:not-last:pb-0 @lg:not-last:before:hidden @lg:after:pointer-events-none @lg:after:absolute @lg:after:inset-x-0 @lg:after:top-3 @lg:after:border-t @lg:after:border-slate-400 @lg:first:after:start-1/2 @lg:last:after:end-1/2 @lg:only:after:hidden'
      : '';
    return (
      <li key={department.id} className={`relative min-w-28 ${branchPosition} ${rowPosition}`}>
        <div className={`relative ${spread ? '@lg:mx-auto @lg:max-w-64' : ''} ${across ? '@lg:static' : ''}`}>
          {parent && (
            <span aria-hidden="true" data-testid={`department-link-${parent.id}-${department.id}`}
              className={`pointer-events-none absolute -start-4 top-0 h-1/2 w-4 rounded-es-md border-s border-b border-slate-400 ${across ? '@lg:start-1/2 @lg:top-3 @lg:h-2 @lg:w-px @lg:rounded-none @lg:border-b-0' : ''}`} />
          )}
          {editor ? (
            <button type="button" id={chartId + department.id} aria-pressed={current} disabled={unavailable}
              onClick={() => source ? move(department.id) : editor.onSelect(department.id)}
              className={`${CARD} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${current ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-white enabled:hover:border-blue-500 disabled:opacity-60'}`}>
              {cardContent}
            </button>
          ) : <div className={`${CARD} border-slate-300 bg-white`}>{cardContent}</div>}
        </div>
        {reports && (
          <ul aria-label={`فروع ${name}`}
            className={`relative ms-3 ps-4 pt-3 before:pointer-events-none before:absolute before:start-0 before:top-0 before:h-3 before:border-s before:border-slate-400 ${spread ? '@lg:ms-0 @lg:flex @lg:ps-0 @lg:pt-0 @lg:before:start-1/2' : ''}`}>
            {reports.map(child => renderBranch(child, department, spread))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section aria-label="مخطط الأقسام" className="@container min-w-0 rounded-xl border border-slate-300 bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 sm:px-4">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
          <GitBranch size={18} aria-hidden="true" />مخطط الأقسام
        </h3>
        {editor && !source && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canAdd} onClick={() => editor.onAdd()} className={ACTION}>
              <Plus size={16} aria-hidden="true" />إضافة قسم رئيسي
            </button>
            {selected && (
              <>
                <button type="button" disabled={!canAdd || selected.archived} onClick={() => editor.onAdd(selected)} className={ACTION}>
                  <Plus size={16} aria-hidden="true" />إضافة قسم تابع
                </button>
                <button type="button" id={chartId + '-move'} disabled={!selected.parentId && !editor.parents.length}
                  onClick={() => { setSourceId(selected.id); focusControl(chartId + '-destination'); }} className={ACTION}>
                  <Move size={16} aria-hidden="true" />نقل القسم المحدد
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {source && sourceDetails && (
        <div className="border-b border-blue-200 bg-blue-50 px-3 py-2 text-sm sm:px-4">
          <p id={chartId + '-destination'} role="status" tabIndex={-1} className="text-blue-900">
            اختر القسم الأعلى الجديد لـ«{sourceDetails.name} · {sourceDetails.scope} · {sourceDetails.headName}».
          </p>
          <div className="flex flex-wrap gap-x-3">
            {source.parentId && <button type="button" className="min-h-11 font-bold text-blue-800" onClick={() => move()}>نقل إلى المستوى الرئيسي</button>}
            <button type="button" className="min-h-11 text-slate-700 underline" onClick={() => { setSourceId(undefined); focusControl(chartId + '-move'); }}>إلغاء النقل</button>
          </div>
        </div>
      )}
      <div className="max-h-[33rem] overflow-auto px-3 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 sm:px-4"
        role="group" aria-label="التسلسل الإداري للأقسام" tabIndex={0}>
        <ul className="grid items-start gap-3 @sm:grid-cols-2">{children.get('')?.map(department => renderBranch(department))}</ul>
      </div>
    </section>
  );
}
