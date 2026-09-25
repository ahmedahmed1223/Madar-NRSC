export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered by the app shell so any 401 returns the user to the login screen. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

/**
 * fetch wrapper for the NRCS API: sends the CSRF header, parses JSON errors into
 * ApiError and signals session expiry.
 */
export async function apiFetch<T = any>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-NRCS-Client', 'web');
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body, credentials: 'same-origin' });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !url.endsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, payload?.error || `HTTP ${res.status}`, payload?.code);
  }
  return payload as T;
}
