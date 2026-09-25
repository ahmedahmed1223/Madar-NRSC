import { describe, expect, it } from 'vitest';
import { formatSecondsToTime, parseTimeToSeconds, recalculateRundown } from '../../src/shared/rundown';
import { computeEffectivePermissions, DEFAULT_ROLE_DEFINITIONS, evaluatePermission } from '../../src/shared/rbac';
import { newId } from '../../src/shared/ids';
import { collectionForStorageKey, COLLECTION_NAMES, COLLECTIONS } from '../../src/shared/collections';
import type { RundownSegment } from '../../src/types';

const seg = (id: string, durationSeconds: number) => ({ id, durationSeconds }) as RundownSegment;

describe('rundown timing engine', () => {
  it('chains each segment start to the previous end', () => {
    const out = recalculateRundown([seg('a', 90), seg('b', 30), seg('c', 3600)]);
    expect(out.map((s) => [s.orderIndex, s.startTimeOffset, s.endTimeOffset])).toEqual([
      [1, '00:00:00', '00:01:30'],
      [2, '00:01:30', '00:02:00'],
      [3, '00:02:00', '01:02:00'],
    ]);
  });

  it('treats invalid durations as zero instead of producing NaN', () => {
    const out = recalculateRundown([seg('a', Number.NaN), seg('b', -5), seg('c', 10)]);
    expect(out[2].startTimeOffset).toBe('00:00:00');
    expect(out[2].endTimeOffset).toBe('00:00:10');
  });

  it('formats and parses times symmetrically', () => {
    expect(formatSecondsToTime(3785)).toBe('01:03:05');
    expect(parseTimeToSeconds('01:03:05')).toBe(3785);
    expect(parseTimeToSeconds('02:30')).toBe(150);
    expect(parseTimeToSeconds('bad:input')).toBe(0);
  });
});

describe('RBAC evaluation', () => {
  const roles = DEFAULT_ROLE_DEFINITIONS;

  it('lets journalists create but not publish', () => {
    const user = { role: 'JOURNALIST' as const, isActive: true };
    expect(evaluatePermission(user, 'news.create', roles)).toBe(true);
    expect(evaluatePermission(user, 'news.publish', roles)).toBe(false);
  });

  it('denies everything to inactive users, even super admins', () => {
    expect(evaluatePermission({ role: 'SUPER_ADMIN', isActive: false }, 'news.view', roles)).toBe(false);
  });

  it('applies custom grants and explicit denies (deny wins)', () => {
    const user = { role: 'JOURNALIST' as const, isActive: true, customPermissions: ['news.publish', '!news.create'] };
    expect(evaluatePermission(user, 'news.publish', roles)).toBe(true);
    expect(evaluatePermission(user, 'news.create', roles)).toBe(false);
    const effective = computeEffectivePermissions(user, roles);
    expect(effective).toContain('news.publish');
    expect(effective).not.toContain('news.create');
  });

  it('keeps database management away from ADMIN but not SUPER_ADMIN', () => {
    expect(evaluatePermission({ role: 'ADMIN', isActive: true }, 'system.database_manage', roles)).toBe(false);
    expect(evaluatePermission({ role: 'SUPER_ADMIN', isActive: true }, 'system.database_manage', roles)).toBe(true);
  });
});

describe('ids and collections', () => {
  it('generates unique ids even within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId('nws')));
    expect(ids.size).toBe(5000);
  });

  it('maps every storage key back to its collection', () => {
    for (const name of COLLECTION_NAMES) {
      expect(collectionForStorageKey(COLLECTIONS[name].storageKey)).toBe(name);
    }
  });
});
