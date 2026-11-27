import dagre from '@dagrejs/dagre';

export interface FlowchartLayoutNode {
  id: string;
  width?: number;
  height?: number;
}

export interface FlowchartLayoutEdge {
  source: string;
  target: string;
}

export interface FlowchartLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutFlowchart(input: {
  nodes: readonly FlowchartLayoutNode[];
  edges: readonly FlowchartLayoutEdge[];
  direction?: 'LR' | 'RL' | 'TB' | 'BT';
}): Record<string, FlowchartLayoutBox> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: input.direction || 'RL', nodesep: 56, ranksep: 88, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of input.nodes) {
    graph.setNode(node.id, { width: node.width || 200, height: node.height || 110 });
  }
  for (const edge of input.edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return Object.fromEntries(input.nodes.map(node => {
    const positioned = graph.node(node.id);
    const width = node.width || 200;
    const height = node.height || 110;
    return [node.id, { x: positioned.x - width / 2, y: positioned.y - height / 2, width, height }];
  }));
}
