import { describe, expect, it } from 'vitest';
import {
  EPISODE_STATUS_INFO,
  episodeDetailsBlock,
  episodeDetailsError,
  episodeDetailsOf,
  episodeDetailsPatch,
  episodeEndTime,
  episodeEndsNextDay,
  episodeStatusInfo,
  patchMovesSlot,
} from '../src/components/episodes/episodeDetails';
import { programTemplateView } from '../src/components/programs/programTemplateView';
import { programTeamOptions, toggleTeamMember } from '../src/components/programs/programTeam';

const episode: any = {
  id: 'ep1', programId: 'p1', programName: 'المشهد', title: 'حلقة الطاقة', episodeNumber: 4, seasonNumber: 2,
  broadcastDate: '2026-11-20', startTime: '21:00', endTime: '21:50', durationMinutes: 50,
  presenterName: 'سارة', producerName: 'فيصل', studioName: 'A1', directorName: '', description: 'وصف',
  status: 'PLANNING', rundown: [{ id: 's1' }], topics: [],
};

describe('episode statuses', () => {
  it('lists all twelve statuses once, with Arabic names', () => {
    const ids = EPISODE_STATUS_INFO.map((s) => s.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toContain('CANCELLED');
    expect(episodeStatusInfo('CANCELLED').label).toBe('ملغاة');
    expect(episodeStatusInfo('ARCHIVED').label).toBe('مؤرشفة');
    expect(episodeStatusInfo('UNKNOWN').label).toBe('UNKNOWN');
  });
});

describe('episode slot', () => {
  it('derives the end of the slot and wraps past midnight', () => {
    expect(episodeEndTime('21:00', 50)).toBe('21:50');
    expect(episodeEndTime('23:30', 45)).toBe('00:15');
    expect(episodeEndsNextDay('23:30', 45)).toBe(true);
    expect(episodeEndsNextDay('21:00', 50)).toBe(false);
    expect(episodeEndTime('', 30)).toBe('');
  });
});

describe('editing episode details', () => {
  it('saves nothing when nothing changed', () => {
    expect(episodeDetailsPatch(episode, episodeDetailsOf(episode))).toBeNull();
  });

  it('sends only the changed fields, and moves the end with the start and length', () => {
    const patch = episodeDetailsPatch(episode, { ...episodeDetailsOf(episode), title: '  عنوان جديد ', startTime: '22:00', durationMinutes: 60 });
    expect(patch).toEqual({ id: 'ep1', title: 'عنوان جديد', startTime: '22:00', durationMinutes: 60, endTime: '23:00' });
    expect(patch && 'rundown' in patch).toBe(false);
    expect(patchMovesSlot(patch!)).toBe(true);
    const crewOnly = episodeDetailsPatch(episode, { ...episodeDetailsOf(episode), directorName: 'هاني' })!;
    expect(crewOnly).toEqual({ id: 'ep1', directorName: 'هاني' });
    expect(patchMovesSlot(crewOnly)).toBe(false);
  });

  it('refuses an empty title, a bad time or an impossible length', () => {
    const ok = episodeDetailsOf(episode);
    expect(episodeDetailsError(ok)).toBeNull();
    expect(episodeDetailsError({ ...ok, title: '  ' })).toMatch(/عنوان/);
    expect(episodeDetailsError({ ...ok, startTime: '' })).toMatch(/وقت/);
    expect(episodeDetailsError({ ...ok, durationMinutes: 0 })).toMatch(/مدة/);
    expect(episodeDetailsError({ ...ok, episodeNumber: 0 })).toMatch(/رقم الحلقة/);
    expect(episodeDetailsError({ ...ok, broadcastDate: '' })).toMatch(/تاريخ/);
  });

  it('is blocked without permission, by a colleague holding the lock, or on air under the live lock', () => {
    expect(episodeDetailsBlock({ mayEdit: false })).toMatch(/صلاحياتك/);
    expect(episodeDetailsBlock({ mayEdit: true, lockedByName: 'ريم' })).toMatch(/ريم/);
    expect(episodeDetailsBlock({ mayEdit: true, liveLock: true, status: 'ON_AIR' })).toMatch(/قفل البث/);
    expect(episodeDetailsBlock({ mayEdit: true, liveLock: true, status: 'PLANNING' })).toBeNull();
    expect(episodeDetailsBlock({ mayEdit: true })).toBeNull();
  });
});

describe('program template view', () => {
  const episodes: any[] = [
    { id: 'old', title: 'قديمة', broadcastDate: '2026-01-01', rundown: [{ title: 'أ', segmentType: 'INTRO', durationSeconds: 60 }] },
    { id: 'new', title: 'أحدث', episodeNumber: 9, broadcastDate: '2026-02-01', topics: [{ id: 't1', title: 'الاقتصاد' }],
      rundown: [{ title: 'ب', segmentType: 'REPORT', durationSeconds: 120, topicId: 't1' }] },
    { id: 'empty', title: 'بلا رانداون', broadcastDate: '2026-03-01', rundown: [] },
  ];

  it('shows the saved template when the program has one', () => {
    const view = programTemplateView(
      { template: { topics: [{ title: 'المحور' }], segments: [{ title: 'افتتاح', segmentType: 'INTRO', durationSeconds: 90, topicIndex: 0 }], updatedByName: 'فيصل' } },
      episodes
    );
    expect(view.source).toBe('TEMPLATE');
    expect(view.segments).toHaveLength(1);
    expect(view.segments[0]).toMatchObject({ title: 'افتتاح', topic: 'المحور', typeName: 'شارة / مقدمة' });
    expect(view.totalSeconds).toBe(90);
    expect(view.updatedByName).toBe('فيصل');
  });

  it('falls back to the latest episode with a rundown, and says which one', () => {
    const view = programTemplateView({}, episodes);
    expect(view.source).toBe('EPISODE');
    expect(view.episode?.id).toBe('new');
    expect(view.segments[0]).toMatchObject({ title: 'ب', topic: 'الاقتصاد' });
    expect(programTemplateView({ template: { topics: [], segments: [] } }, episodes).source).toBe('EPISODE');
  });

  it('reads the older rundownSegments field too, and reports nothing when there is nothing', () => {
    expect(programTemplateView({}, [{ id: 'x', title: 'س', rundownSegments: [{ title: 'ج', segmentType: 'BREAK' }] }]).segments).toHaveLength(1);
    expect(programTemplateView({}, []).source).toBe('NONE');
  });
});

describe('program team', () => {
  it('offers active colleagues and keeps saved names that are not among them', () => {
    const { users, others } = programTeamOptions(
      [
        { fullName: 'ريم', jobTitle: 'منتجة', isActive: true },
        { fullName: 'عمر', isActive: false },
        { fullName: 'سارة', deletedAt: '2026-01-01' },
        { fullName: 'ريم', isActive: true },
      ],
      ['ريم', 'هاني رضوان (مخرج)', 'عمر']
    );
    expect(users.map((u) => u.name)).toEqual(['ريم']);
    expect(users[0].detail).toBe('منتجة');
    expect(others).toEqual(['هاني رضوان (مخرج)', 'عمر']);
  });

  it('toggles a member without duplicates', () => {
    expect(toggleTeamMember(['ريم'], 'عمر')).toEqual(['ريم', 'عمر']);
    expect(toggleTeamMember(['ريم', 'عمر'], 'ريم')).toEqual(['عمر']);
  });
});
