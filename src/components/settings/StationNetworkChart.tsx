import { useState } from 'react';
import { GitBranch, List, Map as MapIcon, Pencil } from 'lucide-react';
import type { StationNetwork } from '../../shared/stationNetwork';
import type { Station } from '../../shared/stations';
import { FlowchartCanvas } from '../flowchart/FlowchartCanvas';
import { StationNetworkEditor } from './StationNetworkEditor';

interface Props {
  network: StationNetwork;
  stations: readonly Station[];
  onEditStations: () => void;
  canEdit?: boolean;
}

export function StationNetworkChart({ network, stations, onEditStations, canEdit }: Props) {
  const [mode, setMode] = useState<'map' | 'list'>(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches ? 'list' : 'map');
  const [editingId, setEditingId] = useState<string>();
  const [selectedId, setSelectedId] = useState(network.nodes[0]?.id);
  const selected = network.nodes.find(node => node.id === selectedId) ?? network.nodes[0];
  const editing = canEdit && editingId ? stations.find(station => station.id === editingId) : undefined;
  const ordered = [...network.nodes].sort((a, b) => Number(b.isMain) - Number(a.isMain));
  const scopeNames = selected ? stations.filter(station => selected.scopeIds.includes(station.id)).map(station => station.name) : [];
  const nodeSummary = (id: string) => {
    const node = network.nodes.find(item => item.id === id);
    if (!node) return '';
    return node.isMain ? 'المحطة الرئيسية؛ تتابع كل المحطات' : node.open ? 'محطة مفتوحة للمحطات غير المقيدة' : 'محطة بنطاق تعاون محدد';
  };

  return (
    <section aria-label="خريطة تعاون المحطات" className="overflow-hidden rounded-xl border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 sm:px-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><GitBranch size={17} aria-hidden="true" />المحطات وروابط التعاون</h3>
          <p className="mt-0.5 text-xs text-slate-600">الخطوط المتقطعة روابط مصرّح بها؛ نطاق المتابعة يظهر في تفاصيل المحطة.</p>
        </div>
        <div role="group" aria-label="طريقة عرض المحطات" className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')} className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-bold ${mode === 'map' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}><MapIcon size={15} aria-hidden="true" />عرض الخريطة</button>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')} className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-bold ${mode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}><List size={15} aria-hidden="true" />عرض قائمة المحطات</button>
        </div>
      </div>

      {!network.nodes.length ? <p className="p-6 text-sm text-slate-600">لا توجد محطات بعد. أضف أول محطة من محرر المحطات.</p> : mode === 'map' ? <FlowchartCanvas
        nodes={ordered.map(node => ({
          id: node.id,
          label: node.name,
          description: nodeSummary(node.id),
          meta: [`${node.memberCount} زملاء`, ...node.groupNames],
          tone: node.isMain ? 'current' : 'neutral',
          testId: `station-node-${node.id}`,
          shape: node.isMain ? 'main-station' : 'station',
        }))}
        edges={network.edges.map(edge => ({ ...edge, kind: 'return', testId: `station-link-${edge.source}-${edge.target}` }))}
        selectedId={selected?.id}
        onSelect={setSelectedId}
        label="خريطة تعاون المحطات"
        directed={false}
        height={460}
      /> : <ul aria-label="قائمة المحطات وروابطها" className="grid gap-3 bg-slate-50 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
        {ordered.map(node => <li key={node.id}>
          <button type="button" aria-pressed={selected?.id === node.id} onClick={() => setSelectedId(node.id)} className={`min-h-11 w-full rounded-xl border p-3 text-start focus-visible:outline-2 focus-visible:outline-blue-600 ${selected?.id === node.id ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-500'}`}>
            <span className="flex items-center justify-between gap-2"><strong className="text-sm text-slate-900">{node.name}</strong><span className="text-xs text-slate-600">{node.memberCount} زملاء</span></span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">{nodeSummary(node.id)}</span>
            {!!node.groupNames.length && <span className="mt-1 block text-2xs text-slate-600">{node.groupNames.join('، ')}</span>}
          </button>
        </li>)}
      </ul>}

      {selected && <section aria-label={`تفاصيل محطة ${selected.name}`} className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0 space-y-2 break-words text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-bold text-slate-900">{selected.name}</h4>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-2xs font-bold text-slate-700">{selected.isMain ? 'المحطة الرئيسية' : selected.open ? 'تعاون مفتوح' : 'تعاون محدد'}</span>
            <span className="text-xs text-slate-600">{selected.memberCount} زملاء نشطين</span>
          </div>
          <p className="leading-6 text-slate-700"><strong>تتابع وتكلّف:</strong> {scopeNames.join('، ') || 'نفسها فقط'}.</p>
          {selected.isMain && <p className="text-xs text-slate-600">المحطة الرئيسية تتابع جميع الفروع؛ لا تمثل الخطوط تبعية إدارية.</p>}
          {selected.open && !selected.isMain && <p className="text-xs text-slate-600">غياب قائمة الروابط يعني الانفتاح على المحطات غير المقيدة، لا غياب التعاون.</p>}
          <p className="text-xs leading-5 text-slate-600"><strong>المجموعات:</strong> {selected.groupNames.join('، ') || 'ليست ضمن مجموعة محطات'}.</p>
          <p className="text-xs leading-5 text-slate-600"><strong>المديرون العامون:</strong> {selected.managerNames.join('، ') || 'لا مدير عام محدد لهذه المحطة'}.</p>
        </div>
        {canEdit && !editing && <button type="button" onClick={() => setEditingId(selected.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><Pencil size={15} aria-hidden="true" />تعديل المحطة في الخريطة</button>}
      </section>}
      {editing && <StationNetworkEditor key={editing.id} station={editing} stations={stations} onClose={() => setEditingId(undefined)} />}
      {!selected && canEdit && <button type="button" onClick={onEditStations} className="m-3 min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold text-blue-700">فتح إعدادات المحطات</button>}
    </section>
  );
}
