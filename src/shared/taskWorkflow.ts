import type { EditorialTask, TaskStatus } from '../types';
import { AR, countLabel } from './arabicPlural';

export type CanonicalTaskStatus = Exclude<TaskStatus, 'DONE'>;

export interface TaskWorkflowRules {
  requireReview?: boolean;
  requireBlockedReason?: boolean;
  reopenManagersOnly?: boolean;
}

export interface TaskExecution {
  startedAt?: string;
  runningSince?: string;
  activeSeconds: number;
  endedAt?: string;
}

export interface TaskStatusRecord {
  status: CanonicalTaskStatus;
  at: string;
  byId: string;
  reason?: string;
}

const TRANSITIONS: Record<CanonicalTaskStatus, readonly CanonicalTaskStatus[]> = {
  TODO: ['IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['IN_REVIEW', 'BLOCKED', 'COMPLETED', 'TODO', 'CANCELLED'],
  IN_REVIEW: ['COMPLETED', 'IN_PROGRESS', 'BLOCKED', 'TODO', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'IN_REVIEW', 'TODO', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['TODO', 'IN_PROGRESS'],
  CANCELLED: ['TODO', 'IN_PROGRESS'],
};

export function normalizeTaskStatus(status?: string): CanonicalTaskStatus {
  if (status === 'DONE') return 'COMPLETED';
  return status && Object.hasOwn(TRANSITIONS, status) ? (status as CanonicalTaskStatus) : 'TODO';
}

export function isTaskClosed(status?: string): boolean {
  const normalized = normalizeTaskStatus(status);
  return normalized === 'COMPLETED' || normalized === 'CANCELLED';
}

export function taskWorkflowOptions(status: TaskStatus | undefined, rules: TaskWorkflowRules | undefined, canManage: boolean): CanonicalTaskStatus[] {
  const current = normalizeTaskStatus(status);
  if (!canManage && (current === 'CANCELLED' || (rules?.reopenManagersOnly && current === 'COMPLETED'))) return [];
  return TRANSITIONS[current].filter((next) => (next !== 'CANCELLED' || canManage) &&
    (next !== 'COMPLETED' || !rules?.requireReview || (current === 'IN_REVIEW' && canManage)));
}

export function taskWorkflowError(value: unknown): string | null {
  if (value === undefined) return null;
  const fields = ['requireReview', 'requireBlockedReason', 'reopenManagersOnly'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.entries(value).some(([key, item]) => !fields.includes(key) || typeof item !== 'boolean')) {
    return 'خيارات سير عمل المهام غير صالحة';
  }
  return null;
}

export function taskTransitionError(before: EditorialTask | null, after: EditorialTask, rules: TaskWorkflowRules | undefined, canManage: boolean): string | null {
  const current = normalizeTaskStatus(before?.status);
  const next = normalizeTaskStatus(after.status);
  if (before?.status !== after.status && after.status !== 'DONE' && !Object.hasOwn(TRANSITIONS, after.status)) return 'حالة المهمة غير صالحة';
  if (current !== next && !taskWorkflowOptions(current, rules, canManage).includes(next)) {
    if (next === 'COMPLETED' && rules?.requireReview) return current === 'IN_REVIEW' ? 'إقرار إكمال المهمة لمسؤولي المهام' : 'مرّر المهمة إلى المراجعة قبل إكمالها';
    return 'لا يسمح سير العمل بالانتقال إلى هذه الحالة';
  }
  if (next === 'BLOCKED' && (current !== next || before?.blockedReason !== after.blockedReason)) {
    const reason = typeof after.blockedReason === 'string' ? after.blockedReason.trim() : '';
    if (rules?.requireBlockedReason && !reason) return 'اذكر سبب تعطل المهمة';
    if (reason.length > 500) return 'يجب ألا يزيد سبب التعطل على 500 حرف';
  }
  return null;
}

function secondsSince(iso: string | undefined, end: number): number {
  const start = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

/** Only the server calls this on accepted writes. Client-supplied timing and history are ignored. */
export function stampTaskWorkflow(before: EditorialTask | null, after: EditorialTask, actorId: string, now: string): EditorialTask {
  const next = normalizeTaskStatus(after.status);
  const previous = normalizeTaskStatus(before?.status);
  const prior = before?.execution;
  const running = next === 'IN_PROGRESS';
  const finished = isTaskClosed(next);
  const reason = next === 'BLOCKED' && typeof after.blockedReason === 'string' ? after.blockedReason.trim() || undefined : undefined;
  const execution: TaskExecution = {
    activeSeconds: (prior?.activeSeconds || 0) + (running ? 0 : secondsSince(prior?.runningSince, Date.parse(now))),
    startedAt: prior?.startedAt ?? (running ? now : undefined),
    runningSince: running ? prior?.runningSince || now : undefined,
    endedAt: finished && prior?.startedAt ? prior.endedAt || now : undefined,
  };
  const statusHistory = !before || previous !== next || (next === 'BLOCKED' && reason !== before.blockedReason)
    ? [...(before?.statusHistory || []).slice(-99), { status: next, at: now, byId: actorId, ...(reason ? { reason } : {}) }]
    : before.statusHistory;
  return { ...after, status: next, execution, blockedReason: reason, statusHistory };
}

export function taskTiming(task: Pick<EditorialTask, 'execution'>, now = Date.now()) {
  const value = task.execution;
  return {
    activeSeconds: (value?.activeSeconds || 0) + secondsSince(value?.runningSince, now),
    elapsedSeconds: value?.startedAt ? secondsSince(value.startedAt, value.endedAt ? Date.parse(value.endedAt) : now) : null,
  };
}

export function taskDurationLabel(seconds: number): string {
  if (seconds < 60) return 'أقل من دقيقة';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return [hours ? countLabel(hours, AR.hour) : '', minutes % 60 ? countLabel(minutes % 60, AR.minute) : ''].filter(Boolean).join(' و');
}
