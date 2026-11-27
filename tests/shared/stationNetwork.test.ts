import { describe, expect, it } from 'vitest';
import { buildStationNetwork } from '../../src/shared/stationNetwork';

const stations = [
  { id: 'main', name: 'الرئيسية', isMain: true },
  { id: 'gaza', name: 'غزة' },
  { id: 'beirut', name: 'بيروت' },
];

describe('buildStationNetwork', () => {
  it('does not turn open cooperation into explicit edges', () => {
    const result = buildStationNetwork({
      stations: [{ id: 'gaza', name: 'غزة' }, { id: 'beirut', name: 'بيروت' }],
      users: [],
    });

    expect(result.edges).toEqual([]);
    expect(result.nodes.map(node => ({ id: node.id, open: node.open, scopeIds: node.scopeIds }))).toEqual([
      { id: 'gaza', open: true, scopeIds: ['beirut', 'gaza'] },
      { id: 'beirut', open: true, scopeIds: ['beirut', 'gaza'] },
    ]);
  });

  it('draws one asymmetric declared link and keeps its scope symmetric', () => {
    const result = buildStationNetwork({
      stations: [stations[0], { ...stations[1], linkedIds: ['beirut'] }, { ...stations[2], linkedIds: [] }],
      users: [],
    });

    expect(result.edges).toEqual([{ id: 'beirut:gaza', source: 'beirut', target: 'gaza' }]);
    expect(result.nodes.find(node => node.id === 'gaza')?.scopeIds).toEqual(['beirut', 'gaza', 'main']);
    expect(result.nodes.find(node => node.id === 'beirut')?.scopeIds).toEqual(['beirut', 'gaza', 'main']);
    expect(result.nodes.find(node => node.id === 'main')?.scopeIds).toEqual(['beirut', 'gaza', 'main']);
  });

  it('deduplicates a link declared by both stations', () => {
    const result = buildStationNetwork({
      stations: [{ ...stations[1], linkedIds: ['beirut'] }, { ...stations[2], linkedIds: ['gaza'] }],
      users: [],
    });

    expect(result.edges).toEqual([{ id: 'beirut:gaza', source: 'beirut', target: 'gaza' }]);
  });

  it('derives group membership and general managers without counting inactive colleagues', () => {
    const result = buildStationNetwork({
      stations,
      stationGroups: [{ id: 'north', name: 'منطقة الشمال', stationIds: ['gaza', 'beirut'] }],
      users: [
        { id: 'member', fullName: 'عضو نشط', stationId: 'gaza', isActive: true },
        { id: 'inactive', fullName: 'عضو مجمد', stationId: 'gaza', isActive: false },
        { id: 'deleted', fullName: 'عضو محذوف', stationId: 'beirut', deletedAt: '2026-01-01' },
        { id: 'manager', fullName: 'مدير المنطقة', managedGroupIds: ['north'], isActive: true },
      ],
    });

    expect(result.nodes.find(node => node.id === 'gaza')).toMatchObject({
      memberCount: 1,
      groupNames: ['منطقة الشمال'],
      managerNames: ['مدير المنطقة'],
    });
    expect(result.nodes.find(node => node.id === 'beirut')).toMatchObject({ memberCount: 0, managerNames: ['مدير المنطقة'] });
    expect(result.nodes.find(node => node.id === 'main')?.managerNames).toEqual(['مدير المنطقة']);
  });

  it('returns an empty graph for an organization without stations', () => {
    expect(buildStationNetwork({ stations: [], users: [] })).toEqual({ nodes: [], edges: [] });
  });
});
