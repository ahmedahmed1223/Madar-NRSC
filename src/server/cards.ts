/**
 * Server side of production cards: the fields a browser may not decide (who did a step and
 * when, names, stations, the documented trail) and who hears about a change.
 */
import { newId } from '../shared/ids';
import {
  currentStep,
  isStepOpen,
  stepFitsActor,
  stepStatusName,
  stepTypeName,
  timeLogMinutes,
  type CardLogEntry,
  type CardStep,
  type CardTimeEntry,
  type ProductionCard,
  type StepType,
} from '../shared/productionCards';
import { stationScope, type Station } from '../shared/stations';
import type { User } from '../types';

const MAX_LOG = 500;

export interface StampOptions {
  /** Title of a library item, for the trail when it is attached («أُرفق من المكتبة: …»). */
  mediaTitle?: (id: string) => string | undefined;
}

export function stampCard(before: ProductionCard | null, after: ProductionCard, actor: User, users: Map<string, User>, stepTypes: StepType[], canManage: boolean, options: StampOptions = {}): ProductionCard {
  const now = new Date().toISOString();
  const by = { byId: actor.id, byName: actor.fullName, stationId: actor.stationId, at: now };
  const log: CardLogEntry[] = [...(before?.log || [])];
  for (const entry of (after.log || []).slice(log.length)) {
    log.push({ id: entry.id, kind: 'NOTE', stepId: typeof entry.stepId === 'string' ? entry.stepId : undefined, text: entry.text.trim(), ...(entry.decision === true ? { decision: true } : {}), ...by });
  }
  const record = (step: CardStep, text: string) => log.push({ id: newId('log'), kind: 'STEP', stepId: step.id, text, ...by });

  const previous = new Map((before?.steps || []).map((s) => [s.id, s]));
  const steps = after.steps.map((step): CardStep => {
    const prev = previous.get(step.id);
    const member = step.assigneeId ? users.get(step.assigneeId) : undefined;
    const name = stepTypeName(stepTypes, step.type);
    const open = step.status !== 'DONE' && step.status !== 'SKIPPED';
    // Sent back for rework: a done step reopened with a reason. Who and when come from the server.
    const freshReturn = !!prev && prev.status === 'DONE' && open && !!step.returnedReason?.trim();
    const keepReturn = open && !freshReturn && !!prev?.returnedReason;
    // Work sessions: the stored ones stay as they were, new ones are stamped and added to the total.
    const oldTime = prev?.timeLog || [];
    const added = (step.timeLog || []).slice(oldTime.length).map((e): CardTimeEntry => ({ id: e.id, minutes: e.minutes, ...by }));
    const timeLog = [...oldTime, ...added];
    const spentMinutes = added.length ? (prev?.spentMinutes || 0) + timeLogMinutes(added) : step.spentMinutes;
    const waiting = step.status === 'BLOCKED' && step.waitingOnId ? users.get(step.waitingOnId) : undefined;
    const next: CardStep = {
      ...step,
      title: step.title?.trim() || undefined,
      note: step.note?.trim() || undefined,
      assigneeName: member?.fullName,
      stationId: member?.stationId || step.stationId || undefined,
      blockedReason: step.status === 'BLOCKED' ? step.blockedReason?.trim() : undefined,
      waitingOnId: waiting?.id,
      waitingOnName: waiting?.fullName,
      returnedReason: freshReturn ? step.returnedReason!.trim() : keepReturn ? prev!.returnedReason : undefined,
      returnedById: freshReturn ? actor.id : keepReturn ? prev!.returnedById : undefined,
      returnedByName: freshReturn ? actor.fullName : keepReturn ? prev!.returnedByName : undefined,
      returnedAt: freshReturn ? now : keepReturn ? prev!.returnedAt : undefined,
      timeLog: timeLog.length ? timeLog : undefined,
      spentMinutes: spentMinutes || undefined,
      // Work starts when the step first leaves the queue; a step set aside keeps what it had.
      startedAt: step.status === 'TODO' ? undefined : step.status === 'SKIPPED' ? prev?.startedAt : prev?.startedAt || now,
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
    if (step.assigneeId && step.assigneeId !== prev?.assigneeId) {
      const from = prev?.assigneeName && prev.assigneeId !== step.assigneeId ? ` بدلاً من ${prev.assigneeName}` : '';
      record(next, step.assigneeId === actor.id ? `استلم «${name}»${from}` : `أُسندت «${name}» إلى ${member?.fullName || 'زميل'}${from}`);
    } else if (!step.assigneeId && prev?.assigneeId) {
      record(next, `«${name}» لم تعد مسندة إلى ${prev.assigneeName || 'زميل'}${next.stationId ? '؛ متاحة لمحطتها' : ''}`);
    }
    if (freshReturn) {
      record(next, `أُعيدت «${name}» للعمل — ${next.returnedReason}`);
    } else if (prev ? prev.status !== step.status : step.status !== 'TODO') {
      const detail = step.status === 'BLOCKED' ? `${next.blockedReason}${waiting ? ` (بانتظار ${waiting.fullName})` : ''}` : step.status === 'DONE' ? next.note : '';
      record(next, `«${name}»: ${stepStatusName(step.status)}${detail ? ` — ${detail}` : ''}`);
    }
    if (added.length) record(next, `سُجّل وقت على «${name}»: ${timeLogMinutes(added)} د (المجموع ${spentMinutes} د)`);
    return next;
  });

  // Material added to the card: links and library items are recorded with who added them.
  const oldLinks = new Set((before?.links || []).map((l) => l.url));
  for (const link of after.links || []) if (!oldLinks.has(link.url)) log.push({ id: newId('log'), kind: 'STEP', text: `أُضيف رابط: ${link.label || link.url}`, ...by });
  const oldMedia = new Set(before?.mediaIds || []);
  for (const id of after.mediaIds || []) if (!oldMedia.has(id)) log.push({ id: newId('log'), kind: 'STEP', text: `أُرفق من المكتبة: ${options.mediaTitle?.(id) || 'ملف'}`, ...by });

  const owner = users.get(after.ownerId || before?.ownerId || '') || (before ? undefined : actor);
  const scriptChanged = (before?.script || '') !== (after.script || '');
  // Only a supervisor approves a script, and an approval never survives a change to the text by someone else.
  const approved = canManage ? !!after.scriptApproved : !!before?.scriptApproved && !scriptChanged;
  const freshApproval = approved && (!before?.scriptApproved || (canManage && scriptChanged));
  if (freshApproval) log.push({ id: newId('log'), kind: 'STEP', text: 'اعتُمد النص', ...by });
  else if (before?.scriptApproved && !approved) log.push({ id: newId('log'), kind: 'STEP', text: scriptChanged ? 'عُدّل النص المعتمد وسُحب اعتماده' : 'سُحب اعتماد النص', ...by });
  if (before && before.status !== after.status) log.push({ id: newId('log'), kind: 'STEP', text: after.status === 'CLOSED' ? 'أُغلق التكليف بعد الإنجاز' : after.status === 'CANCELLED' ? 'أُلغي التكليف' : 'أُعيد فتح التكليف', ...by });

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

/** A colleague as the notices need them: where they work, what they do, and what they may do on cards. */
export interface CardPerson {
  id: string;
  stationId?: string;
  role?: string;
  departmentId?: string;
  canManage: boolean;
  canWork: boolean;
}

export interface CardNoticeContext {
  people: CardPerson[];
  stations: Station[];
}

/** At most this many colleagues hear about a station-wide step or a blocker. */
const MAX_FANOUT = 20;

/**
 * Who should hear about this change:
 * - a newly assigned colleague, and the one the step was taken from;
 * - for a step addressed to a whole station, the colleagues there whose work it is (and its supervisors);
 * - the next person in the chain once everything before their step is done («وصلتك المادة»);
 * - on a blocker, the owner, whoever was named to fix it (else the previous step's holder) and the
 *   supervisors who follow that station;
 * - on rework, the holder of the step sent back and the owner;
 * - on a note, the owner and the current step's holder; on a decision, everyone on the card;
 * - the owner when someone else's edit withdrew the script approval.
 */
export function cardNotices(before: ProductionCard | null, after: ProductionCard, actorId: string, actorName: string, stepTypes: StepType[], ctx?: CardNoticeContext): CardNotice[] {
  if (after.status !== 'OPEN') return [];
  const notices: CardNotice[] = [];
  const urgent = after.priority === 'URGENT';
  const previous = new Map((before?.steps || []).map((s) => [s.id, s]));
  const decider = after.ownerId || after.createdById;
  const push = (userId: string | undefined, title: string, message: string, force = false) => {
    if (userId && userId !== actorId) notices.push({ userId, title, message, urgent: urgent || force });
  };
  const people = (ctx?.people || []).filter((p) => p.canWork || p.canManage);
  /** Colleagues of the step's station whose kind of work it is, supervisors of that station first. */
  const stationPeople = (step: CardStep) =>
    people
      .filter((p) => (!step.stationId || p.stationId === step.stationId) && (step.departmentId ? p.departmentId === step.departmentId || (p.canManage && !!step.stationId) : stepFitsActor(step.type, p)))
      .sort((a, b) => Number(b.canManage) - Number(a.canManage))
      .slice(0, MAX_FANOUT)
      .map((p) => p.id);
  /** Supervisors who follow the station where the step is done. */
  const followers = (step: CardStep) =>
    step.stationId && ctx
      ? people
          .filter((p) => p.canManage && stationScope(ctx.stations, p).has(step.stationId!))
          .slice(0, MAX_FANOUT)
          .map((p) => p.id)
      : [];
  const pushStep = (step: CardStep, title: string, message: string, force = false) => {
    if (step.assigneeId) push(step.assigneeId, title, message, force);
    else if (step.stationId || step.departmentId) stationPeople(step).forEach((id) => push(id, title, message, force));
  };
  const firstOpen = currentStep(after);

  after.steps.forEach((step, index) => {
    const prev = previous.get(step.id);
    const name = stepTypeName(stepTypes, step.type);
    if (step.assigneeId && step.assigneeId !== prev?.assigneeId) {
      push(step.assigneeId, `${urgent ? 'عاجل — ' : ''}مهمة لك في تكليف: ${name}`, after.title);
      if (prev?.assigneeId) push(prev.assigneeId, `سُحبت منك «${name}»`, `${after.title} — أُسندت إلى ${step.assigneeName || 'زميل'}`);
    } else if (!step.assigneeId && (step.stationId || step.departmentId) && isStepOpen(step) && (!prev || prev.assigneeId || prev.stationId !== step.stationId || prev.departmentId !== step.departmentId)) {
      if (prev?.assigneeId) push(prev.assigneeId, `سُحبت منك «${name}»`, `${after.title} — صارت متاحة لمحطتها`);
      stationPeople(step).forEach((id) => push(id, `${urgent ? 'عاجل — ' : ''}مهمة متاحة ل${step.departmentId ? 'قسمك' : 'محطتك'}: ${name}`, `${after.title} — استلمها من التكليفات`));
    }

    if (prev && prev.status !== step.status && step.status === 'BLOCKED') {
      const message = `${after.title} — ${name}: ${step.blockedReason || ''}`;
      // One notice each: the decision owner, whoever can unblock it (the colleague named by the
      // blocker, else the step before, e.g. footage not delivered), then the station's supervisors.
      const earlier = after.steps.slice(0, index).reverse().find((s) => s.status !== 'SKIPPED');
      const fixer = step.waitingOnId || earlier?.assigneeId;
      const told = new Set<string>();
      const tell = (userId: string | undefined, title: string) => {
        if (!userId || told.has(userId)) return;
        told.add(userId);
        push(userId, title, message, true);
      };
      tell(decider, 'تعطّل في تكليف يحتاج قرارك');
      tell(fixer, `مطلوب منك لحل تعطّل: ${name}`);
      followers(step).forEach((id) => tell(id, `تعطّل في محطة تتابعها: ${name}`));
    }

    const freshReturn = prev?.status === 'DONE' && isStepOpen(step) && !!step.returnedReason;
    if (freshReturn) {
      const message = `${after.title} — أعادها ${actorName}: ${step.returnedReason}`;
      pushStep(step, `أُعيدت إليك «${name}» للتعديل`, message, true);
      push(decider, `أُعيدت «${name}» إلى خطوة سابقة`, message);
    }

    if (step.status === 'DONE' && prev?.status !== 'DONE') {
      const handoff = `${after.title} — أنهى ${actorName} «${name}»${step.note ? `: ${step.note}` : ''}`;
      const next = after.steps.slice(index + 1).find(isStepOpen);
      if (!firstOpen) push(decider, 'تكليف جاهز', handoff);
      // The material reaches the next colleague only when nothing before their step is still open.
      else if (next && next.id === firstOpen.id) pushStep(next, `وصلتك المادة: ${stepTypeName(stepTypes, next.type)}`, handoff);
    }
  });

  // Notes: the owner and whoever holds the current step; a decision reaches everyone on the card.
  const known = new Set((before?.log || []).map((e) => e.id));
  for (const entry of (after.log || []).filter((e) => e.kind === 'NOTE' && !known.has(e.id))) {
    const text = `${after.title} — ${actorName}: ${entry.text}`;
    if (entry.decision) {
      const everyone = new Set<string>([decider, after.createdById, ...after.steps.map((s) => s.assigneeId)].filter(Boolean) as string[]);
      everyone.forEach((id) => push(id, 'قرار في تكليف', text, true));
    } else {
      push(decider, 'ملاحظة جديدة في تكليف', text);
      if (firstOpen) pushStep(firstOpen, 'ملاحظة جديدة في تكليف', text);
    }
  }

  if (before?.scriptApproved && !after.scriptApproved && (before.script || '') !== (after.script || '')) {
    push(after.ownerId, 'عُدّل نص معتمد وسُحب اعتماده', `${after.title} — عدّله ${actorName}؛ يحتاج اعتماداً جديداً`);
  }

  // One notice per person and title is enough.
  const seen = new Set<string>();
  return notices.filter((n) => !seen.has(`${n.userId}|${n.title}`) && seen.add(`${n.userId}|${n.title}`));
}
