import type { TrashItem, TrashPage, TrashScreen } from '../shared/trash';
import { apiFetch } from './http';

export async function listTrash(section: TrashScreen, cursor: string | null, signal: AbortSignal): Promise<TrashPage> {
  const query = new URLSearchParams({ section });
  if (cursor) query.set('cursor', cursor);
  const response = await apiFetch<{ data: TrashPage }>(`/api/v1/trash?${query}`, { signal });
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
