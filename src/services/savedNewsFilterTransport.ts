import { ApiError, apiFetch } from './http';

export class SavedFilterUnknownOutcome extends Error {
  constructor() { super('لم يصل تأكيد الخادم؛ قد تكون العملية نُفذت. سنراجع النسخة الحالية قبل إعادة المحاولة'); }
}

/** Aborting a request ends waiting, not a transaction already accepted by the server. */
export async function savedFilterRequest<T>(url: string, init: RequestInit & { json?: unknown } = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try {
    return await apiFetch<T>(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new SavedFilterUnknownOutcome();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
