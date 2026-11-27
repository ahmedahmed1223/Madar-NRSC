import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, CircleDot, Flag, GitBranch, MapPin } from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { currentTheme, subscribeTheme, type ThemeMode } from '../../services/theme';
import { layoutFlowchart } from '../../shared/flowchartLayout';
import type { WorkflowTone } from '../../shared/workflowGraph';

export interface FlowchartCanvasNode {
  id: string;
  label: string;
  description?: string;
  meta?: string[];
  tone?: WorkflowTone;
  testId?: string;
  column?: number;
  row?: number;
  shape?: NodeShape;
}

export interface FlowchartCanvasEdge {
  id: string;
  source: string;
  target: string;
  testId: string;
  kind?: 'forward' | 'return';
}

interface Props {
  nodes: FlowchartCanvasNode[];
  edges: FlowchartCanvasEdge[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onConnectSteps?: (source: string, target: string) => void;
  label: string;
  directed?: boolean;
  focusSelectedEdges?: boolean;
  autoLayout?: boolean;
  height?: number;
}

type MadarNode = Node<FlowchartCanvasNode & { editable: boolean } & Record<string, unknown>, 'madar'>;
type MadarEdge = Edge<{ testId: string; dimmed: boolean; highlighted: boolean; routeIndex: number }, 'madar'>;

type NodeShape = 'start' | 'step' | 'terminal' | 'station' | 'main-station' | 'state';

const SHAPES = {
  start: { Icon: CircleDot, classes: 'rounded-full px-5', width: 168, height: 84 },
  terminal: { Icon: CheckCircle2, classes: 'rounded-full px-5', width: 168, height: 84 },
  step: { Icon: Flag, classes: 'rounded-lg', width: 218, height: 112 },
  station: { Icon: MapPin, classes: 'rounded-xl', width: 226, height: 112 },
  'main-station': { Icon: Building2, classes: 'rounded-xl font-semibold', width: 238, height: 124 },
  state: { Icon: GitBranch, classes: 'rounded-2xl', width: 190, height: 104 },
} as const;

const TONES: Record<WorkflowTone, string> = {
  neutral: 'border-slate-300 bg-white text-slate-800',
  current: 'border-blue-600 bg-blue-50 text-blue-950',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  blocked: 'border-rose-300 bg-rose-50 text-rose-950',
  late: 'border-amber-300 bg-amber-50 text-amber-950',
  cancelled: 'border-slate-400 bg-slate-100 text-slate-700',
  skipped: 'border-dashed border-slate-300 bg-slate-50 text-slate-500',
};

function MadarNodeView({ data, selected }: NodeProps<MadarNode>) {
  const tone = data.tone || 'neutral';
  const shape = data.shape || 'step';
  const { Icon, classes } = SHAPES[shape];
  return <>
    {[Position.Right, Position.Left, Position.Top, Position.Bottom].map(position =>
      <Handle key={`target-${position}`} id={position} type="target" position={position} isConnectable={data.editable && position === Position.Right}
        data-testid={data.editable && position === Position.Right ? `${data.testId}-input` : undefined}
        className={data.editable && position === Position.Right ? 'madar-flowchart-port' : '!opacity-0'} />
    )}
    <button type="button" dir="rtl" data-node-shape={shape} data-workflow-node={data.id} data-testid={data.testId} aria-pressed={!!selected}
      className={`h-full w-full overflow-hidden border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${classes} ${TONES[tone]} ${selected ? 'border-blue-600 ring-2 ring-blue-300' : 'hover:border-blue-500'}`}>
      <span className="flex items-center gap-2"><Icon size={17} className="shrink-0" aria-hidden="true" /><strong className="min-w-0 truncate text-sm">{data.label}</strong></span>
      {data.description && <span className="mt-1 block truncate text-xs opacity-80">{data.description}</span>}
      {data.meta?.[0] && <span className="mt-2 block truncate text-2xs opacity-75">{data.meta[0]}</span>}
    </button>
    {[Position.Right, Position.Left, Position.Top, Position.Bottom].map(position =>
      <Handle key={`source-${position}`} id={position} type="source" position={position} isConnectable={data.editable && position === Position.Left}
        data-testid={data.editable && position === Position.Left ? `${data.testId}-output` : undefined}
        className={data.editable && position === Position.Left ? 'madar-flowchart-port' : '!opacity-0'} />
    )}
  </>;
}

function MadarEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style }: EdgeProps<MadarEdge>) {
  const [path] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 14, offset: 22 + (data?.routeIndex || 0) * 6,
  });
  const highlighted = data?.highlighted;
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} data-testid={data?.testId} style={{ ...style, stroke: highlighted ? 'var(--color-blue-600)' : 'var(--color-slate-500)', strokeWidth: highlighted ? 2.5 : 1.6, opacity: data?.dimmed ? 0 : 1 }} />;
}

