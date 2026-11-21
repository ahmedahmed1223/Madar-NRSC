import { expect, it } from 'vitest';
import { cardExecutionTiming } from '../../src/shared/cardExecutionTiming';
import type { CardLogEntry, CardStep, ProductionCard } from '../../src/shared/productionCards';

const date = (time: string) => `2026-11-21T${time}:00.000Z`;
const step = (id: string, extra: Partial<CardStep> = {}): CardStep => ({ id, type: 'edit', status: 'DONE', complexity: 1, ...extra });
const transition = (stepId: string, time: string, fromStatus: CardStep['status'], toStatus: CardStep['status']): CardLogEntry => ({
  id: `${stepId}-${time}`, stepId, at: date(time), kind: 'STEP', text: '', fromStatus, toStatus,
});
const card = (steps: CardStep[], extra: Partial<ProductionCard> = {}): ProductionCard => ({
  id: 'card', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', title: 'Card', createdAt: date('09:00'), steps, ...extra,
});

it('shows recorded labor, elapsed execution and the union of initial wait and overlapping blocked intervals', () => {
  const assignment = card([
    step('edit', { startedAt: date('09:10'), doneAt: date('10:00'), timeLog: [{ id: 'entry-a', minutes: 14 }, { id: 'entry-b', minutes: 9 }] }),
    step('audio', { startedAt: date('09:15'), doneAt: date('09:55'), spentMinutes: 11 }),
  ], { log: [transition('edit', '09:20', 'IN_PROGRESS', 'BLOCKED'), transition('audio', '09:30', 'TODO', 'BLOCKED'), transition('edit', '09:40', 'BLOCKED', 'IN_PROGRESS'), transition('audio', '09:42', 'BLOCKED', 'IN_PROGRESS')] });
  expect(cardExecutionTiming(assignment, Date.parse(date('11:00')))).toMatchObject({ laborMinutes: 34, elapsedMinutes: 50, waitingMinutes: 32 });
});

it('retains the first start and all labor sessions through rework without freezing execution at an earlier completion', () => {
  const assignment = card([
    step('edit', { status: 'IN_PROGRESS', startedAt: date('09:10'), timeLog: [{ id: 'initial', minutes: 13 }, { id: 'rework', minutes: 5 }] }),
  ], { log: [transition('edit', '09:10', 'TODO', 'IN_PROGRESS'), transition('edit', '09:25', 'IN_PROGRESS', 'DONE'), transition('edit', '09:40', 'DONE', 'IN_PROGRESS')] });
  expect(cardExecutionTiming(assignment, Date.parse(date('10:00')))).toMatchObject({ laborMinutes: 18, elapsedMinutes: 50, waitingMinutes: 10 });
});

it('avoids fabricating elapsed time for historical records with no start timestamp', () => {
  const historical = card([step('legacy', { spentMinutes: 35, startedAt: date('10:00'), doneAt: date('10:00') })], { status: 'CLOSED', closedAt: date('10:15') });
  expect(cardExecutionTiming(historical, Date.parse(date('11:00')))).toMatchObject({ laborMinutes: 35, elapsedMinutes: null, waitingMinutes: null });
  const waiting = card([step('pending', { status: 'TODO' })]);
  expect(cardExecutionTiming(waiting, Date.parse(date('09:19')))).toMatchObject({ laborMinutes: null, elapsedMinutes: null, waitingMinutes: 19 });
});

it('measures waiting before the first start even after an initial TODO assignment is blocked', () => {
  const assignment = card([step('initial', { status: 'BLOCKED' })], { log: [
    { id: 'new', kind: 'STEP', stepId: 'initial', toStatus: 'TODO', at: date('09:00'), text: 'Added' },
    { id: 'assign', kind: 'STEP', stepId: 'initial', at: date('09:01'), text: 'Assigned' },
    transition('initial', '09:05', 'TODO', 'BLOCKED'),
  ] });
  expect(cardExecutionTiming(assignment, Date.parse(date('09:19')))).toMatchObject({ laborMinutes: null, elapsedMinutes: null, waitingMinutes: 19 });
});
