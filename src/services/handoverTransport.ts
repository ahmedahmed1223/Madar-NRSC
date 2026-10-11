import { ApiError, apiFetch } from './http';
import type { HandoverDraftInput, HandoverRow } from '../shared/shiftHandovers';

export class HandoverUnknownOutcome extends Error {
  constructor() { super('لم يصل تأكيد الخادم؛ قد تكون العملية نُفذت. راجع النتيجة قبل إعادة المحاولة'); }
}
export async function handoverRequest<T>(url: string, init: RequestInit & { json?: unknown } = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try { return await apiFetch<T>(url, { ...init, signal: controller.signal }); }
  catch (error) { if (error instanceof ApiError) throw error; throw new HandoverUnknownOutcome(); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function matchingHandoverDraft(row: HandoverRow, draft: HandoverDraftInput): boolean {
  const keys: (keyof HandoverDraftInput)[] = ['id', 'schemaVersion', 'departmentId', 'sourceDate', 'sourceShift', 'recipientDate', 'recipientShift', 'title', 'note', 'supersedesId'];
  if (!keys.every(key => (row.d[key] ?? null) === (key === 'title' ? draft.title.trim() : draft[key] ?? null))) return false;
  if (row.d.references.some(ref => !ref.available)) return false;
  return JSON.stringify(row.d.references.map(ref => ref.available ? { collection: ref.collection, id: ref.id, note: ref.note } : null)) === JSON.stringify(draft.references);
}
