import { WORKFLOW_TRACKS, type WorkflowTrack } from './workflowTracks';
import type { CardStep, ProductionCard } from './productionCards';

export interface StepDependency {
  stepId: string;
  threshold: 'PARTIAL' | 'DONE';
}

export interface StepExecutionRules {
  dependencies?: StepDependency[];
  optional?: boolean;
  receiptMinutes?: number;
  executionTrack?: WorkflowTrack;
}

export const MAX_RECEIPT_MINUTES = 1440;
const terminal = (step: Pick<CardStep, 'status'>) => step.status === 'DONE' || step.status === 'SKIPPED';

export function stepExecutionRulesError(steps: (StepExecutionRules & { id: string; type: string })[]): string | null {
  const ids = new Set(steps.map(step => step.id));
  for (const step of steps) {
    if (step.executionTrack !== undefined && !WORKFLOW_TRACKS.includes(step.executionTrack)) return 'مسار تنفيذ المهمة غير صالح';
    if (step.optional !== undefined && typeof step.optional !== 'boolean') return 'خيار تجاوز المهمة غير صالح';
    if (step.type === 'approve' && step.optional) return 'خطوة الاعتماد إلزامية';
    if (step.receiptMinutes !== undefined && (!Number.isInteger(step.receiptMinutes) || step.receiptMinutes < 1 || step.receiptMinutes > MAX_RECEIPT_MINUTES)) {
      return `مهلة تأكيد الاستلام من دقيقة إلى ${MAX_RECEIPT_MINUTES} دقيقة`;
    }
    const dependencies = step.dependencies;
    if (dependencies === undefined) continue;
    if (!Array.isArray(dependencies) || dependencies.length > steps.length || dependencies.some(dep =>
      !dep || !ids.has(dep.stepId) || !['PARTIAL', 'DONE'].includes(dep.threshold)) ||
      new Set(dependencies.map(dep => dep.stepId)).size !== dependencies.length) return 'تبعية المهمة غير موجودة أو مكررة';
  }

  const edges = new Map(steps.map(step => [step.id, step.dependencies ?? []]));
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (complete.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    if (edges.get(id)?.some(dep => hasCycle(dep.stepId))) return true;
    visiting.delete(id);
    complete.add(id);
    return false;
  };
  return steps.some(step => hasCycle(step.id)) ? 'توجد حلقة في تبعيات المهام' : null;
}

export function pendingStepDependencies(card: ProductionCard, step: CardStep): CardStep[] {
  const dependencies = new Map((step.dependencies ?? []).map(dep => [dep.stepId, dep.threshold]));
  return card.steps.filter(candidate => {
    const threshold = dependencies.get(candidate.id);
    if (!threshold || terminal(candidate)) return false;
    return threshold !== 'PARTIAL' || !card.log?.some(entry =>
      entry.stepId === candidate.id && entry.delivery && (!candidate.returnedAt || (entry.at ?? '') > candidate.returnedAt));
  });
}

export function stepReceiptPending(step: CardStep): boolean {
  return !!step.receiptMinutes && !!step.assigneeId && !step.receiptConfirmedAt && !terminal(step);
}

export function stepReceiptDeadline(step: CardStep): number {
  if (!stepReceiptPending(step) || !step.receiptAssignedAt) return NaN;
  return Date.parse(step.receiptAssignedAt) + (step.receiptMinutes ?? 0) * 60_000;
}

export function stepStartError(card: ProductionCard, step: CardStep): string | null {
  if (stepReceiptPending(step)) return 'يلزم تأكيد الاستلام أولًا';
  if (pendingStepDependencies(card, step).length) return 'انتظر اكتمال التبعيات المطلوبة لهذه المهمة';
  return null;
}
