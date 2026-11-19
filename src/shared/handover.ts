/**
 * Shift handover brief, written by the platform from what the cards already record:
 * what is stuck (with the reason and who decides), what falls due next, what is in progress and
 * what was finished during the shift. Each card appears once, in its most pressing section, with
 * the step it waits on now; what was finished on it during the shift and colleagues' notes ride
 * along on the same row. The outgoing shift adds its own notes before sending it on.
 */
import { countLabel, AR } from './arabicPlural';
import { departmentName } from './departments';
import { cardHoldReason, cardState, currentStep, isStepOwnLate, isStepOpen, stepTypeName, type CardStep, type ProductionCard, type StepType } from './productionCards';

export type HandoverSectionKey = 'stuck' | 'dueNext' | 'inProgress' | 'finished';

export interface HandoverLine {
  cardId: string;
  title: string;
  /** The step the card waits on now, who has it and when it is due (or why it is stuck). */
  detail: string;
  urgent: boolean;
  /** Steps finished on this card during the shift, e.g. «التحقق — محرر بيروت». */
  doneInShift: string[];
  /** Colleagues' notes on the card during the shift. */
  notes: string[];
}

export interface HandoverBrief {
  from: number;
  to: number;
  stationId: string | null;
  aheadHours: number;
  stuck: HandoverLine[];
  dueNext: HandoverLine[];
  inProgress: HandoverLine[];
  finished: HandoverLine[];
}

export interface HandoverOptions {
  /** Only work of this station; null for all stations. */
  stationId: string | null;
  /** Start of the outgoing shift. */
  from: number;
  now: number;
  /** How far ahead "due next" looks, in hours. */
  aheadHours?: number;
  stepTypes: StepType[];
  time: (iso: string) => string;
  /** Station names, so a step addressed to a whole station reads «محطة غزة — لم تُستلم». */
  stationName?: (id: string) => string;
}

const between = (iso: string | undefined, from: number, to: number) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from && t <= to;
};

/** Who holds a step: its assignee, else the station it was addressed to, else nobody yet. */
export function stepHolder(step: Pick<CardStep, 'assigneeName' | 'assigneeId' | 'stationId' | 'departmentId'>, stationName?: (id: string) => string): string {
  if (step.assigneeName) return step.assigneeName;
  const department = step.departmentId ? `قسم ${departmentName(step.departmentId)}` : '';
  if (step.stationId && stationName) return `${department ? `${department} في ` : ''}محطة ${stationName(step.stationId)} — لم تُستلم`;
  if (department) return `${department} — لم تُستلم`;
  return 'غير مسندة';
}

