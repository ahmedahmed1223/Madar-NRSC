import { describe, expect, it } from 'vitest';
import { cardChangeError, type CardActor, type CardContext, type CardStep, type ProductionCard } from '../../src/shared/productionCards';
import { stampCard } from '../../src/server/cards';

const chief: CardActor = { id: 'manager', canManage: true, canWork: true };
const reporter: CardActor = { id: 'reporter', canManage: false, canWork: true };
const planner: CardContext = { stations: [], stepTypes: [], users: new Map([[chief.id, {}], [reporter.id, {}]]) };
const step = (id: string, extra: Partial<CardStep> = {}): CardStep => ({ id, type: 'gather', status: 'TODO', complexity: 1, assigneeId: reporter.id, ...extra });
const card = (steps: CardStep[], extra: Partial<ProductionCard> = {}): ProductionCard => ({
  id: 'assignment', title: 'تغطية ميدانية', kind: 'REPORT', priority: 'URGENT', status: 'OPEN',
  ownerId: chief.id, steps, ...extra,
});
const begin = (record: ProductionCard, id: string): ProductionCard => ({
  ...record, steps: record.steps.map(item => item.id === id ? { ...item, status: 'IN_PROGRESS' } : item),
});

describe('assignment workflow execution rules', () => {
  it('allows parallel work and a partial delivery threshold, while blocking an unmet full delivery', () => {
    const assignment = card([
      step('reporting'),
      step('shooting', { dependencies: [] }),
      step('script', { dependencies: [{ stepId: 'reporting', threshold: 'PARTIAL' }] }),
      step('editing', { dependencies: [{ stepId: 'shooting', threshold: 'DONE' }] }),
    ]);
    expect(cardChangeError(assignment, begin(assignment, 'shooting'), reporter, planner)).toBeNull();
    expect(cardChangeError(assignment, begin(assignment, 'script'), reporter, planner)).toContain('التبعيات');
    const withReport = { ...assignment, log: [{ id: 'first-report', stepId: 'reporting', kind: 'NOTE' as const, text: 'الإفادة الأولى', delivery: 'PARTIAL' as const }] };
    expect(cardChangeError(withReport, begin(withReport, 'script'), reporter, planner)).toBeNull();
    expect(cardChangeError(withReport, begin(withReport, 'editing'), reporter, planner)).toContain('التبعيات');
  });

  it('rejects cyclic dependencies and skipping mandatory approval', () => {
    const graph = card([
      step('reporting', { dependencies: [{ stepId: 'review', threshold: 'DONE' }] }),
      step('review', { type: 'approve', dependencies: [{ stepId: 'reporting', threshold: 'DONE' }] }),
    ]);
    expect(cardChangeError(null, graph, chief, planner)).toContain('حلقة');
    const required = card([step('review', { type: 'approve', optional: false })]);
    expect(cardChangeError(required, { ...required, steps: [{ ...required.steps[0], status: 'SKIPPED', skippedReason: 'تجاوز' }] }, chief, planner)).toContain('إلزامية');
  });

  it('requires the named assignee to acknowledge and uses a server timestamp', () => {
    const assignment = card([step('reporting', { receiptMinutes: 30, receiptAssignedAt: '2026-11-27T12:00:00Z' })]);
    expect(cardChangeError(assignment, begin(assignment, 'reporting'), reporter, planner)).toContain('تأكيد الاستلام');
    const sent = { ...assignment, steps: [{ ...assignment.steps[0], receiptConfirmedAt: '2020-01-01T00:00:00Z' }] };
    expect(cardChangeError(assignment, sent, chief, planner)).toContain('تأكيد الاستلام');
    expect(cardChangeError(assignment, sent, reporter, planner)).toBeNull();
    const actor = { id: reporter.id, fullName: 'المراسل', isActive: true } as Parameters<typeof stampCard>[2];
    const stamped = stampCard(assignment, sent, actor, new Map([[actor.id, actor]]), [], false);
    expect(stamped.steps[0].receiptConfirmedAt).not.toBe(sent.steps[0].receiptConfirmedAt);
    expect(stamped.log?.some(entry => entry.text.includes('تأكد استلام'))).toBe(true);
  });

  it('preserves earlier deliveries when a card is cancelled with a reason', () => {
    const assignment = card([step('reporting')], { log: [{ id: 'delivery', kind: 'NOTE', delivery: 'PARTIAL', stepId: 'reporting', text: 'إفادة محفوظة' }] });
    expect(cardChangeError(assignment, { ...assignment, status: 'CANCELLED' }, chief, planner)).toContain('سبب الإلغاء');
    expect(cardChangeError(assignment, { ...assignment, status: 'CANCELLED', cancellationReason: 'تغيّر جدول البث' }, chief, planner)).toBeNull();
  });
});
