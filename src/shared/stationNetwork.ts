import { stationGroupsOf, stationScope, stationsOf, type Station, type StationGroup } from './stations';

export interface StationNetworkUser {
  id: string;
  fullName: string;
  stationId?: string | null;
  managedStationIds?: string[];
  managedGroupIds?: string[];
  isActive?: boolean;
  deletedAt?: string | null;
}

export interface StationNetworkInput {
  stations?: Station[];
  stationGroups?: StationGroup[];
  users: readonly StationNetworkUser[];
}

export interface StationNetworkNode {
  id: string;
  name: string;
  isMain: boolean;
  open: boolean;
  memberCount: number;
  groupNames: string[];
  managerNames: string[];
  scopeIds: string[];
}

export interface StationNetworkEdge {
  id: string;
  source: string;
  target: string;
}

export interface StationNetwork {
  nodes: StationNetworkNode[];
  edges: StationNetworkEdge[];
}

export function buildStationNetwork(input: StationNetworkInput): StationNetwork {
  const stations = stationsOf({ stations: input.stations });
  const groups = stationGroupsOf({ stationGroups: input.stationGroups });
  const activeUsers = input.users.filter(user => user.isActive !== false && !user.deletedAt);
  const managers = activeUsers.filter(user => user.managedStationIds?.length || user.managedGroupIds?.length);
  const nodes = stations.map(station => ({
    id: station.id,
    name: station.name,
    isMain: !!station.isMain,
    open: station.linkedIds === undefined,
    memberCount: activeUsers.filter(user => user.stationId === station.id).length,
    groupNames: groups.filter(group => group.stationIds.includes(station.id)).map(group => group.name),
    managerNames: managers.filter(user => stationScope(stations, user, groups).has(station.id)).map(user => user.fullName),
    scopeIds: [...stationScope(stations, station.id, groups)].sort(),
  }));
  const edges: StationNetworkEdge[] = [];
  for (let index = 0; index < stations.length; index += 1) {
    const source = stations[index];
    if (source.isMain) continue;
    for (const target of stations.slice(index + 1)) {
      if (target.isMain) continue;
      if (!source.linkedIds?.includes(target.id) && !target.linkedIds?.includes(source.id)) continue;
      const [first, second] = [source.id, target.id].sort();
      edges.push({ id: `${first}:${second}`, source: first, target: second });
    }
  }
  return { nodes, edges: edges.sort((a, b) => a.id.localeCompare(b.id)) };
}