export function buildHandover(cards: ProductionCard[], options: HandoverOptions): HandoverBrief {
  const { stationId, from, now, stepTypes, time, stationName } = options;
  const aheadHours = options.aheadHours ?? 8;
  const ahead = now + aheadHours * 3600_000;
  const brief: HandoverBrief = { from, to: now, stationId, aheadHours, stuck: [], dueNext: [], inProgress: [], finished: [] };
  const mine = (id?: string) => stationId === null || id === stationId;
  const who = (step: CardStep) => stepHolder(step, stationName);
  const name = (step: CardStep) => stepTypeName(stepTypes, step.type);

  for (const card of cards) {
    if (card.deletedAt || card.status === 'CANCELLED') continue;
    const steps = card.steps || [];
    const ours = steps.filter((s) => mine(s.stationId));
    const involved = stationId === null || ours.length > 0 || card.ownerStationId === stationId;
    if (!involved) continue;

    const doneInShift = ours
      .filter((s) => s.status === 'DONE' && between(s.doneAt, from, now))
      .map((s) => `${name(s)} — ${s.doneByName || s.assigneeName || 'غير مسندة'}${s.note ? `: ${s.note}` : ''}`);
    const notes = (card.log || [])
      .filter((e) => e.kind === 'NOTE' && mine(e.stationId) && between(e.at, from, now))
      .map((e) => `${e.byName || ''}: ${e.text}`);
    const row = (detail: string): HandoverLine => ({ cardId: card.id, title: card.title, detail, urgent: card.priority === 'URGENT', doneInShift, notes });

    if (card.status !== 'OPEN') {
      if (doneInShift.length || notes.length) brief.finished.push(row(card.status === 'CLOSED' ? 'أُغلقت البطاقة' : 'أُنجزت'));
      continue;
    }

    const waiting = currentStep(card);
    const waitingText = waiting
      ? `بانتظار ${name(waiting)} — ${who(waiting)}${waiting.dueAt ? `، التسليم ${time(waiting.dueAt)}` : ''}`
      : cardState(card, now) === 'READY'
        ? 'جاهزة، بانتظار الإغلاق بعد البث'
        : 'بلا مهام مفتوحة';
    const air = card.airAt && between(card.airAt, now, ahead) ? `البث ${time(card.airAt)} — ` : '';

    // Stuck: one of our steps is blocked or past its time.
    const blocked = ours.find((s) => s.status === 'BLOCKED');
    const late = ours.find((s) => isStepOwnLate(card, s, now));
    if (blocked) {
      brief.stuck.push(row(`${air}${name(blocked)} متعطلة — ${who(blocked)}: ${blocked.blockedReason || 'بدون سبب مكتوب'}${card.ownerName ? ` (القرار عند ${card.ownerName})` : ''}`));
      continue;
    }
    if (late) {
      brief.stuck.push(row(`${air}${name(late)} متأخرة — ${who(late)}، كان التسليم ${time(late.dueAt!)}${card.ownerName ? ` (القرار عند ${card.ownerName})` : ''}`));
      continue;
    }

    // Due next: the card airs within the look-ahead, or one of our open steps falls due in it.
    const dueStep = ours.find((s) => isStepOpen(s) && s.status !== 'BLOCKED' && between(s.dueAt, now, ahead));
    if (air || dueStep) {
      const reason = air && cardState(card, now) !== 'READY' ? cardHoldReason(card, stepTypes, now) : '';
      const target = dueStep && dueStep !== waiting ? `${name(dueStep)} — ${who(dueStep)}، التسليم ${time(dueStep.dueAt!)}` : waitingText;
      brief.dueNext.push(row(`${air}${target}${reason ? ` (${reason})` : ''}`));
      continue;
    }

    // In progress: someone is on one of our steps, or work moved on the card during the shift.
    const running = ours.find((s) => s.status === 'IN_PROGRESS');
    if (running) {
      brief.inProgress.push(row(`${name(running)} — ${who(running)}${running.dueAt ? `، التسليم ${time(running.dueAt)}` : ''}${running.note ? `: ${running.note}` : ''}`));
      continue;
    }
    if (doneInShift.length || notes.length) brief.inProgress.push(row(waitingText));
  }

  const urgentFirst = (a: HandoverLine, b: HandoverLine) => Number(b.urgent) - Number(a.urgent);
  brief.stuck.sort(urgentFirst);
  brief.dueNext.sort(urgentFirst);
  brief.inProgress.sort(urgentFirst);
  brief.finished.sort(urgentFirst);
  return brief;
}

export interface HandoverSection {
  key: HandoverSectionKey;
  title: string;
  empty: string;
}

/** Section titles; "due next" says how far it looks ahead. */
export function handoverSections(aheadHours = 8): HandoverSection[] {
  return [
    { key: 'stuck', title: 'متعطل أو متأخر — يحتاج قراراً', empty: 'لا شيء متعطل.' },
    { key: 'dueNext', title: `مستحق خلال ${countLabel(aheadHours, AR.hour)} القادمة`, empty: 'لا مواعيد قريبة.' },
    { key: 'inProgress', title: 'قيد التنفيذ', empty: 'لا مهام قيد التنفيذ.' },
    { key: 'finished', title: 'أُنجز خلال المناوبة', empty: 'لم يُسجَّل إنجاز في هذه المناوبة.' },
  ];
}

export const HANDOVER_SECTIONS: HandoverSection[] = handoverSections(8);

/** Plain text for pasting into a message or e-mail; the outgoing manager's notes come first. */
export function handoverText(brief: HandoverBrief, heading: string, managerNotes = ''): string {
  const lines = [heading, ''];
  if (managerNotes.trim()) {
    lines.push('■ ملاحظات مسؤول المناوبة', ...managerNotes.trim().split('\n').map((l) => `  ${l}`), '');
  }
  for (const section of handoverSections(brief.aheadHours)) {
    const rows = brief[section.key];
    lines.push(`■ ${section.title} (${rows.length})`);
    if (!rows.length) lines.push(`  ${section.empty}`);
    for (const row of rows) {
      lines.push(`  • ${row.urgent ? '[عاجل] ' : ''}${row.title} — ${row.detail}`);
      if (row.doneInShift.length) lines.push(`    أُنجز في المناوبة: ${row.doneInShift.join('؛ ')}`);
      row.notes.forEach((note) => lines.push(`    ملاحظة: ${note}`));
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
