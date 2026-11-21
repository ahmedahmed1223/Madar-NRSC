import { stationWall } from './stationTime';

type ScheduledProgrammeEpisode = {
  id: string;
  programId: string;
  status: string;
  broadcastDate?: string;
  startTime?: string;
  deletedAt?: string | null;
};

const inactive = new Set(['CANCELLED', 'ARCHIVED', 'BROADCASTED', 'ON_AIR']);

export function nextProgrammeEpisodes<Episode extends ScheduledProgrammeEpisode>(episodes: readonly Episode[], now: number, stationZone?: string): Map<string, Episode> {
  const wall = stationWall(now, stationZone);
  const nowKey = `${wall.date}T${wall.clock}`;
  const next = new Map<string, { episode: Episode; slot: string }>();
  for (const episode of episodes) {
    if (episode.deletedAt || inactive.has(episode.status) || !episode.broadcastDate || !episode.startTime) continue;
    const date = new Date(`${episode.broadcastDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== episode.broadcastDate) continue;
    const clock = episode.startTime.padStart(5, '0');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) continue;
    const slot = `${episode.broadcastDate}T${clock}:00`;
    if (slot < nowKey) continue;
    const previous = next.get(episode.programId);
    if (!previous || slot < previous.slot || (slot === previous.slot && episode.id < previous.episode.id)) next.set(episode.programId, { episode, slot });
  }
  return new Map([...next].map(([programId, entry]) => [programId, entry.episode]));
}
