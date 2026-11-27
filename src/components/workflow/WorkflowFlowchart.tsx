import { useState } from 'react';
import { List, Map as MapIcon, MousePointer2 } from 'lucide-react';
import type { WorkflowGraphNode, WorkflowGraph, WorkflowTone } from '../../shared/workflowGraph';
import { FlowchartCanvas } from '../flowchart/FlowchartCanvas';

const TONES: Record<WorkflowTone, string> = {
  neutral: 'border-slate-300 bg-white text-slate-800',
  current: 'border-blue-600 bg-blue-50 text-blue-950',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  blocked: 'border-rose-300 bg-rose-50 text-rose-950',
  late: 'border-amber-300 bg-amber-50 text-amber-950',
  cancelled: 'border-slate-400 bg-slate-100 text-slate-700',
  skipped: 'border-dashed border-slate-300 bg-slate-50 text-slate-500',
};

interface Props {
  graph: WorkflowGraph;
  label: string;
  onManage?: (node: WorkflowGraphNode) => void;
  manageLabel?: string;
}

export function WorkflowFlowchart({ graph, label, onManage, manageLabel = 'إدارة الخطوة' }: Props) {
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id);
  const selected = graph.nodes.find(node => node.id === selectedId) ?? graph.nodes[0];
  const nextLabels = selected ? graph.edges.filter(edge => edge.source === selected.id).map(edge => graph.nodes.find(node => node.id === edge.target)?.label).filter(Boolean) : [];

  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><MousePointer2 size={15} aria-hidden="true" />اختر عقدة لعرض مسارها وإجراءاتها.</p>
        <div role="group" aria-label={`طريقة عرض ${label}`} className="inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')} className={`inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-xs font-bold ${mode === 'map' ? 'bg-blue-600 text-white' : 'text-slate-700'}`}><MapIcon size={14} aria-hidden="true" />الخريطة</button>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')} className={`inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-xs font-bold ${mode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-700'}`}><List size={14} aria-hidden="true" />القائمة</button>
        </div>
      </div>

      {mode === 'map' ? <FlowchartCanvas
        nodes={graph.nodes.map(node => ({ ...node, testId: `workflow-node-${node.id}`, shape: node.id === 'start' ? 'start' : node.id === 'end' ? 'terminal' : graph.nodes.some(item => item.row > 0) ? 'state' : 'step' }))}
        edges={graph.edges.map(edge => ({ ...edge, testId: `workflow-edge-${edge.source}-${edge.target}` }))}
        selectedId={selected?.id}
        onSelect={setSelectedId}
        label={label}
        focusSelectedEdges={graph.nodes.some(node => node.row > 0)}
        autoLayout={!graph.nodes.some(node => node.row > 0)}
      /> : <ul aria-label={`قائمة ${label}`} className="grid gap-2 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {graph.nodes.map(node => <li key={node.id}><button type="button" data-workflow-node={node.id} aria-pressed={selected?.id === node.id} onClick={() => setSelectedId(node.id)} className={`min-h-11 w-full rounded-xl border p-3 text-start ${TONES[node.tone]} ${selected?.id === node.id ? 'outline-2 outline-blue-600' : ''}`}>
          <strong className="block text-sm">{node.label}</strong>
          {node.description && <span className="mt-1 block text-xs">{node.description}</span>}
          {!!node.meta.length && <span className="mt-1 block text-2xs opacity-75">{node.meta.join(' · ')}</span>}
        </button></li>)}
      </ul>}

      {selected && <section aria-label={`تفاصيل ${selected.label}`} className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-200 p-4">
        <div className="min-w-0 flex-1 basis-64 text-sm">
          <h4 className="font-bold text-slate-900">{selected.label}</h4>
          {selected.description && <p className="mt-1 leading-6 text-slate-700">{selected.description}</p>}
          {!!selected.meta.length && <p className="mt-1 text-xs leading-5 text-slate-600">{selected.meta.join(' · ')}</p>}
          <p className="mt-2 text-xs leading-5 text-slate-600"><strong>المسار التالي:</strong> {nextLabels.length ? nextLabels.join('، ') : 'لا انتقالات لاحقة في هذا المسار'}.</p>
        </div>
        {onManage && selected.id.startsWith('step:') && <button type="button" onClick={() => onManage(selected)} className="min-h-11 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700">{manageLabel}</button>}
      </section>}
    </section>
  );
}
