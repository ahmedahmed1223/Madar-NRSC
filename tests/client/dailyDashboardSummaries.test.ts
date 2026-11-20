import { describe, expect, it } from 'vitest';
import { approvedMaterialSummary, canShowAdminExceptions, canShowApprovedMaterial, summarizeAdminExceptions } from '../../src/shared/dailyDashboardSummaries';

describe('daily dashboard summaries', () => {
  it('requires the admin permission and an available settings screen', () => {
    expect(canShowAdminExceptions((p) => p === 'system.settings', (screen) => screen === 'settings')).toBe(true);
    expect(canShowAdminExceptions(() => false, () => true)).toBe(false);
    expect(canShowAdminExceptions(() => true, () => false)).toBe(false);
  });

  it('counts each severity and previews errors before warnings', () => {
    const warning = { level: 'warning', text: 'backup' } as const;
    const errors = ['disk', 'db', 'job'].map((text) => ({ level: 'error' as const, text }));
    expect(summarizeAdminExceptions([warning, ...errors])).toEqual({ errors: 3, warnings: 1, preview: errors });
    expect(summarizeAdminExceptions([])).toEqual({ errors: 0, warnings: 0, preview: [] });
  });

  it('checks effective permissions and the news screen for a read-only newsroom profile', () => {
    const reader = (permission: string) => permission === 'news.view';
    expect(canShowApprovedMaterial(reader, (screen) => screen === 'news')).toBe(true);
    expect(canShowApprovedMaterial(reader, () => false)).toBe(false);
    expect(canShowApprovedMaterial(() => false, () => true)).toBe(false);
    expect(canShowApprovedMaterial((p) => reader(p) || p === 'news.approve', () => true)).toBe(false);
    expect(canShowApprovedMaterial((p) => reader(p) || p === 'news.delete', () => true)).toBe(false);
  });

  it('counts only approved and published rows and previews at most five recent titles', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i), updatedAt: `2026-11-20T1${i}:00:00Z`, status: 'APPROVED' as const }));
    const published = { id: 'live', updatedAt: '2026-11-20T16:00:00Z', status: 'PUBLISHED' as const };
    const deleted = { ...published, id: 'deleted', deletedAt: '2026-11-20T17:00:00Z' };
    const summary = approvedMaterialSummary([...rows, { ...published, id: 'draft', status: 'DRAFT' }, deleted, published]);
    expect(summary.approved).toBe(6);
    expect(summary.published).toBe(1);
    expect(summary.preview.map(({ id }) => id)).toEqual(['live', '5', '4', '3', '2']);
  });

  it('excludes approved copy with a current embargo until its exact lift time', () => {
    const embargoUntil = '2026-11-20T16:00:00Z';
    const until = Date.parse(embargoUntil);
    const item = { id: 'embargo', updatedAt: '2026-11-20T15:00:00Z', status: 'APPROVED' as const, embargoUntil };
    expect(approvedMaterialSummary([item], until - 1).approved).toBe(0);
    expect(approvedMaterialSummary([item], until).preview).toEqual([item]);
  });
});
