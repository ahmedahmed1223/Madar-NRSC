import { ArrowLeft, ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import type { StepExecutionRules } from '../../shared/cardExecution';

export interface WorkflowNode extends StepExecutionRules {
  id: string;
  label: string;
  detail?: string;
  status?: string;
}

function groups(nodes: WorkflowNode[]) {
  const placed = new Set<string>();
  const pending = [...nodes];
  const levels: WorkflowNode[][] = [];
  while (pending.length) {
    const ready = pending.filter(node => (node.dependencies ?? []).every(dep => placed.has(dep.stepId)));
    if (!ready.length) return [...levels, pending];
    levels.push(ready);
    ready.forEach(node => placed.add(node.id));
    for (const node of ready) pending.splice(pending.indexOf(node), 1);
  }
  return levels;
}

export function WorkflowDiagram({ nodes, onMove }: { nodes: WorkflowNode[]; onMove?: (id: string, targetIndex: number) => void }) {
  const labelById = new Map(nodes.map(node => [node.id, node.label]));
  return (
    <section aria-label="مخطط سير العمل" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-bold text-slate-900">{onMove ? 'إعادة ترتيب الخطوات' : 'مخطط سير العمل'}</h3>
      <div tabIndex={0} role="region" aria-label="مراحل سير العمل" className="mt-3 overflow-x-auto">
        <ol className="flex min-w-max items-center gap-3 p-1">
          {groups(nodes).map((level, stage) => (
            <li key={level[0].id} className="flex items-center gap-3">
              {stage > 0 && <ArrowLeft className="size-4 shrink-0 text-slate-500" aria-hidden="true" />}
              <ul className="w-48 space-y-2">
                {level.map(node => {
                  const index = nodes.indexOf(node);
                  return (
                    <li key={node.id} draggable={!!onMove}
                      onDragStart={event => event.dataTransfer.setData('text/plain', node.id)}
                      onDragOver={event => { if (onMove) event.preventDefault(); }}
                      onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (labelById.has(id)) onMove?.(id, index); }}
                      className="rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
                      <p className="break-words font-bold text-slate-900">{node.label}</p>
                      {node.detail && <p className="mt-1 break-words text-xs text-slate-700">{node.detail}</p>}
                      {node.status && <p className="mt-1 text-xs font-semibold text-blue-800">{node.status}</p>}
                      {!!node.dependencies?.length && <ul className="mt-1 text-xs text-slate-600">
                        {node.dependencies.map(dep => <li key={dep.stepId}>بعد {dep.threshold === 'PARTIAL' ? 'إفادة' : 'اكتمال'} {labelById.get(dep.stepId) || 'المهمة'}</li>)}
                      </ul>}
                      {onMove && <div className="mt-1 flex items-center gap-1">
                        <GripVertical className="me-auto size-4 text-slate-500" aria-hidden="true" />
                        <button type="button" className="size-9 rounded text-slate-800 hover:bg-slate-100 disabled:opacity-50" aria-label={`قدّم ${node.label}`} disabled={index === 0} onClick={() => onMove(node.id, index - 1)}><ArrowUp className="mx-auto size-4" aria-hidden="true" /></button>
                        <button type="button" className="size-9 rounded text-slate-800 hover:bg-slate-100 disabled:opacity-50" aria-label={`أخّر ${node.label}`} disabled={index === nodes.length - 1} onClick={() => onMove(node.id, index + 1)}><ArrowDown className="mx-auto size-4" aria-hidden="true" /></button>
                      </div>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
