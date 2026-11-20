import type { Booking, Resource } from './planning';
import type { DeptRequest, RequestType } from './production';

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
