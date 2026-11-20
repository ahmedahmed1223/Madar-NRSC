import { describe, expect, it } from 'vitest';
import { assignmentReport, assignmentTotals, cardFinishedAt, reportCsvRows, stepAvailableAt, waitingByStepType, type ReportInput } from '../../src/shared/assignmentReports';
import { DEFAULT_STEP_TYPES, type ProductionCard } from '../../src/shared/productionCards';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const h = (hours: number) => new Date(NOW + hours * 3600_000).toISOString();

const cards: ProductionCard[] = [
  {
    // Finished on time, from the bulletin template.
    id: 'c1', title: 'نشرة الظهيرة', kind: 'BULLETIN', priority: 'NORMAL', status: 'CLOSED', templateId: 'wft-b', templateName: 'نشرة أخبار',
    createdAt: h(-10), dueAt: h(-2), closedAt: h(-3),
    steps: [
      { id: 'a', type: 'edit', status: 'DONE', complexity: 1, assigneeId: 'sara', stationId: 'gaza', startedAt: h(-9), doneAt: h(-8), dueAt: h(-7) },
      { id: 'b', type: 'montage', status: 'DONE', complexity: 1, assigneeId: 'samer', stationId: 'gaza', startedAt: h(-6), doneAt: h(-4), dueAt: h(-5) },
    ],
  },
  {
    // Open, blocked and late, from the same template.
    id: 'c2', title: 'نشرة المساء', kind: 'BULLETIN', priority: 'NORMAL', status: 'OPEN', templateId: 'wft-b', templateName: 'نشرة أخبار',
    createdAt: h(-5), dueAt: h(-1),
    steps: [
      { id: 'a', type: 'edit', status: 'DONE', complexity: 1, assigneeId: 'sara', stationId: 'gaza', startedAt: h(-5), doneAt: h(-4) },
      { id: 'b', type: 'montage', status: 'BLOCKED', blockedReason: 'لا لقطات', complexity: 1, assigneeId: 'samer', stationId: 'gaza', startedAt: h(-3), dueAt: h(-2) },
      { id: 'c', type: 'quality', status: 'TODO', complexity: 1, stationId: 'istanbul' },
    ],
  },
  {
    // Free assignment waiting for montage to start.
    id: 'c3', title: 'تقرير', kind: 'REPORT', priority: 'NORMAL', status: 'OPEN', createdAt: h(-4),
    steps: [
      { id: 'a', type: 'gather', status: 'DONE', complexity: 1, assigneeId: 'laila', stationId: 'gaza', startedAt: h(-4), doneAt: h(-3) },
      { id: 'b', type: 'montage', status: 'TODO', complexity: 1, departmentId: 'montage' },
    ],
  },
  { id: 'c4', title: 'ملغى', kind: 'NEWS', priority: 'NORMAL', status: 'CANCELLED', steps: [{ id: 'a', type: 'edit', status: 'TODO', complexity: 1 }] },
];

const input: ReportInput = {
  cards,
  stepTypes: DEFAULT_STEP_TYPES,
  stations: [{ id: 'gaza', name: 'غزة' }, { id: 'istanbul', name: 'إسطنبول' }],
  people: [
    { id: 'sara', name: 'سارة', departmentId: 'newsroom', stationId: 'gaza' },
    { id: 'samer', name: 'سامر', departmentId: 'montage', stationId: 'gaza' },
    { id: 'laila', name: 'ليلى', departmentId: 'field', stationId: 'gaza' },
  ],
  period: { from: NOW - 24 * 3600_000, to: NOW },
  now: NOW,
};

describe('assignment reports', () => {
  it('knows when an assignment finished and when a step could start', () => {
    expect(cardFinishedAt(cards[0])).toBe(h(-3));
    expect(cardFinishedAt(cards[1])).toBeUndefined();
    expect(stepAvailableAt(cards[0], cards[0].steps[1])).toBe(h(-8));
    expect(stepAvailableAt(cards[1], cards[1].steps[2])).toBeUndefined();
  });

  it('groups assignments by template with cycle time and on-time rate', () => {
    const rows = assignmentReport(input, 'template');
    const bulletin = rows.find((r) => r.key === 'wft-b')!;
    expect(bulletin).toMatchObject({ label: 'نشرة أخبار', open: 1, late: 1, blocked: 1, done: 1, avgCycleMinutes: 420, onTimeRate: 1 });
    expect(rows.find((r) => r.key === '')).toMatchObject({ label: 'بدون قالب', open: 1, done: 0 });
    // Cancelled assignments are left out.
    expect(rows.reduce((n, r) => n + r.open + r.done, 0)).toBe(3);
  });

  it('groups steps by person, department and station', () => {
    const byPerson = assignmentReport(input, 'person');
    expect(byPerson.find((r) => r.key === 'samer')).toMatchObject({ open: 1, blocked: 1, late: 1, done: 1, avgCycleMinutes: 120, onTimeRate: 0 });
    expect(byPerson.find((r) => r.key === 'sara')).toMatchObject({ open: 0, done: 2, avgCycleMinutes: 60, onTimeRate: 1 });
    const byDept = assignmentReport(input, 'department');
    expect(byDept.find((r) => r.key === 'montage')).toMatchObject({ open: 2, done: 1 });
    const byStation = assignmentReport(input, 'station');
    expect(byStation.find((r) => r.key === 'istanbul')).toMatchObject({ label: 'إسطنبول', open: 1 });
  });

  it('totals the period and shows where steps wait longest', () => {
    expect(assignmentTotals(input)).toMatchObject({ open: 2, done: 1, late: 1, blocked: 1, avgCycleMinutes: 420, onTimeRate: 1 });
    const waits = waitingByStepType(input);
    const montage = waits.find((w) => w.type === 'montage')!;
    // c1 waited 2h before montage started, c2 1h; c3 has been waiting 3h now.
    expect(montage).toMatchObject({ label: 'المونتاج', avgWaitMinutes: 90, waitingNow: 1, longestWaitMinutes: 180 });
    expect(waits[0].type).toBe('montage');
  });

  it('exports rows for a spreadsheet', () => {
    const rows = reportCsvRows(assignmentReport(input, 'template'), 'template');
    expect(rows[0][0]).toBe('القالب');
    expect(rows[1]).toEqual(['نشرة أخبار', 1, 1, 1, 1, 420, '100%']);
  });
});
