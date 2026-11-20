import { expect, it } from 'vitest';
import { handoverDraftError, personalHandoverReceiptState, type HandoverRow } from '../../src/shared/shiftHandovers';
import { ALL_PERMISSIONS, DEFAULT_ROLE_DEFINITIONS, evaluatePermission } from '../../src/shared/rbac';

const draft = (extra: Record<string, unknown> = {}) => ({ id: 'h-1', schemaVersion: 1, departmentId: 'newsroom', sourceDate: '2026-10-11', sourceShift: 'MORNING', recipientDate: '2026-10-11', recipientShift: 'EVENING', title: 'Shift', note: '', references: [], ...extra });

it('identifies only the signed-in crew member’s pending or confirmed receipt', () => {
  const row = { d: { state: 'PUBLISHED' }, canAcknowledge: true, receipts: [{ userId: 'colleague' }] } as HandoverRow;
  expect(personalHandoverReceiptState(row, 'crew')).toBe('pending');
  expect(personalHandoverReceiptState(row, 'colleague')).toBe('confirmed');
  expect(personalHandoverReceiptState({ ...row, canAcknowledge: false }, 'crew')).toBeNull();
  expect(personalHandoverReceiptState({ ...row, canAcknowledge: false }, 'colleague')).toBe('confirmed');
  expect(personalHandoverReceiptState({ ...row, d: { ...row.d, state: 'DRAFT' } }, 'crew')).toBeNull();
});
it('accepts exact bounded plain text and rejects overflow', () => {
  expect(handoverDraftError(draft({ title: 'a'.repeat(120), note: 'b'.repeat(2000), references: [{ collection: 'news', id: 'n', note: 'c'.repeat(500) }] }))).toBeNull();
  for (const extra of [{ title: 'a'.repeat(121) }, { note: 'b'.repeat(2001) }, { title: ' ' }, { note: '<script>x</script>' }, { references: [{ collection: 'news', id: 'n', note: 'c'.repeat(501) }] }]) expect(handoverDraftError(draft(extra))).toBeTruthy();
});
it('rejects unknown fields forged metadata invalid dates shifts departments and identifiers', () => {
  for (const extra of [{ authorId: 'forged' }, { publishedAt: 'now' }, { state: 'PUBLISHED' }, { schemaVersion: 2 }, { sourceDate: '2026-02-30' }, { recipientShift: 'BAD' }, { departmentId: 'bad' }, { id: '../bad' }, { supersedesId: 'https://example.com' }]) expect(handoverDraftError(draft(extra))).toBeTruthy();
});
it('requires unique bounded references with no embedded data or unsupported collections', () => {
  const refs = Array.from({ length: 30 }, (_, i) => ({ collection: 'news', id: `n${i}`, note: '' }));
  expect(handoverDraftError(draft({ references: refs }))).toBeNull();
  for (const references of [[...refs, { collection: 'news', id: 'extra', note: '' }], [refs[0], refs[0]], [{ collection: 'users', id: 'user', note: '' }], [{ collection: 'news', id: 'n', note: '', content: 'secret' }]]) expect(handoverDraftError(draft({ references }))).toBeTruthy();
});
it('registers explicit defaults while preserving custom overrides and custom roles', () => {
  for (const code of ['handover.view', 'handover.publish', 'handover.manage']) expect(ALL_PERMISSIONS.some(p => p.code === code)).toBe(true);
  const user = { role: 'JOURNALIST', isActive: true } as any;
  expect(evaluatePermission(user, 'handover.publish', DEFAULT_ROLE_DEFINITIONS)).toBe(true);
  expect(evaluatePermission({ ...user, customPermissions: ['!handover.publish'] }, 'handover.publish', DEFAULT_ROLE_DEFINITIONS)).toBe(false);
  const custom = { ...DEFAULT_ROLE_DEFINITIONS[0], id: 'custom', permissions: ['news.view'] };
  expect(evaluatePermission({ ...user, customRoleId: 'custom' }, 'handover.view', [custom])).toBe(false);
});
