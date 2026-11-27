import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_TYPES } from '../../src/shared/productionCards';
import { buildCardWorkflowGraph, buildTaskStatusGraph, buildTemplateWorkflowGraph } from '../../src/shared/workflowGraph';

const card = {
  id: 'card-1', title: 'تقرير ميداني', kind: 'REPORT' as const, priority: 'NORMAL' as const,
  status: 'OPEN' as const, log: [],
  steps: [
    { id: 'done', type: 'gather', status: 'DONE' as const, complexity: 1 as const, assigneeName: 'المراسل' },
    { id: 'blocked', type: 'edit', status: 'BLOCKED' as const, complexity: 2 as const, assigneeName: 'المحرر', blockedReason: 'نقص المادة', dueAt: '2026-01-01T00:00:00.000Z' },
    { id: 'next', type: 'approve', status: 'TODO' as const, complexity: 1 as const },
  ],
};

describe('workflow graph builders', () => {
  it('uses review and reopening rules to shape manager and staff transitions', () => {
    const manager = buildTaskStatusGraph({ requireReview: true, reopenManagersOnly: true }, true);
    const staff = buildTaskStatusGraph({ requireReview: true, reopenManagersOnly: true }, false);
    const managerEdges = manager.edges.map(edge => edge.id);
    const staffEdges = staff.edges.map(edge => edge.id);

    expect(managerEdges).toContain('IN_REVIEW:COMPLETED');
    expect(managerEdges).toContain('COMPLETED:TODO');
    expect(managerEdges).toContain('TODO:CANCELLED');
    expect(managerEdges).not.toContain('TODO:COMPLETED');
    expect(managerEdges).not.toContain('IN_PROGRESS:COMPLETED');
    expect(staffEdges).not.toContain('COMPLETED:TODO');
    expect(staffEdges).not.toContain('TODO:CANCELLED');
  });

  it('represents a template as an ordered start-to-end sequence', () => {
    const graph = buildTemplateWorkflowGraph({
      id: 'template', name: 'تقرير', kind: 'REPORT', priority: 'NORMAL',
      steps: [
        { id: 'a', type: 'gather', rule: { kind: 'ASK' }, complexity: 1 },
        { id: 'b', type: 'edit', title: 'كتابة النص', rule: { kind: 'DEPARTMENT', departmentId: 'newsroom' }, complexity: 2 },
      ],
    }, DEFAULT_STEP_TYPES);

    expect(graph.nodes.map(node => node.id)).toEqual(['start', 'step:a', 'step:b', 'end']);
    expect(graph.edges.map(edge => edge.id)).toEqual(['start:step:a', 'step:a:step:b', 'step:b:end']);
    expect(graph.nodes[2]).toMatchObject({ label: 'التحرير', description: 'كتابة النص' });
  });

  it('shows live assignment status, ownership and the current blocked step', () => {
    const graph = buildCardWorkflowGraph(card, DEFAULT_STEP_TYPES, Date.parse('2026-02-01T00:00:00.000Z'));
    const blocked = graph.nodes.find(node => node.id === 'step:blocked');

    expect(blocked).toMatchObject({ tone: 'blocked', label: 'التحرير' });
    expect(blocked?.meta).toContain('المحرر');
    expect(blocked?.meta).toContain('متعطلة');
    expect(graph.nodes.find(node => node.id === 'step:done')?.tone).toBe('done');
    expect(graph.edges.map(edge => edge.id)).toEqual(['start:step:done', 'step:done:step:blocked', 'step:blocked:step:next', 'step:next:end']);
  });

  it('marks an overdue open step and handles an empty assignment', () => {
    const late = buildCardWorkflowGraph({ ...card, steps: [{ id: 'late', type: 'edit', status: 'TODO', complexity: 1, dueAt: '2026-01-01' }] }, DEFAULT_STEP_TYPES, Date.parse('2026-02-01'));
    const empty = buildCardWorkflowGraph({ ...card, steps: [] }, DEFAULT_STEP_TYPES);

    expect(late.nodes.find(node => node.id === 'step:late')?.tone).toBe('late');
    expect(empty.nodes.map(node => node.id)).toEqual(['start', 'end']);
    expect(empty.edges).toEqual([{ id: 'start:end', source: 'start', target: 'end', kind: 'forward' }]);
  });
});
