export const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';

export function validDropboxAppKey(appKey: string): boolean {
  return /^[a-z0-9]{5,40}$/i.test(appKey);
}

export function dropboxAuthorizationUrl(appKey: string): string {
  const query = new URLSearchParams({ client_id: appKey, response_type: 'code', token_access_type: 'offline' });
  return `${DROPBOX_AUTHORIZE_URL}?${query}`;
}
