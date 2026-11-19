import { describe, expect, it } from 'vitest';
import {
  activeReviewClaim,
  availableTransitions,
  awaitsMyReview,
  canRequestBreaking,
  claimDenial,
  contentSignature,
  isQualityPassed,
  qualityPassDenial,
  REVIEW_CLAIM_TTL_MS,
  reviewBookkeepingDenial,
  transitionDenial,
} from '../../src/shared/newsWorkflow';
import { DEFAULT_ROLE_DEFINITIONS, evaluatePermission } from '../../src/shared/rbac';
import { clockReadTime, formatReadTime, readingSeconds, spokenReadTime } from '../../src/shared/readTime';
import { diffStats, wordDiff } from '../../src/shared/textDiff';
import { handledChangeError, manualWireError, toggleHandled } from '../../src/shared/wires';
import type { NewsItem, WireItem } from '../../src/types';

const canFor = (role: any) => (p: string) => evaluatePermission({ role, isActive: true }, p, DEFAULT_ROLE_DEFINITIONS);
const NOW = Date.now();
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const submitted = (at = iso(-60)) => [{ id: 'l1', newsId: 'n1', fromStatus: 'DRAFT', toStatus: 'UNDER_REVIEW', changedBy: { id: 'u-j', name: 'كاتب', role: 'JOURNALIST' }, timestamp: at }] as NewsItem['workflowLogs'];
const story = (over: Partial<NewsItem> = {}) =>
  ({ id: 'n1', authorId: 'u-j', status: 'UNDER_REVIEW', title: 'عنوان الخبر للمراجعة', summary: 'مقدمة', content: '<p>نص الخبر الكامل هنا</p>', workflowLogs: submitted(), ...over }) as NewsItem;

describe('quality pass («اجتازت التدقيق»)', () => {
  const quality = canFor('QUALITY');
  const editor = canFor('EDITOR');

  it('is offered to reviewers on stories under review, never to the author', () => {
    expect(qualityPassDenial(quality, 'u-q', story(), NOW)).toBeNull();
    expect(qualityPassDenial(quality, 'u-j', story(), NOW)).not.toBeNull();
    expect(qualityPassDenial(quality, 'u-q', story({ status: 'DRAFT' }), NOW)).not.toBeNull();
    expect(qualityPassDenial(canFor('REPORTER'), 'u-r', story(), NOW)).not.toBeNull();
  });

  it('holds while the text stays the same in this round, and lapses when the text changes', () => {
    const item = story();
    const passed = story({ qualityCheck: { byId: 'u-q', byName: 'هبة', at: iso(-10), signature: contentSignature(item) } });
    expect(isQualityPassed(passed)).toBe(true);
    expect(isQualityPassed({ ...passed, content: '<p>نص آخر</p>' })).toBe(false);
    // A later submission (after a return) needs a new pass.
    expect(isQualityPassed({ ...passed, workflowLogs: submitted(iso(-5)) })).toBe(false);
    expect(qualityPassDenial(quality, 'u-q', passed, NOW)).toMatch(/من قبل/);
  });

  it('takes the story out of the quality queue but not out of the approver queue', () => {
    const item = story();
    const passed = story({ qualityCheck: { byId: 'u-q', byName: 'هبة', at: iso(-10), signature: contentSignature(item) } });
    expect(awaitsMyReview(quality, 'u-q2', item, NOW)).toBe(true);
    expect(awaitsMyReview(quality, 'u-q2', passed, NOW)).toBe(false);
    expect(awaitsMyReview(editor, 'u-e', passed, NOW)).toBe(true);
    expect(awaitsMyReview(editor, 'u-j', passed, NOW)).toBe(false); // own story
  });

  it('gives no publishing authority', () => {
    expect(availableTransitions(quality, 'u-q', story())).not.toContain('APPROVED');
  });
});

