import { TASK_STATUS_LABELS } from './labels';
import {
  currentStep,
  isStepLate,
  stepAssigneeLabel,
  stepStatusName,
  stepTypeName,
  type ProductionCard,
  type StepType,
} from './productionCards';
import { taskWorkflowOptions, type CanonicalTaskStatus, type TaskWorkflowRules } from './taskWorkflow';
import { RULE_KINDS, type WorkflowTemplate } from './workflowTemplates';

export type WorkflowTone = 'neutral' | 'current' | 'done' | 'blocked' | 'late' | 'cancelled' | 'skipped';

export interface WorkflowGraphNode {
  id: string;
  label: string;
  description?: string;
  meta: string[];
  tone: WorkflowTone;
  column: number;
  row: number;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'forward' | 'return';
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

const STATUS_LAYOUT: Record<CanonicalTaskStatus, { column: number; row: number }> = {
  TODO: { column: 0, row: 0 },
  IN_PROGRESS: { column: 1, row: 0 },
  IN_REVIEW: { column: 2, row: 0 },
  COMPLETED: { column: 2, row: 1 },
  BLOCKED: { column: 1, row: 1 },
  CANCELLED: { column: 0, row: 1 },
};

export function buildTaskStatusGraph(rules?: TaskWorkflowRules, canManage = true): WorkflowGraph {
  const statuses = Object.keys(STATUS_LAYOUT) as CanonicalTaskStatus[];
  const nodes = statuses.map(status => ({
    id: status,
    label: TASK_STATUS_LABELS[status],
    meta: [],
    tone: status === 'COMPLETED' ? 'done' as const : status === 'BLOCKED' ? 'blocked' as const : status === 'CANCELLED' ? 'cancelled' as const : 'neutral' as const,
    ...STATUS_LAYOUT[status],
  }));
  const edges = statuses.flatMap(source => taskWorkflowOptions(source, rules, canManage).map(target => ({
    id: `${source}:${target}`,
    source,
    target,
    kind: target === 'TODO' || (target === 'IN_PROGRESS' && ['BLOCKED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED'].includes(source)) ? 'return' as const : 'forward' as const,
  })));
  return { nodes, edges };
}

function sequenceEdges(ids: string[]): WorkflowGraphEdge[] {
  return ids.slice(0, -1).map((source, index) => ({ id: `${source}:${ids[index + 1]}`, source, target: ids[index + 1], kind: 'forward' }));
}

export function buildTemplateWorkflowGraph(template: WorkflowTemplate, types: StepType[]): WorkflowGraph {
  const nodes: WorkflowGraphNode[] = [
    { id: 'start', label: 'بداية التكليف', meta: [template.name], tone: 'neutral', column: 0, row: 0 },
    ...template.steps.map((step, index) => ({
      id: `step:${step.id}`,
      label: stepTypeName(types, step.type),
      description: step.title,
      meta: [RULE_KINDS.find(rule => rule.id === step.rule.kind)?.name || 'مسؤول الخطوة', step.estimateMinutes ? `${step.estimateMinutes} دقيقة مقدرة` : ''].filter(Boolean),
      tone: 'neutral' as const,
      column: index + 1,
      row: 0,
    })),
    { id: 'end', label: 'التسليم', meta: [`${template.steps.length} خطوات`], tone: 'done', column: template.steps.length + 1, row: 0 },
  ];
  return { nodes, edges: sequenceEdges(nodes.map(node => node.id)) };
}

export function buildCardWorkflowGraph(card: ProductionCard, types: StepType[], now = Date.now()): WorkflowGraph {
  const active = currentStep(card);
  const nodes: WorkflowGraphNode[] = [
    { id: 'start', label: 'بداية التكليف', meta: [card.title], tone: 'neutral', column: 0, row: 0 },
    ...card.steps.map((step, index) => {
      const tone: WorkflowTone = step.status === 'DONE' ? 'done'
        : step.status === 'SKIPPED' ? 'skipped'
          : step.status === 'BLOCKED' ? 'blocked'
            : isStepLate(step, now) ? 'late'
              : active?.id === step.id ? 'current' : 'neutral';
      return {
        id: `step:${step.id}`,
        label: stepTypeName(types, step.type),
        description: step.title,
        meta: [stepAssigneeLabel(step), stepStatusName(step.status), step.blockedReason ? `السبب: ${step.blockedReason}` : ''].filter(Boolean),
        tone,
        column: index + 1,
        row: 0,
      };
    }),
    { id: 'end', label: card.status === 'CANCELLED' ? 'التكليف ملغى' : 'التسليم', meta: [], tone: card.status === 'CLOSED' ? 'done' : card.status === 'CANCELLED' ? 'cancelled' : 'neutral', column: card.steps.length + 1, row: 0 },
  ];
  return { nodes, edges: sequenceEdges(nodes.map(node => node.id)) };
}
