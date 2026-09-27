import { describe, expect, it } from 'vitest';
import { bulletinTiming, clockOf, headlinesFrom, plainText, rankBetween, readSeconds, storyTiming } from '../../src/shared/bulletins';

const st = (id: string, rank: number, extra: any = {}) => ({ id, bulletinId: 'b', rank, slug: id, type: 'READER', script: '', status: 'DRAFT', createdAt: '', updatedAt: '', ...extra }) as any;

describe('bulletin timing', () => {
  it('reads Arabic copy at about 130 words a minute, ignoring bracketed directions', () => {
    const words = Array(130).fill('كلمة').join(' ');
    expect(readSeconds(words)).toBe(61);
    expect(readSeconds('[كاميرا 2] مرحبا')).toBe(3);
    expect(readSeconds('')).toBe(0);
  });

  it('adds clip time for video stories and manual time for live links', () => {
    expect(storyTiming({ type: 'PKG', script: '', clipSeconds: 120 } as any).total).toBe(120);
    expect(storyTiming({ type: 'READER', script: '', clipSeconds: 120 } as any).total).toBe(0);
    expect(storyTiming({ type: 'LIVE', script: '', manualSeconds: 90 } as any).total).toBe(90);
  });

  it('gives front and back times against the hard out, skipping floated and killed stories', () => {
    const stories = [
      st('a', 1000, { type: 'BREAK', manualSeconds: 60 }),
      st('b', 2000, { type: 'LIVE', manualSeconds: 120 }),
      st('c', 3000, { type: 'LIVE', manualSeconds: 600, floated: true }),
      st('d', 1500, { type: 'BREAK', manualSeconds: 30, killed: true }),
    ];
    const t = bulletinTiming({ startTime: '20:00', plannedSeconds: 300 }, stories);
    expect(t.total).toBe(180);
    expect(t.overUnder).toBe(-120);
    expect(clockOf(t.rows.get('a')!.front)).toBe('20:00:00');
    expect(clockOf(t.rows.get('b')!.front)).toBe('20:01:00');
    // Back time: when the story must start to finish exactly at 20:05.
    expect(clockOf(t.rows.get('b')!.back)).toBe('20:03:00');
    expect(clockOf(t.rows.get('a')!.back)).toBe('20:02:00');
    expect(t.rows.has('c')).toBe(false);
  });

  it('ranks between neighbours and builds headlines from the top stories', () => {
    expect(rankBetween(1000, 2000)).toBe(1500);
    expect(rankBetween(undefined, 1000)).toBe(0);
    expect(rankBetween(3000)).toBe(4000);
    const h = headlinesFrom([st('x', 1, { script: 'الخبر الأول. تفاصيل' }), st('y', 2, { type: 'BREAK' }), st('z', 3, { slug: 'بلا نص' })]);
    expect(h).toBe('• الخبر الأول\n• بلا نص');
    expect(plainText('<p>سطر</p><p>آخر &amp; ثالث</p>')).toBe('سطر\nآخر & ثالث');
  });
});
