import { describe, expect, it } from 'vitest';
import { inQuietHours, isFlashWire, prefsError, wantsDelivery, watchWordHits, defaultPrefs } from '../../src/shared/notifications';
import { bookingConflicts, bookingError, bookingsOnDay, diaryError, weekDays } from '../../src/shared/planning';
import { asRunShow } from '../../src/shared/asrun';
import { embargoDenial, isUnderEmbargo } from '../../src/shared/newsWorkflow';

describe('wire alerts', () => {
  it('detects urgent agency copy in Arabic and English', () => {
    expect(isFlashWire({ title: 'عاجل: زلزال بقوة 6 درجات' })).toBe(true);
    expect(isFlashWire({ title: 'خبر عاجل — استقالة الحكومة' })).toBe(true);
    expect(isFlashWire({ title: 'URGENT - Central bank raises rates' })).toBe(true);
    expect(isFlashWire({ title: 'Breaking: markets fall' })).toBe(true);
    expect(isFlashWire({ title: 'تقرير عن عاجلية الإصلاحات' })).toBe(false);
    expect(isFlashWire({ title: 'أخبار الطقس', categories: ['عاجل'] })).toBe(true);
    expect(isFlashWire({ title: 'Breakingviews column' })).toBe(false);
  });

  it('matches watch words ignoring hamza, taa marbuta and attached prefixes', () => {
    expect(watchWordHits('أعلن وزير الطاقة اليوم', ['وزير الطاقه'])).toEqual(['وزير الطاقه']);
    expect(watchWordHits('اجتماع لأوبك في فيينا', ['اوبك'])).toEqual(['اوبك']);
    expect(watchWordHits('وبالخرطوم احتجاجات', ['الخرطوم', 'بغداد'])).toEqual(['الخرطوم']);
    expect(watchWordHits('المنتخب يفوز', ['نفط'])).toEqual([]);
    expect(watchWordHits('الكتابة', ['كتاب'])).toEqual([]);
  });
});

describe('notification preferences', () => {
  it('falls back to defaults per category and validates input', () => {
    const p = defaultPrefs('u1');
    expect(wantsDelivery(p, 'assignment', 'email')).toBe(true);
    expect(wantsDelivery(p, 'system', 'push')).toBe(false);
    expect(wantsDelivery({ ...p, channels: { assignment: { email: false } } }, 'assignment', 'email')).toBe(false);
    expect(wantsDelivery(p, 'unknown-kind', 'push')).toBe(false);
    expect(prefsError(p, 'u1')).toBeNull();
    expect(prefsError(p, 'u2')).not.toBeNull();
    expect(prefsError({ ...p, channels: { hacked: { push: true } } }, 'u1')).not.toBeNull();
    expect(prefsError({ ...p, quietFrom: '25:00', quietTo: '07:00' }, 'u1')).not.toBeNull();
  });

  it('quiet hours may wrap past midnight', () => {
    const p = { ...defaultPrefs('u'), quietFrom: '23:00', quietTo: '07:00' };
    expect(inQuietHours(p, 23 * 60 + 30)).toBe(true);
    expect(inQuietHours(p, 6 * 60)).toBe(true);
    expect(inQuietHours(p, 12 * 60)).toBe(false);
    expect(inQuietHours({ ...p, quietFrom: '13:00', quietTo: '15:00' }, 14 * 60)).toBe(true);
    expect(inQuietHours(defaultPrefs('u'), 0)).toBe(false);
  });
});