describe('claiming a review («أراجعها الآن»)', () => {
  const quality = canFor('QUALITY');
  const editor = canFor('EDITOR');
  const claimed = (at = iso(-5), userId = 'u-q') => story({ reviewClaim: { userId, userName: 'هبة', at } });

  it('reserves the decisions for the reviewer who claimed it', () => {
    expect(transitionDenial(editor, 'u-e', claimed(), 'APPROVED')).toMatch(/يراجع هبة/);
    expect(transitionDenial(quality, 'u-q2', claimed(), 'NEEDS_REVISION')).toMatch(/يراجع هبة/);
    expect(transitionDenial(quality, 'u-q', claimed(), 'NEEDS_REVISION')).toBeNull();
    // Another reviewer may not claim it; an approver may take it over.
    expect(claimDenial(quality, 'u-q2', claimed(), NOW)).not.toBeNull();
    expect(claimDenial(editor, 'u-e', claimed(), NOW)).toBeNull();
  });

  it('lapses after its time or when the story comes back for a new round', () => {
    expect(activeReviewClaim(claimed(iso(-5)), NOW)).not.toBeNull();
    expect(activeReviewClaim(claimed(new Date(NOW - REVIEW_CLAIM_TTL_MS - 1000).toISOString()), NOW)).toBeNull();
    expect(activeReviewClaim({ ...claimed(iso(-5)), workflowLogs: submitted(iso(-1)) }, NOW)).toBeNull();
    expect(activeReviewClaim({ ...claimed(iso(-5)), status: 'APPROVED' }, NOW)).toBeNull();
  });

  it('hides a story another reviewer is working on from the queue', () => {
    expect(awaitsMyReview(quality, 'u-q2', claimed(iso(-1)), NOW)).toBe(false);
    expect(awaitsMyReview(quality, 'u-q', claimed(iso(-1)), NOW)).toBe(true);
    // Once the claim lapses the story is back in everyone's queue.
    expect(awaitsMyReview(quality, 'u-q2', claimed(iso(-1)), NOW + REVIEW_CLAIM_TTL_MS * 2)).toBe(true);
  });
});

describe('server rule for review bookkeeping', () => {
  const quality = canFor('QUALITY');
  const now = Date.now();
  const at = new Date(now).toISOString();
  const before = story({ workflowLogs: submitted(new Date(now - 3600_000).toISOString()) });
  const log = (action: any, id = 'u-q') => [...before.workflowLogs, { id: 'l2', newsId: 'n1', fromStatus: 'UNDER_REVIEW', toStatus: 'UNDER_REVIEW', changedBy: { id, name: 'هبة', role: 'QUALITY' }, timestamp: at, action }] as any;
  const me = { id: 'u-q', name: 'هبة' };

  it('accepts a pass stamped by the reviewer on the stored text, logged in the workflow', () => {
    const after = { ...before, qualityCheck: { byId: 'u-q', byName: 'هبة', at, signature: contentSignature(before) }, workflowLogs: log('QUALITY_PASSED') };
    expect(reviewBookkeepingDenial(quality, me, before, after, now)).toBeNull();
  });

  it('refuses forged, stale, unlogged or text-changing passes', () => {
    const ok = { byId: 'u-q', byName: 'هبة', at, signature: contentSignature(before) };
    expect(reviewBookkeepingDenial(quality, me, before, { ...before, qualityCheck: { ...ok, byId: 'u-x' }, workflowLogs: log('QUALITY_PASSED') }, now)).not.toBeNull();
    expect(reviewBookkeepingDenial(quality, me, before, { ...before, qualityCheck: { ...ok, at: '2001-01-01T00:00:00Z' }, workflowLogs: log('QUALITY_PASSED') }, now)).not.toBeNull();
    expect(reviewBookkeepingDenial(quality, me, before, { ...before, qualityCheck: ok }, now)).toMatch(/سجل سير العمل/);
    expect(reviewBookkeepingDenial(quality, me, before, { ...before, content: '<p>غيّرته</p>', qualityCheck: ok, workflowLogs: log('QUALITY_PASSED') }, now)).not.toBeNull();
    expect(reviewBookkeepingDenial(canFor('JOURNALIST'), { id: 'u-x', name: 'س' }, before, { ...before, qualityCheck: { ...ok, byId: 'u-x', byName: 'س' }, workflowLogs: log('QUALITY_PASSED', 'u-x') }, now)).not.toBeNull();
  });

  it('lets only the holder (or an approver) release someone else’s claim', () => {
    const held = { ...before, reviewClaim: { userId: 'u-q', userName: 'هبة', at } };
    const released = { ...held, reviewClaim: undefined };
    expect(reviewBookkeepingDenial(quality, me, held, released, now)).toBeNull();
    expect(reviewBookkeepingDenial(quality, { id: 'u-q2', name: 'سمر' }, held, released, now)).not.toBeNull();
    expect(reviewBookkeepingDenial(canFor('EDITOR'), { id: 'u-e', name: 'سارة' }, held, released, now)).toBeNull();
  });

  it('lets field reporters send breaking for review, never on air', () => {
    const reporter = canFor('REPORTER');
    expect(canRequestBreaking(reporter)).toBe(true);
    expect(reporter('news.breaking_push')).toBe(false);
    expect(canRequestBreaking(canFor('VIEWER'))).toBe(false);
    const created = story({ authorId: 'u-r', breakingRequest: { byId: 'u-r', byName: 'ليلى', at } });
    expect(reviewBookkeepingDenial(reporter, { id: 'u-r', name: 'ليلى' }, null, created, now)).toBeNull();
    expect(reviewBookkeepingDenial(canFor('VIEWER'), { id: 'u-r', name: 'ليلى' }, null, created, now)).not.toBeNull();
  });
});

