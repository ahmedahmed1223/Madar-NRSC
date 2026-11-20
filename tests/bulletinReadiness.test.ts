import { describe, expect, it } from 'vitest';
import { durationWords, stationClock, evaluateBulletinReadiness, scheduledBulletinExists, storyPresenter, timingDelta } from '../src/shared/bulletinReadiness';
describe('bulletin readiness', () => {
  const bulletin: any = { id: 'b', approvalSteps: [] };
  const story: any = { id: 's', type: 'READER', script: 'نص صالح للقراءة على الهواء', anchorName: 'مذيع', status: 'APPROVED', approvals: [], bulletinId: 'b' };
  it('reader needs no video and floated stories do not block', () => {
    expect(evaluateBulletinReadiness(bulletin, [story], [], [], new Date())).toEqual([]);
    expect(evaluateBulletinReadiness(bulletin, [{ ...story, floated: true, script: '' }], [], [], new Date())).toEqual([]);
  });
  it('requires text, type-specific video and completed approval', () => {
    const issues = evaluateBulletinReadiness(bulletin, [{ ...story, type: 'VO', status: 'READY', script: '' }], [], [], new Date());
    expect(issues.map(i => i.code)).toEqual(expect.arrayContaining(['SCRIPT', 'VIDEO', 'APPROVAL']));
  });
  it('break requires duration but not a script', () => {
    expect(evaluateBulletinReadiness(bulletin, [{ ...story, type: 'BREAK', script: '', manualSeconds: 30 }], [], [], new Date())).toEqual([]);
  });
  it('embargo blocks and newer source warns', () => {
    const issues = evaluateBulletinReadiness(bulletin, [{ ...story, newsId: 'n', newsUpdatedAt: '2026-01-01' }], [{ id: 'n', updatedAt: '2026-02-01', embargoUntil: '2030-01-01' }] as any, [], new Date('2026-03-01'));
    expect(issues.find(i => i.code === 'EMBARGO')?.severity).toBe('blocker');
    expect(issues.find(i => i.code === 'SOURCE_CHANGED')?.severity).toBe('warning');
  });
  it('a newly required signoff blocks an already approved story', () => {
    const changed = { ...bulletin, approvalSteps: [{ id: 'editor', kind: 'BULLETIN_EDITOR' }, { id: 'chief', kind: 'CHIEF' }] };
    const approved = { ...story, approvals: [{ stepId: 'editor', byId: 'e', byName: 'e', at: '2026-01-01' }] };
    expect(evaluateBulletinReadiness(changed as any, [approved], [], [], new Date()).some(i => i.code === 'APPROVAL')).toBe(true);
  });
  it('the bulletin presenter covers a story without its own, as the rundown table shows it', () => {
    const noAnchor = { ...story, anchorName: '' };
    expect(evaluateBulletinReadiness({ ...bulletin, anchors: ['فيصل العتيبي'] }, [noAnchor], [], [], new Date()).some(i => i.code === 'PRESENTER')).toBe(false);
    expect(evaluateBulletinReadiness({ ...bulletin, anchors: [] }, [noAnchor], [], [], new Date()).find(i => i.code === 'PRESENTER')?.severity).toBe('warning');
    expect(storyPresenter({ anchors: ['فيصل'] }, { anchorName: '' })).toBe('فيصل');
    expect(storyPresenter({ anchors: ['فيصل'] }, { anchorName: 'سارة' })).toBe('سارة');
  });
});

describe('bulletin timing reads as a duration', () => {
  it('writes minutes and seconds in words', () => {
    expect(durationWords(1236)).toBe('20 د 36 ث');
    expect(durationWords(-45)).toBe('45 ث');
    expect(durationWords(120)).toBe('2 د');
    expect(durationWords(3900)).toBe('1 س 05 د');
  });
  it('says short or over, never a clock time', () => {
    expect(timingDelta(-1236).text).toBe('ناقص 20 د 36 ث');
    expect(timingDelta(65).text).toBe('زائد 1 د 05 ث');
    expect(timingDelta(20).state).toBe('ON_TIME');
    expect(timingDelta(8, 5).state).toBe('OVER');
  });
});

describe('scheduled bulletin matching', () => {
  const format = { id: 'fmt-main', kind: 'MAIN' as const, startTime: '20:00' };
  it('matches the scheduled id, the format and day, or the same kind and time made by hand', () => {
    expect(scheduledBulletinExists(format, '2026-11-19', [{ id: 'bul-fmt-main-2026-11-19', date: '2026-11-19', kind: 'MAIN', startTime: '20:00' }])).toBe(true);
    expect(scheduledBulletinExists(format, '2026-11-19', [{ id: 'bul-demo-main', date: '2026-11-19', formatId: 'fmt-main', kind: 'MAIN', startTime: '20:00' }])).toBe(true);
    expect(scheduledBulletinExists(format, '2026-11-19', [{ id: 'x', date: '2026-11-19', kind: 'MAIN', startTime: '20:00' }])).toBe(true);
  });
  it('ignores other days, other formats, and deleted copies', () => {
    expect(scheduledBulletinExists(format, '2026-11-19', [{ id: 'y', date: '2026-11-18', formatId: 'fmt-main', kind: 'MAIN', startTime: '20:00' }])).toBe(false);
    expect(scheduledBulletinExists(format, '2026-11-19', [{ id: 'z', date: '2026-11-19', formatId: 'fmt-noon', kind: 'MAIN', startTime: '20:00' }])).toBe(false);
    expect(scheduledBulletinExists(format, '2026-11-19', [{ id: 'w', date: '2026-11-19', formatId: 'fmt-main', kind: 'MAIN', startTime: '20:00', deletedAt: '2026-11-19T01:00:00Z' }])).toBe(false);
  });
});

describe('station clock for the countdown to air', () => {
  it('reads the day and time in the station zone, not the computer\'s', () => {
    const at = new Date('2026-11-19T21:30:15Z');
    expect(stationClock('Asia/Riyadh', at)).toEqual({ date: '2026-11-20', seconds: 30 * 60 + 15 });
    expect(stationClock('Asia/Gaza', at)).toEqual({ date: '2026-11-19', seconds: 23 * 3600 + 30 * 60 + 15 });
    expect(stationClock('Not/AZone', at).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