describe('bookings and diary', () => {
  const b = (id: string, start: string, end: string, extra: any = {}) => ({ id, resourceId: 'r1', title: 'x', start, end, status: 'CONFIRMED', createdAt: '', updatedAt: '', ...extra }) as any;

  it('finds clashes on the same live resource only', () => {
    const all = [b('a', '2030-01-01T09:00:00Z', '2030-01-01T11:00:00Z'), b('c', '2030-01-01T09:00:00Z', '2030-01-01T11:00:00Z', { status: 'CANCELLED' }), b('d', '2030-01-01T09:00:00Z', '2030-01-01T11:00:00Z', { resourceId: 'r2' })];
    expect(bookingConflicts(b('n', '2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z'), all).map((x) => x.id)).toEqual(['a']);
    expect(bookingConflicts(b('n', '2030-01-01T11:00:00Z', '2030-01-01T12:00:00Z'), all)).toEqual([]);
    expect(bookingConflicts(b('a', '2030-01-01T09:00:00Z', '2030-01-01T11:00:00Z'), all)).toEqual([]);
  });

  it('validates bookings and diary entries', () => {
    expect(bookingError(b('n', '2030-01-01T12:00:00Z', '2030-01-01T11:00:00Z'))).toContain('بعد');
    expect(bookingError(b('n', '2030-01-01T10:00:00Z', '2030-01-20T11:00:00Z'))).toContain('أسبوع');
    expect(bookingError(b('n', '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z'))).toBeNull();
    const e = { title: 'حدث', date: '2030-01-01', kind: 'EVENT', coverage: 'COVER', priority: 'NORMAL', assigneeIds: [] };
    expect(diaryError(e)).toBeNull();
    expect(diaryError({ ...e, startTime: '10:00', endTime: '09:00' })).not.toBeNull();
    expect(diaryError({ ...e, coverage: 'MAYBE' })).not.toBeNull();
  });

  it('weeks start on Saturday; day filter uses local days', () => {
    const w = weekDays('2026-09-30'); // a Wednesday
    expect(w).toHaveLength(7);
    expect(w[0]).toBe('2026-09-26');
    expect(w[6]).toBe('2026-10-02');
    const local = (h: number, day = 1) => new Date(2030, 0, day, h).toISOString();
    expect(bookingsOnDay([b('a', local(23), local(1, 2))], '2030-01-02').map((x) => x.id)).toEqual(['a']);
    expect(bookingsOnDay([b('a', local(9), local(10))], '2030-01-02')).toEqual([]);
  });
});

describe('embargo and as-run', () => {
  it('embargo blocks publishing until it lifts', () => {
    const now = Date.parse('2030-01-01T10:00:00Z');
    const item = { embargoUntil: '2030-01-01T12:00:00Z' } as any;
    expect(isUnderEmbargo(item, now)).toBe(true);
    expect(embargoDenial(item, 'PUBLISHED', now)).toContain('الحظر');
    expect(embargoDenial({ ...item, scheduledDate: '2030-01-01T11:00:00Z' }, 'SCHEDULED', now)).not.toBeNull();
    expect(embargoDenial({ ...item, scheduledDate: '2030-01-01T13:00:00Z' }, 'SCHEDULED', now)).toBeNull();
    expect(embargoDenial(item, 'PUBLISHED', Date.parse('2030-01-01T12:00:01Z'))).toBeNull();
  });

  it('as-run compares real timings with the plan', () => {
    const state: any = {
      episodeId: 'ep1', status: 'ENDED', startedAt: '2030-01-01T10:00:00Z', endedAt: '2030-01-01T10:05:00Z',
      log: [
        { segmentId: 's1', title: 'افتتاح', startedAt: '2030-01-01T10:00:00Z', endedAt: '2030-01-01T10:02:00Z' },
        { segmentId: 's2', title: 'حوار', startedAt: '2030-01-01T10:02:00Z', endedAt: '2030-01-01T10:05:00Z' },
      ],
    };
    const show = { id: 'ep1', title: 'حلقة', rundown: [{ id: 's1', durationSeconds: 60 }, { id: 's2', durationSeconds: 240 }] };
    const r = asRunShow(state, show);
    expect(r.actualSeconds).toBe(300);
    expect(r.plannedSeconds).toBe(300);
    expect(r.rows.map((x) => x.diffSeconds)).toEqual([60, -60]);
  });
});