describe('one read-time figure', () => {
  it('counts the lead and the body at 130 words a minute', () => {
    const body = `<p>${'كلمة '.repeat(30)}</p><p>${'نص '.repeat(4)}</p>`;
    const t = spokenReadTime('مقدمة من أربع كلمات', body);
    expect(t.words).toBe(38);
    expect(t.seconds).toBe(readingSeconds(38));
    expect(t.seconds).toBe(18);
    expect(t.label).toBe('18 ثانية');
  });

  it('writes durations in words, not «00:24 دقيقة»', () => {
    expect(formatReadTime(0)).toBe('0 ثانية');
    expect(formatReadTime(5)).toBe('5 ثوانٍ');
    expect(formatReadTime(60)).toBe('دقيقة واحدة');
    expect(formatReadTime(70)).toBe('دقيقة واحدة و10 ثوانٍ');
    expect(formatReadTime(125)).toBe('دقيقتان و5 ثوانٍ');
    expect(clockReadTime(125)).toBe('2:05');
  });
});

describe('word diff for version history', () => {
  it('marks added and removed Arabic words in reading order', () => {
    const runs = wordDiff('أعلنت الوزارة اليوم عن خطة جديدة', 'أعلنت الوزارة مساء اليوم عن خطة');
    expect(runs).toEqual([
      { kind: 'same', text: 'أعلنت الوزارة' },
      { kind: 'add', text: 'مساء' },
      { kind: 'same', text: 'اليوم عن خطة' },
      { kind: 'del', text: 'جديدة' },
    ]);
    expect(diffStats(runs)).toEqual({ added: 1, removed: 1 });
  });

  it('handles identical and empty texts', () => {
    expect(wordDiff('نص واحد', 'نص واحد')).toEqual([{ kind: 'same', text: 'نص واحد' }]);
    expect(wordDiff('', 'جديد')).toEqual([{ kind: 'add', text: 'جديد' }]);
  });
});

describe('monitoring desk on «المصادر»', () => {
  const manual: Partial<WireItem> = {
    id: 'wire-manual-1',
    manual: true,
    sourceId: 'manual',
    sourceName: 'قناة الأخبار',
    title: 'بيان مصور للناطق باسم الوزارة',
    summary: '',
    categories: [],
    publishedAt: new Date(Date.now() - 60_000).toISOString(),
    medium: 'TV',
  };

  it('validates manual observations', () => {
    expect(manualWireError(manual)).toBeNull();
    expect(manualWireError({ ...manual, sourceName: ' ' })).not.toBeNull();
    expect(manualWireError({ ...manual, link: 'javascript:alert(1)' })).not.toBeNull();
    expect(manualWireError({ ...manual, id: 'wire-123' })).not.toBeNull();
    expect(manualWireError({ ...manual, publishedAt: new Date(Date.now() + 3600_000).toISOString() })).not.toBeNull();
  });

  it('lets each colleague mark only their own follow-up, and nothing else', () => {
    const wire = { ...manual, handled: [{ userId: 'u-a', userName: 'أ', at: '2026-11-19T09:00:00Z' }] } as WireItem;
    const mine = toggleHandled(wire, { id: 'u-m', fullName: 'منى' });
    expect(mine.handled).toHaveLength(2);
    expect(handledChangeError(wire, mine, 'u-m')).toBeNull();
    expect(handledChangeError(mine, toggleHandled(mine, { id: 'u-m', fullName: 'منى' }), 'u-m')).toBeNull();
    expect(handledChangeError(wire, { ...wire, handled: [] }, 'u-m')).not.toBeNull(); // removing a colleague's mark
    expect(handledChangeError(wire, { ...mine, title: 'نص معدّل' }, 'u-m')).not.toBeNull();
  });
});
