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

let onPasswordChangeRequired: (() => void) | null = null;
/** Registered by the app shell: the server refuses work (403 PASSWORD_CHANGE_REQUIRED) until a temporary password is replaced. */
export function setPasswordChangeHandler(handler: (() => void) | null) {
  onPasswordChangeRequired = handler;
}

/**
 * fetch wrapper for the NRCS API: sends the CSRF header, parses JSON errors into
 * ApiError and signals session expiry.
 */
type ApiRequestInit = RequestInit & { json?: unknown; confirmationErrors?: boolean };

async function requestApi(url: string, init: ApiRequestInit) {
  const { confirmationErrors, json, ...requestInit } = init;
  const headers = new Headers(init.headers);
  headers.set('X-NRCS-Client', 'web');
  let body = init.body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  const res = await fetch(url, { ...requestInit, headers, body, credentials: 'same-origin' });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const confirmationFailure = confirmationErrors && ['/api/v1/db/confirm-operation', '/api/v1/db/backups/restore', '/api/v1/db/reset', '/api/v1/db/backups/download', '/api/v1/db/export'].includes(url) &&
      ['CONFIRMATION_INVALID', 'CONFIRMATION_REQUIRED', 'CONFIRMATION_AUTH_FAILED'].includes(payload?.code);
    if (res.status === 401 && !requestInit.signal?.aborted && onUnauthorized && !url.endsWith('/auth/login') && !confirmationFailure) onUnauthorized();
    if (res.status === 403 && !requestInit.signal?.aborted && payload?.code === 'PASSWORD_CHANGE_REQUIRED' && onPasswordChangeRequired) onPasswordChangeRequired();
    throw new ApiError(res.status, payload?.error || `HTTP ${res.status}`, payload?.code);
  }
  return { res, payload };
}

export async function apiFetch<T = any>(url: string, init: ApiRequestInit = {}): Promise<T> {
  return (await requestApi(url, init)).payload as T;
}

export async function downloadDatabaseFile(url: string, json: { fileName?: string; confirmationToken: string }) {
  const { res } = await requestApi(url, { method: 'POST', json, confirmationErrors: true });
  const disposition = res.headers.get('content-disposition') || '';
  const headerName = /(?:^|;)\s*filename\s*=\s*(?:"([A-Za-z0-9_.-]+)"|([A-Za-z0-9_.-]+))/i.exec(disposition);
  const fileName = headerName?.[1] ?? headerName?.[2] ?? json.fileName ?? 'newsroom.sqlite';
  return { blob: await res.blob(), fileName };
}