const nodeTypes = { madar: MadarNodeView };
const edgeTypes = { madar: MadarEdgeView };

export function FlowchartCanvas({ nodes: inputNodes, edges: inputEdges, selectedId, onSelect, onConnectSteps, label, directed = true, focusSelectedEdges = false, autoLayout = true, height = 430 }: Props) {
  const [mode, setMode] = useState<ThemeMode>('light');
  useEffect(() => {
    setMode(currentTheme());
    return subscribeTheme(setMode);
  }, []);
  const linking = !!onConnectSteps;
  const canConnect = ({ source, target }: Connection | Edge) => linking && source !== target && source.startsWith('step:') && target.startsWith('step:');
  const signature = useMemo(() => JSON.stringify([inputNodes.map(node => node.id), inputEdges.map(edge => edge.id)]), [inputNodes, inputEdges]);
  const { nodes, edges } = useMemo(() => {
    const columns = Math.max(1, ...inputNodes.map(node => (node.column || 0) + 1));
    const layout = autoLayout
      ? layoutFlowchart({ nodes: inputNodes.map(node => {
        const { width, height } = SHAPES[node.shape ?? 'step'];
        return { id: node.id, width, height };
      }), edges: inputEdges, direction: 'RL' })
      : Object.fromEntries(inputNodes.map(node => [node.id, {
        x: 24 + (columns - 1 - (node.column || 0)) * 246,
        y: 24 + (node.row || 0) * 160,
        width: 190,
        height: 104,
      }]));
    const nodes: MadarNode[] = inputNodes.map(node => ({
      id: node.id,
      type: 'madar',
      position: layout[node.id],
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      selected: node.id === selectedId,
      zIndex: 10,
      data: { ...node, editable: linking && node.shape === 'step' },
      style: { width: layout[node.id].width, height: layout[node.id].height },
      draggable: false,
      connectable: linking && node.shape === 'step',
    }));
    const routeCounts = new Map<string, number>();
    const edges: MadarEdge[] = inputEdges.map(edge => {
      const routeIndex = routeCounts.get(edge.source) || 0;
      routeCounts.set(edge.source, routeIndex + 1);
      const source = layout[edge.source];
      const target = layout[edge.target];
      const dx = target.x + target.width / 2 - (source.x + source.width / 2);
      const dy = target.y + target.height / 2 - (source.y + source.height / 2);
      const useVertical = Math.abs(dx) < 4 || (Math.abs(dy) < 4 && Math.abs(dx) > 420);
      const sourceHandle = useVertical
        ? dy > 0 ? Position.Bottom : Position.Top
        : dx > 0 ? Position.Right : Position.Left;
      const targetHandle = useVertical
        ? dy > 0 ? Position.Top : Position.Bottom
        : dx > 0 ? Position.Left : Position.Right;
      const highlighted = edge.source === selectedId || !focusSelectedEdges && edge.target === selectedId;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle,
        targetHandle,
        type: 'madar',
        selected: false,
        zIndex: 0,
        markerEnd: directed ? { type: MarkerType.ArrowClosed, width: 18, height: 18, color: 'var(--color-slate-500)' } : undefined,
        data: { testId: edge.testId, highlighted, routeIndex, dimmed: focusSelectedEdges && edge.source !== selectedId },
        style: edge.kind === 'return' ? { strokeDasharray: '7 5' } : undefined,
      };
    });
    return { nodes, edges };
  }, [inputNodes, inputEdges, selectedId, directed, focusSelectedEdges, autoLayout, linking]);

  return <div className="madar-flowchart overflow-hidden border-b border-slate-200 bg-slate-50" style={{ height: `min(${height}px, 58dvh)` }} role="group" aria-label={`${label} — مخطط تفاعلي`}>
    <ReactFlowProvider>
      <ReactFlow
        key={signature}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        forceColorMode={mode}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={linking}
        isValidConnection={canConnect}
        onConnect={({ source, target }) => onConnectSteps?.(source, target)}
        nodesFocusable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        zoomOnScroll={false}
        panOnDrag
        preventScrolling={false}
        ariaLabelConfig={{
          'controls.zoomIn.ariaLabel': 'تكبير المخطط',
          'controls.zoomOut.ariaLabel': 'تصغير المخطط',
          'controls.fitView.ariaLabel': 'إظهار المخطط كاملًا',
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" aria-label="التحكم في عرض المخطط" />
        <MiniMap position="bottom-right" className="!hidden sm:!block !pointer-events-none" nodeColor="#94a3b8" maskColor="rgba(148, 163, 184, 0.16)" />
      </ReactFlow>
    </ReactFlowProvider>
  </div>;
}
