import { expect, it } from 'vitest';
import { digitalPackageError, emptyDigitalPackage, prepareDigitalPackage } from '../../src/shared/digitalPublishing';
import { lintStylebook, lintStylebookHtml, type StylebookRules } from '../../src/shared/editorialStylebook';
import type { NewsItem } from '../../src/types';

const digital = { ...emptyDigitalPackage(), x: 'العنوان المختصر' };
const approvedStory: Partial<NewsItem> = { status: 'APPROVED', title: 'عنوان الخبر الحالي', digitalPackage: digital };
const approver = { id: 'editor', canApprove: true, now: '2026-11-22T12:00:00.000Z' };

it('stamps package approval only for approved stories and authorized editors', () => {
  expect(prepareDigitalPackage(approvedStory, { ...approvedStory, digitalPackage: { ...digital, requestApproval: true } }, approver))
    .toMatchObject({ value: { approval: { by: 'editor', at: approver.now } } });
  expect(prepareDigitalPackage(approvedStory, { ...approvedStory, digitalPackage: { ...digital, requestApproval: true } }, { ...approver, canApprove: false }).error).toBeTruthy();
  expect(prepareDigitalPackage({ ...approvedStory, status: 'DRAFT' }, { ...approvedStory, status: 'DRAFT', digitalPackage: { ...digital, requestApproval: true } }, approver).error).toBeTruthy();
});

it('preserves package approval for workflow-only updates and clears it when the source or package changes', () => {
  const before = { ...approvedStory, digitalPackage: { ...digital, approval: { by: approver.id, at: approver.now } } };
  expect(prepareDigitalPackage(before, { ...before, status: 'PUBLISHED' }, approver).value?.approval).toEqual(before.digitalPackage.approval);
  expect(prepareDigitalPackage(before, { ...before, title: 'تم تصحيح عنوان الخبر' }, approver).value?.approval).toBeUndefined();
  expect(prepareDigitalPackage(before, { ...before, digitalPackage: { ...digital, telegram: 'نص مضاف' } }, approver).value?.approval).toBeUndefined();
});

it('checks copy limits and validates ordered YouTube chapters', () => {
  expect(digitalPackageError({ ...digital, x: 'س'.repeat(281) })).toBeTruthy();
  expect(digitalPackageError({ ...digital, youtubeChapters: '00:00 المقدمة\n00:15 الخبر\n01:24 ختام' })).toBeNull();
  expect(digitalPackageError({ ...digital, youtubeChapters: '00:15 الخبر\n00:12 ختام' })).toBeTruthy();
});

const rules: StylebookRules = {
  terms: [{ term: 'إثر', replacement: 'بعد' }],
  numbers: 'latn', dates: 'dmy', currencies: 'code-after',
};

it('checks Arabic terms and formats real dates and currency without overlapping replacements', () => {
  const text = 'إِثر ٢٠٢٦-١١-٢٢، وصل USD ١٢٫٥٠ واستلمنا ٥ مستندات، وكان التأثير محدوداً.';
  const suggestions = lintStylebook(text, rules).map(({ original, replacement, start, end }) => [text.slice(start, end), original, replacement]);
  expect(suggestions).toEqual([
    ['إِثر', 'إِثر', 'بعد'],
    ['٢٠٢٦-١١-٢٢', '٢٠٢٦-١١-٢٢', '22/11/2026'],
    ['USD ١٢٫٥٠', 'USD ١٢٫٥٠', '12٫50 USD'],
    ['٥', '٥', '5'],
  ]);
});

it('replaces highlighted text in rich copy without changing its markup or inserting HTML', () => {
  const input = '<p class="إثر">إثر <strong>٥</strong></p>';
  const findings = lintStylebookHtml(input, { ...rules, terms: [{ term: 'إثر', replacement: '<بعد>' }] });
  expect(findings.map(finding => finding.original)).toEqual(['إثر', '٥']);
  expect(findings[0].apply()).toBe('<p class="إثر">&lt;بعد&gt; <strong>٥</strong></p>');
});

it('matches terms across inline formatting while leaving quoted attributes and block boundaries intact', () => {
  const phrase = { ...rules, terms: [{ term: 'إثر العاصفة', replacement: 'بعد العاصفة' }] };
  const html = '<p title="أ > إثر العاصفة">إثر <strong>العاصفة</strong></p><p>إثر</p><p>العاصفة</p>';
  const findings = lintStylebookHtml(html, phrase);
  expect(findings.map(finding => finding.original)).toEqual(['إثر العاصفة']);
  expect(findings[0].apply()).toBe('<p title="أ > إثر العاصفة">بعد العاصفة<strong></strong></p><p>إثر</p><p>العاصفة</p>');
});
