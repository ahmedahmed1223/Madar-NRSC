import type { TrashCollection, TrashItem, TrashPage } from '../shared/trash';
import { apiFetch } from './http';

export async function listTrash(collection: TrashCollection | '', cursor: string | null, signal: AbortSignal): Promise<TrashPage> {
  const query = new URLSearchParams();
  if (collection) query.set('collection', collection);
  if (cursor) query.set('cursor', cursor);
  const search = query.toString();
  const response = await apiFetch<{ data: TrashPage }>(`/api/v1/trash${search ? `?${search}` : ''}`, { signal });
  return response.data;
}

export async function restoreTrashItem(item: TrashItem): Promise<void> {
  const response = await apiFetch<{ success: boolean }>(`/api/v1/trash/${item.collection}/${encodeURIComponent(item.id)}/restore`, {
    method: 'POST',
    json: { baseV: item.version },
    signal: AbortSignal.timeout(15_000),
  });
  if (response?.success !== true) throw new Error('لم يؤكد الخادم استعادة السجل. حدّث السلة وحاول مرة أخرى.');
}
