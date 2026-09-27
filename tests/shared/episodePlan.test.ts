import { describe, expect, it } from 'vitest';
import {
  arrangeByTopics,
  bookingStatusOf,
  episodeGuestList,
  episodePlanError,
  groupByTopic,
  guestClashes,
  insertIntoTopic,
  segmentGuests,
  segmentQuestions,
  structureFromTemplate,
  templateFromEpisode,
  withSegmentGuests,
} from '../../src/shared/episodePlan';
import { episodeReadiness } from '../../src/shared/production';

const topics = [
  { id: 't1', title: 'الأول' },
  { id: 't2', title: 'الثاني' },
];
const rundown = [
  { id: 'intro', segmentType: 'INTRO' },
  { id: 'a', topicId: 't1' },
  { id: 'b', topicId: 't2' },
  { id: 'c', topicId: 't1' },
  { id: 'brk', segmentType: 'BREAK' },
  { id: 'out', segmentType: 'OUTRO' },
] as any[];

describe('episode topics', () => {
  it('groups segments under topics and keeps loose segments apart', () => {
    const groups = groupByTopic({ topics, rundown });
    expect(groups.map((g) => g.topic?.id ?? null)).toEqual(['t1', 't2', null]);
    expect(groups[0].segments.map((s) => s.id)).toEqual(['a', 'c']);
    expect(groups[2].segments.map((s) => s.id)).toEqual(['intro', 'brk', 'out']);
  });

  it('rebuilds the rundown in topic order with the opening first and closing last', () => {
    const swapped = [topics[1], topics[0]];
    expect(arrangeByTopics(rundown, swapped).map((s) => s.id)).toEqual(['intro', 'b', 'a', 'c', 'brk', 'out']);
  });

  it('inserts a new segment at the end of its topic, or before the closing', () => {
    expect(insertIntoTopic(rundown, { id: 'n', topicId: 't1' } as any).map((s) => s.id)).toEqual(['intro', 'a', 'b', 'c', 'n', 'brk', 'out']);
    expect(insertIntoTopic(rundown, { id: 'n' } as any).map((s) => s.id)).toEqual(['intro', 'a', 'b', 'c', 'brk', 'n', 'out']);
  });
});

describe('guests', () => {
  it('reads legacy single-guest segments and legacy arrival states', () => {
    expect(segmentGuests({ guestId: 'g1', guestName: 'خالد' })).toEqual([{ guestId: 'g1', guestName: 'خالد', role: 'MAIN' }]);
    expect(bookingStatusOf({ arrivalStatus: 'PENDING' })).toBe('CONTACTED');
    expect(bookingStatusOf({ arrivalStatus: 'PENDING', bookingStatus: 'DECLINED' })).toBe('DECLINED');
    const seg: any = withSegmentGuests({ id: 's' } as any, [
      { guestId: 'g2', guestName: 'نورة', role: 'COMMENTATOR' },
      { guestId: 'g1', guestName: 'خالد', role: 'MAIN' },
    ]);
    expect(seg.guestId).toBe('g1'); // legacy field follows the main guest
  });

  it('lists guests placed in segments as candidates and detects clashes', () => {
    const ep = { id: 'e1', broadcastDate: '2026-10-01', startTime: '21:00', endTime: '22:00', guests: [], rundown: [{ id: 's', guests: [{ guestId: 'g1', guestName: 'خالد', role: 'MAIN' }] }] };
    expect(episodeGuestList(ep)).toMatchObject([{ guestId: 'g1', bookingStatus: 'CANDIDATE' }]);
    const other = { id: 'e2', programName: 'آخر', broadcastDate: '2026-10-01', startTime: '21:30', endTime: '22:30', guests: [{ guestId: 'g1', bookingStatus: 'CONFIRMED' }] };
    const later = { ...other, id: 'e3', startTime: '23:00', endTime: '23:30' };
    expect(guestClashes(ep, 'g1', [ep, other, later]).map((e) => e.id)).toEqual(['e2']);
  });
});

describe('readiness with guests and questions', () => {
  const ctx = { requests: [], media: [] };
  const seg = { id: 's1', title: 'حوار', segmentType: 'LIVE_INTERVIEW', scriptText: 'نص', guests: [{ guestId: 'g1', guestName: 'خالد', role: 'MAIN' }] };

  it('needs a booked guest and prepared main questions', () => {
    const blockers = (ep: any) => episodeReadiness(ep, ctx).blockers.map((b) => b.label);
    expect(blockers({ rundown: [seg], guests: [{ guestId: 'g1', bookingStatus: 'CONTACTED' }] })).toEqual(['الضيف', 'الأسئلة']);
    const ready = { rundown: [seg], guests: [{ guestId: 'g1', bookingStatus: 'CONFIRMED' }], questions: [{ id: 'q', segmentId: 's1', kind: 'MAIN', questionText: 'س' }] };
    expect(episodeReadiness(ready, ctx).ready).toBe(true);
    // A backup question alone is not enough.
    expect(blockers({ ...ready, questions: [{ id: 'q', segmentId: 's1', kind: 'BACKUP' }] })).toEqual(['الأسئلة']);
    // A declined guest blocks until replaced.
    expect(episodeReadiness({ ...ready, guests: [{ guestId: 'g1', bookingStatus: 'DECLINED' }] }, ctx).blockers[0].detail).toContain('بديل');
  });

  it('counts older questions aimed at the guest by name', () => {
    expect(segmentQuestions({ questions: [{ id: 'q', assignedToName: 'خالد' }] }, seg).length).toBe(1);
  });
});

describe('templates', () => {
  it('round-trips an episode structure with fresh ids and no guests', () => {
    const ep = {
      topics,
      rundown: [
        { id: 'x', title: 'مقدمة', segmentType: 'INTRO', durationSeconds: 60, scriptText: 'أهلاً' },
        { id: 'y', title: 'حوار', segmentType: 'LIVE_INTERVIEW', durationSeconds: 600, topicId: 't2', scriptText: 'خاص', guests: [{ guestId: 'g' }] },
      ],
    };
    const tpl = templateFromEpisode(ep);
    expect(tpl.segments[1]).toMatchObject({ topicIndex: 1, scriptText: '' });
    expect(tpl.segments[0].scriptText).toBe('أهلاً');
    let n = 0;
    const out = structureFromTemplate(tpl, 'ep-new', (p) => `${p}-${++n}`);
    expect(out.topics.map((t) => t.title)).toEqual(['الأول', 'الثاني']);
    expect(out.rundown[1].topicId).toBe(out.topics[1].id);
    expect(out.rundown[1].guests).toBeUndefined();
    expect(out.rundown.every((s) => s.episodeId === 'ep-new')).toBe(true);
  });
});

describe('validation', () => {
  it('rejects malformed plans', () => {
    expect(episodePlanError({ topics: [{ id: 't', title: ' ' }] })).toBeTruthy();
    expect(episodePlanError({ rundown: [{ title: 'ت', report: { source: 'ASSIGNED' } }] })).toContain('المراسل');
    expect(episodePlanError({ rundown: [{ guests: [{ guestId: 'g', role: 'BOSS' }] }] })).toBeTruthy();
    expect(episodePlanError({ topics, rundown, guests: [{ bookingStatus: 'CONFIRMED' }] })).toBeNull();
  });
});
