import { describe, expect, it } from 'vitest';
import { bulletinTiming, type BulletinStory } from '../../src/shared/bulletins';
import { presenterPaces, presenterReading, rundownBackTimes } from '../../src/shared/presenterTiming';
import type { OnAirState } from '../../src/shared/onair';

const words = (n: number) => Array(n).fill('كلمة').join(' ');
const story = (id: string, name: string, extra: Partial<BulletinStory> = {}): BulletinStory => ({
  id, bulletinId: 'bulletin', rank: 1, slug: id, type: 'READER', script: words(90),
  anchorName: name, status: 'APPROVED', ...extra,
} as BulletinStory);

const session = (id: string, rates: number[], status: OnAirState['status'] = 'ENDED'): OnAirState => ({
  id, episodeId: id, episodeTitle: id, status,
  startedAt: '2026-11-01T17:00:00Z', endedAt: '2026-11-01T17:05:00Z', currentSegmentId: 'seg-1', segmentStartedAt: '2026-11-01T17:00:00Z',
  log: rates.map((rate, index) => ({
    segmentId: `seg-${index}`, title: 'قراءة', startedAt: '2026-11-01T17:00:00Z',
    endedAt: new Date(Date.parse('2026-11-01T17:00:00Z') + (3600 / rate) * 1000).toISOString(),
    reading: { presenterKey: 'ميس', words: 60 },
  })),
});

describe('presenter pace from actual broadcasts', () => {
  it('counts spoken copy only when a single presenter reads the whole segment', () => {
    expect(presenterReading({ presenterName: 'مَيس', segmentType: 'NEWS_ITEM', scriptText: '<p>هذا خبر [إشارة صامتة]</p>' })).toEqual({ presenterKey: 'ميس', words: 2 });
    expect(presenterReading({ presenterName: 'ميس', storyType: 'VO', scriptText: words(60) })).toBeNull();
    expect(presenterReading({ presenterName: 'ميس', segmentType: 'NEWS_ITEM', scriptText: words(60), mediaIds: ['clip'] })).toBeNull();
    expect(presenterReading({ presenterName: 'ميس، نور', segmentType: 'INTRO', scriptText: words(60) })).toBeNull();
  });

  it('waits for enough completed readings across more than one broadcast', () => {
    expect(presenterPaces([session('a', [120, 120, 120, 120, 120]), session('b', [180, 180], 'LIVE')]).size).toBe(0);
    expect(presenterPaces([session('a', [120, 120]), session('b', [180, 180])]).size).toBe(0);
  });

  it('uses a robust presenter-specific pace and leaves repeats and implausible readings out', () => {
    const second = session('b', [120, 123, 210, 350]);
    second.log.push({ ...second.log[2] });
    const paces = presenterPaces([session('a', [117, 120, 125]), second]);
    expect(paces.get('ميس')).toEqual({ wpm: 120, samples: 5, sessions: 2 });
    expect(paces.get('نور')).toBeUndefined();
  });

  it('sets story estimate and back times per presenter without changing the fixed clip time', () => {
    const first = story('first', 'ميس', { type: 'PKG', clipSeconds: 20 });
    const second = story('second', 'نور', { rank: 2 });
    const timing = bulletinTiming({ startTime: '20:00', plannedSeconds: 300 }, [first, second], s => s.anchorName === 'ميس' ? 180 : undefined);
    expect(timing.rows.get(first.id)).toEqual({ duration: 50, front: 72_000, back: 72_208 });
    expect(timing.rows.get(second.id)).toEqual({ duration: 42, front: 72_050, back: 72_258 });
  });

  it('works back from the scheduled out, accounting for the presenter read and fixed segments', () => {
    const rundown = [
      { id: 'reading', durationSeconds: 90, segmentType: 'NEWS_ITEM' as const, presenterName: 'ميس', scriptText: words(90) },
      { id: 'break', durationSeconds: 60, segmentType: 'BREAK' as const },
    ];
    const paces = new Map([['ميس', { wpm: 180, samples: 8, sessions: 3 }]]);
    expect(rundownBackTimes(rundown, 72_300, paces).get('reading')).toEqual({ estimatedRead: 30, back: 72_210 });
    expect(rundownBackTimes(rundown, 72_300, paces).get('break')).toEqual({ estimatedRead: null, back: 72_240 });
  });
});
