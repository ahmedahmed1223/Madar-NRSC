import { describe, expect, it } from 'vitest';
import {
  availableTransitions,
  canEditNewsContent,
  canTransition,
  isBreakingLive,
  makeNewsSlug,
  transitionDenial,
} from '../../src/shared/newsWorkflow';
import { DEFAULT_ROLE_DEFINITIONS, evaluatePermission } from '../../src/shared/rbac';
import type { NewsItem } from '../../src/types';

const canFor = (role: any) => (p: string) => evaluatePermission({ role, isActive: true }, p, DEFAULT_ROLE_DEFINITIONS);
const story = (over: Partial<NewsItem> = {}) => ({ id: 'n1', authorId: 'u-j', status: 'DRAFT', ...over }) as NewsItem;

describe('editorial workflow', () => {
  it('never publishes without passing review and approval', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('UNDER_REVIEW', 'PUBLISHED')).toBe(false);
    expect(canTransition('APPROVED', 'PUBLISHED')).toBe(true);
    expect(canTransition(undefined, 'PUBLISHED')).toBe(false);
    expect(canTransition(undefined, 'UNDER_REVIEW')).toBe(true);
  });

  it('does not let "approve" silently un-publish a live story', () => {
    const editor = canFor('EDITOR');
    expect(transitionDenial(editor, 'u-e', story({ status: 'PUBLISHED' }), 'APPROVED')).not.toBeNull();
  });

  it('gives each role the right buttons', () => {
    const journalist = canFor('JOURNALIST');
    expect(availableTransitions(journalist, 'u-j', story())).toEqual(['IN_PROGRESS', 'UNDER_REVIEW', 'ARCHIVED']);
    // The author may withdraw a story from review, but not approve it.
    expect(availableTransitions(journalist, 'u-j', story({ status: 'UNDER_REVIEW' }))).toEqual(['DRAFT']);
    // Someone else's draft: nothing to do.
    expect(availableTransitions(journalist, 'u-other', story())).toEqual([]);

    const editor = canFor('EDITOR');
    expect(availableTransitions(editor, 'u-e', story({ status: 'UNDER_REVIEW' }))).toEqual(
      expect.arrayContaining(['APPROVED', 'NEEDS_REVISION', 'REJECTED'])
    );
    expect(availableTransitions(editor, 'u-e', story({ status: 'APPROVED' }))).toContain('PUBLISHED');
  });

  it('protects approved and published copy from content edits', () => {
    const journalist = canFor('JOURNALIST');
    expect(canEditNewsContent(journalist, 'u-j', story())).toBe(true);
    expect(canEditNewsContent(journalist, 'u-j', story({ status: 'APPROVED' }))).toBe(false);
    expect(canEditNewsContent(journalist, 'u-j', story({ status: 'PUBLISHED' }))).toBe(false);
    expect(canEditNewsContent(canFor('EDITOR'), 'u-e', story({ status: 'PUBLISHED' }))).toBe(true);
    expect(canEditNewsContent(canFor('PRODUCER'), 'u-j', story())).toBe(true);
  });

  it('puts only published, unexpired breaking stories on air', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isBreakingLive({ isBreaking: true, status: 'PUBLISHED', breakingUntil: future })).toBe(true);
    expect(isBreakingLive({ isBreaking: true, status: 'DRAFT', breakingUntil: future })).toBe(false);
    expect(isBreakingLive({ isBreaking: true, status: 'PUBLISHED', breakingUntil: past })).toBe(false);
    expect(isBreakingLive({ isBreaking: true, status: 'PUBLISHED', breakingUntil: future, deletedAt: past })).toBe(false);
  });

  it('builds unique, readable slugs for Arabic titles', () => {
    expect(makeNewsSlug('قمّة الرياض: اتفاق جديد؟', 'nws-abc-123')).toBe('قمة-الرياض-اتفاق-جديد-123');
    expect(makeNewsSlug('', 'nws-x-9')).toBe('news-9');
  });
});
