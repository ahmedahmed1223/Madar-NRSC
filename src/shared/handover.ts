/**
 * Shift handover brief, written by the platform from what the cards already record:
 * what was finished during the shift, what is in progress, what is stuck (with the reason and
 * who decides), and what falls due next. The outgoing shift reviews it; nothing is invented.
 */
import { cardHoldReason, cardState, currentStep, isStepLate, stepTypeName, type ProductionCard, type StepType } from './productionCards';

export interface HandoverLine {
  cardId: string;
  title: string;
  detail: string;
  urgent: boolean;
}

export interface HandoverBrief {
  from: number;
  to: number;
  stationId: string | null;
  finished: HandoverLine[];
  inProgress: HandoverLine[];
  stuck: HandoverLine[];
  dueNext: HandoverLine[];
  notes: HandoverLine[];
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
}

const between = (iso: string | undefined, from: number, to: number) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from && t <= to;
};

export function buildHandover(cards: ProductionCard[], options: HandoverOptions): HandoverBrief {
  const { stationId, from, now, stepTypes, time } = options;
  const ahead = now + (options.aheadHours ?? 8) * 3600_000;
  const brief: HandoverBrief = { from, to: now, stationId, finished: [], inProgress: [], stuck: [], dueNext: [], notes: [] };
  const mine = (id?: string) => stationId === null || id === stationId;
  const who = (name?: string) => name || 'غير مسندة';

  for (const card of cards) {
    if (card.deletedAt || card.status === 'CANCELLED') continue;
    const urgent = card.priority === 'URGENT';
    const line = (detail: string): HandoverLine => ({ cardId: card.id, title: card.title, detail, urgent });

    for (const step of card.steps || []) {
      if (!mine(step.stationId)) continue;
      const name = stepTypeName(stepTypes, step.type);
      if (step.status === 'DONE' && between(step.doneAt, from, now)) {
        brief.finished.push(line(`${name} — ${who(step.doneByName || step.assigneeName)}${step.note ? `: ${step.note}` : ''}`));
      }
      if (card.status !== 'OPEN') continue;
      if (step.status === 'IN_PROGRESS') brief.inProgress.push(line(`${name} — ${who(step.assigneeName)}${step.dueAt ? `، التسليم ${time(step.dueAt)}` : ''}${step.note ? `: ${step.note}` : ''}`));
      if (step.status === 'BLOCKED') brief.stuck.push(line(`${name} — ${who(step.assigneeName)}: ${step.blockedReason || ''}${card.ownerName ? ` (القرار عند ${card.ownerName})` : ''}`));
      else if (isStepLate(step, now)) brief.stuck.push(line(`${name} متأخرة — ${who(step.assigneeName)}، كان التسليم ${time(step.dueAt!)}`));
      else if ((step.status === 'TODO' || step.status === 'IN_PROGRESS') && between(step.dueAt, now, ahead)) brief.dueNext.push(line(`${name} — ${who(step.assigneeName)}، التسليم ${time(step.dueAt!)}`));
    }

    if (card.status !== 'OPEN') continue;
    const waiting = currentStep(card);
    const involved = stationId === null || (card.steps || []).some((s) => s.stationId === stationId) || card.ownerStationId === stationId;
    if (involved && between(card.airAt, now, ahead)) {
      const state = cardState(card, now);
      const reason = cardHoldReason(card, stepTypes, now);
      brief.dueNext.push(line(`البث ${time(card.airAt!)} — ${state === 'READY' ? 'جاهزة' : `بانتظار ${waiting ? stepTypeName(stepTypes, waiting.type) : 'الإغلاق'}`}${reason ? ` (${reason})` : ''}`));
    }
    for (const entry of card.log || []) {
      if (entry.kind === 'NOTE' && mine(entry.stationId) && between(entry.at, from, now)) brief.notes.push(line(`${entry.byName || ''}: ${entry.text}`));
    }
  }
  const urgentFirst = (a: HandoverLine, b: HandoverLine) => Number(b.urgent) - Number(a.urgent);
  brief.finished.sort(urgentFirst);
  brief.inProgress.sort(urgentFirst);
  brief.stuck.sort(urgentFirst);
  brief.dueNext.sort(urgentFirst);
  return brief;
}

export const HANDOVER_SECTIONS: { key: keyof Pick<HandoverBrief, 'stuck' | 'dueNext' | 'inProgress' | 'finished' | 'notes'>; title: string; empty: string }[] = [
  { key: 'stuck', title: 'متعطل أو متأخر — يحتاج قراراً', empty: 'لا شيء متعطل.' },
  { key: 'dueNext', title: 'مستحق في المناوبة القادمة', empty: 'لا مواعيد قريبة.' },
  { key: 'inProgress', title: 'قيد التنفيذ', empty: 'لا مهام قيد التنفيذ.' },
  { key: 'finished', title: 'أُنجز خلال المناوبة', empty: 'لم يُسجَّل إنجاز في هذه المناوبة.' },
  { key: 'notes', title: 'ملاحظات الزملاء', empty: 'لا ملاحظات.' },
];

/** Plain text for pasting into a message or e-mail. */
export function handoverText(brief: HandoverBrief, heading: string): string {
  const lines = [heading, ''];
  for (const section of HANDOVER_SECTIONS) {
    const rows = brief[section.key];
    lines.push(`■ ${section.title} (${rows.length})`);
    if (!rows.length) lines.push(`  ${section.empty}`);
    rows.forEach((row) => lines.push(`  • ${row.urgent ? '[عاجل] ' : ''}${row.title} — ${row.detail}`));
    lines.push('');
  }
  return lines.join('\n').trim();
}
