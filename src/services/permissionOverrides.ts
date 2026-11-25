/**
 * Per-user permission exceptions, stored in `user.customPermissions`: 'code' grants a permission
 * the role lacks, '!code' denies one the role gives (see computeEffectivePermissions in shared/rbac).
 */
export type OverrideState = 'role' | 'grant' | 'deny';

export const OVERRIDE_STATE_LABELS: Record<OverrideState, string> = {
  role: 'موروثة',
  grant: 'منح',
  deny: 'منع',
};

/** The exception set for one permission (a deny wins if both were somehow stored). */
export function overrideStateOf(custom: string[] | undefined, code: string): OverrideState {
  const list = custom || [];
  if (list.includes(`!${code}`)) return 'deny';
  if (list.includes(code)) return 'grant';
  return 'role';
}

/** A new list with one permission's exception replaced (other entries keep their order). */
export function setOverride(custom: string[] | undefined, code: string, state: OverrideState): string[] {
  const rest = (custom || []).filter((c) => c !== code && c !== `!${code}`);
  if (state === 'grant') return [...rest, code];
  if (state === 'deny') return [...rest, `!${code}`];
  return rest;
}

/** Canonical form for comparing two lists (order and duplicates do not matter). */
export function normalizeOverrides(custom: string[] | undefined): string[] {
  return [...new Set((custom || []).filter(Boolean))].sort();
}

export function sameOverrides(a: string[] | undefined, b: string[] | undefined): boolean {
  return normalizeOverrides(a).join('|') === normalizeOverrides(b).join('|');
}
