import { cardHoldReason, isStepOpen, stepTypeName, type ProductionCard, type StepType } from './productionCards';
import type { HandoverWorkSummary } from './shiftHandovers';

/** Project current work only after validating the viewer's access to the linked card. */
export function handoverWork(card: ProductionCard, types: StepType[]): HandoverWorkSummary {
  const open = card.status === 'OPEN';
  const allSteps = card.steps || [];
  const steps = open ? allSteps.filter(isStepOpen) : [];
  const deadlines = open ? [card.dueAt, card.airAt, ...steps.map(step => step.dueAt)]
    .filter((date): date is string => !!date && Number.isFinite(Date.parse(date)))
    .sort((a, b) => Date.parse(a) - Date.parse(b)) : [];
  const notes = [
    ...(card.log || []).filter(entry => entry.kind === 'NOTE').map(entry => ({ at: entry.at, text: entry.text })),
    ...allSteps.filter(step => step.note).map(step => ({ at: step.doneAt, text: step.note })),
  ].sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0));
  return { open, openSteps: steps.length, openWork: steps.map(step => [step.title || stepTypeName(types, step.type), step.assigneeName].filter(Boolean).join(' — ')),
    nearestDueAt: deadlines[0], latestUpdate: notes[0]?.text,
    decision: open ? cardHoldReason(card, types) || undefined : undefined };
}
