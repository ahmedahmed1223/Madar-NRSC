import type { Booking, Resource } from './planning';
import type { DeptRequest, RequestType } from './production';
import type { Episode } from '../types';
import { fromLocalInputValue, localDateString } from './dates';

export function episodeStudioSlot(episode: Pick<Episode, 'recordingDate' | 'broadcastDate' | 'startTime' | 'durationMinutes'>, now = new Date()) {
  const recordedDay = (episode.recordingDate || episode.broadcastDate || '').slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(recordedDay) ? recordedDay : localDateString(now);
  const startTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(episode.startTime) ? episode.startTime : '09:00';
  const scheduled = Date.parse(fromLocalInputValue(`${day}T${startTime}`));
  const start = Number.isFinite(scheduled) ? scheduled : now.getTime();
  return {
    scheduledStart: new Date(start).toISOString(),
    from: new Date(start - 60 * 60_000).toISOString(),
    to: new Date(start + Math.max(episode.durationMinutes || 60, 30) * 60_000).toISOString(),
  };
}

export function episodeStudioBookings(episodeId: string, bookings: Booking[], resources: Resource[]): Booking[] {
  const studios = new Set(resources.filter(resource => resource.kind === 'STUDIO' && !resource.deletedAt).map(resource => resource.id));
  return bookings
    .filter(booking => !booking.deletedAt && booking.status !== 'CANCELLED' && booking.link?.kind === 'episode' && booking.link.id === episodeId && studios.has(booking.resourceId))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

const mediaRequestTypes = new Set<RequestType>(['MONTAGE', 'GRAPHICS', 'ARCHIVE']);
export const isMediaDeliveryRequest = (type: RequestType) => mediaRequestTypes.has(type);

function deadline(request: DeptRequest) {
  const date = Date.parse(request.dueAt || '');
  return Number.isFinite(date) ? date : Number.POSITIVE_INFINITY;
}

export function mediaDeliveryQueue(requests: DeptRequest[], departmentId: string, canManage: boolean, pendingIds?: ReadonlySet<string>): DeptRequest[] {
  return requests
    .filter(request => !request.deletedAt && isMediaDeliveryRequest(request.type) && (canManage || request.departmentId === departmentId) && (request.status === 'OPEN' || request.status === 'ACCEPTED' || pendingIds?.has(request.id)))
    .sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT') || deadline(a) - deadline(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
