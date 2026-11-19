/**
 * Server side of production cards: the fields a browser may not decide (who did a step and
 * when, names, stations, the documented trail) and who hears about a change.
 */
import { newId } from '../shared/ids';
import { isStepOpen, stepStatusName, stepTypeName, type CardLogEntry, type CardStep, type ProductionCard, type StepType } from '../shared/productionCards';
import type { User } from '../types';

const MAX_LOG = 500;

export function stampCard(before: ProductionCard | null, after: ProductionCard, actor: User, users: Map<string, User>, stepTypes: StepType[], canManage: boolean): ProductionCard {
  const now = new Date().toISOString();
  const by = { byId: actor.id, byName: actor.fullName, stationId: actor.stationId, at: now };
  const log: CardLogEntry[] = [...(before?.log || [])];
  for (const entry of (after.log || []).slice(log.length)) {
    log.push({ id: entry.id, kind: 'NOTE', stepId: typeof entry.stepId === 'string' ? entry.stepId : undefined, text: entry.text.trim(), ...by });
  }
  const record = (step: CardStep, text: string) => log.push({ id: newId('log'), kind: 'STEP', stepId: step.id, text, ...by });

  const previous = new Map((before?.steps || []).map((s) => [s.id, s]));
  const steps = after.steps.map((step): CardStep => {
    const prev = previous.get(step.id);
    const member = step.assigneeId ? users.get(step.assigneeId) : undefined;
    const name = stepTypeName(stepTypes, step.type);
    const next: CardStep = {
      ...step,
      title: step.title?.trim() || undefined,
      note: step.note?.trim() || undefined,
      assigneeName: member?.fullName,
      stationId: member?.stationId || step.stationId || undefined,
      blockedReason: step.status === 'BLOCKED' ? step.blockedReason?.trim() : undefined,
      startedAt: step.status === 'TODO' ? undefined : prev?.startedAt || now,
      doneAt: undefined,
      doneById: undefined,
      doneByName: undefined,
    };
    if (step.status === 'DONE') {
      const keep = prev?.status === 'DONE';
      next.doneAt = keep ? prev!.doneAt : now;
      next.doneById = keep ? prev!.doneById : actor.id;
      next.doneByName = keep ? prev!.doneByName : actor.fullName;
    }
    if (step.assigneeId && step.assigneeId !== prev?.assigneeId) record(next, step.assigneeId === actor.id ? `استلم «${name}»` : `أُسندت «${name}» إلى ${member?.fullName || 'زميل'}`);
    if (prev ? prev.status !== step.status : step.status !== 'TODO') {
      const detail = step.status === 'BLOCKED' ? next.blockedReason : step.status === 'DONE' ? next.note : '';
      record(next, `«${name}»: ${stepStatusName(step.status)}${detail ? ` — ${detail}` : ''}`);
    }
    return next;
  });

  const owner = users.get(after.ownerId || before?.ownerId || '') || (before ? undefined : actor);
  const scriptChanged = (before?.script || '') !== (after.script || '');
  // Only a supervisor approves a script, and an approval never survives a change to the text by someone else.
  const approved = canManage ? !!after.scriptApproved : !!before?.scriptApproved && !scriptChanged;
  const freshApproval = approved && (!before?.scriptApproved || (canManage && scriptChanged));
  if (freshApproval) log.push({ id: newId('log'), kind: 'STEP', text: 'اعتُمد النص', ...by });
  if (before && before.status !== after.status) log.push({ id: newId('log'), kind: 'STEP', text: after.status === 'CLOSED' ? 'أُغلقت البطاقة بعد الإنجاز' : after.status === 'CANCELLED' ? 'أُلغيت البطاقة' : 'أُعيد فتح البطاقة', ...by });

  return {
    ...after,
    title: after.title.trim(),
    brief: after.brief?.trim() || undefined,
    steps,
    log: log.slice(-MAX_LOG),
    ownerId: owner?.id,
    ownerName: owner?.fullName,
    ownerStationId: owner?.stationId,
    scriptApproved: approved,
    scriptApprovedById: approved ? (freshApproval ? actor.id : before?.scriptApprovedById) : undefined,
    scriptApprovedByName: approved ? (freshApproval ? actor.fullName : before?.scriptApprovedByName) : undefined,
    scriptApprovedAt: approved ? (freshApproval ? now : before?.scriptApprovedAt) : undefined,
    createdById: before?.createdById || actor.id,
    createdByName: before?.createdByName || actor.fullName,
    createdAt: before?.createdAt || now,
    updatedAt: now,
    closedAt: after.status === 'CLOSED' ? (before?.status === 'CLOSED' && before.closedAt) || now : undefined,
  };
}

export interface CardNotice {
  userId: string;
  title: string;
  message: string;
  urgent: boolean;
}

/** Who should hear about this change: the newly assigned, the next person in the chain, the decision owner. */
export function cardNotices(before: ProductionCard | null, after: ProductionCard, actorId: string, actorName: string, stepTypes: StepType[]): CardNotice[] {
  if (after.status !== 'OPEN') return [];
  const notices: CardNotice[] = [];
  const urgent = after.priority === 'URGENT';
  const previous = new Map((before?.steps || []).map((s) => [s.id, s]));
  const decider = after.ownerId || after.createdById;
  const push = (userId: string | undefined, title: string, message: string, force = false) => {
    if (userId && userId !== actorId) notices.push({ userId, title, message, urgent: urgent || force });
  };

  after.steps.forEach((step, index) => {
    const prev = previous.get(step.id);
    const name = stepTypeName(stepTypes, step.type);
    if (step.assigneeId && step.assigneeId !== prev?.assigneeId) push(step.assigneeId, `${urgent ? 'عاجل — ' : ''}مهمة لك في بطاقة إنتاج: ${name}`, after.title);
    if (prev && prev.status !== step.status && step.status === 'BLOCKED') push(decider, 'تعطّل في بطاقة إنتاج يحتاج قرارك', `${after.title} — ${name}: ${step.blockedReason || ''}`, true);
    if (step.status === 'DONE' && prev?.status !== 'DONE') {
      const next = after.steps.slice(index + 1).find(isStepOpen) || after.steps.find(isStepOpen);
      const handoff = `${after.title} — أنهى ${actorName} «${name}»${step.note ? `: ${step.note}` : ''}`;
      if (next) push(next.assigneeId, `وصلتك المادة: ${stepTypeName(stepTypes, next.type)}`, handoff);
      else push(decider, 'بطاقة إنتاج جاهزة', handoff);
    }
  });
  // One notice per person and title is enough.
  const seen = new Set<string>();
  return notices.filter((n) => !seen.has(`${n.userId}|${n.title}`) && seen.add(`${n.userId}|${n.title}`));
}
