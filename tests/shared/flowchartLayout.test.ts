import { describe, expect, it } from 'vitest';
import { layoutFlowchart } from '../../src/shared/flowchartLayout';

describe('layoutFlowchart', () => {
  it('uses Dagre to lay a directed sequence from right to left without overlap', () => {
    const result = layoutFlowchart({
      nodes: [{ id: 'start' }, { id: 'work' }, { id: 'end' }],
      edges: [{ source: 'start', target: 'work' }, { source: 'work', target: 'end' }],
      direction: 'RL',
    });

    expect(result.start.x).toBeGreaterThan(result.work.x);
    expect(result.work.x).toBeGreaterThan(result.end.x);
    expect(result.start.y).toBe(result.work.y);
    expect(result.work.y).toBe(result.end.y);
    expect(result.start.x - result.work.x).toBeGreaterThanOrEqual(200);
  });

  it('returns finite deterministic coordinates for disconnected nodes', () => {
    const input = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [], direction: 'RL' as const };
    const first = layoutFlowchart(input);
    const second = layoutFlowchart(input);

    expect(first).toEqual(second);
    for (const node of Object.values(first)) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});
