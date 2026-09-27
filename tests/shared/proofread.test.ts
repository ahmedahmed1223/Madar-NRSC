import { describe, expect, it } from 'vitest';
import { applyFixes, proofread, proofreadHtml } from '../../src/shared/proofread';

describe('Arabic proofreading', () => {
  it('fixes common hamza, taa marbuta and final yaa slips, with prefixes', () => {
    const text = 'اعلنت الحكومه انها ستتوجه الى المنطقه فى الاسبوع المقبل والى الاردن';
    const issues = proofread(text);
    const fixed = applyFixes(text, issues);
    expect(fixed).toBe('أعلنت الحكومة انها ستتوجه إلى المنطقة في الأسبوع المقبل وإلى الأردن');
  });

  it('leaves ambiguous words and director cues alone', () => {
    expect(proofread('قال ان علي سيحضر')).toEqual([]);
    expect(proofread('[كاميرا الى اليسار] مساء الخير')).toEqual([]);
  });

  it('finds repeated words, spacing and Latin punctuation', () => {
    const text = 'قال الوزير في في المؤتمر  الصحفي ,وأضاف  ؟';
    const kinds = proofread(text).map((i) => i.kind);
    expect(kinds).toContain('repeat');
    expect(kinds).toContain('spacing');
    expect(kinds).toContain('punctuation');
    expect(applyFixes(text, proofread(text))).not.toContain('في في');
  });

  it('works on HTML without touching tags or entities', () => {
    const html = '<p>اعلن <strong>الوزير</strong> الى&nbsp;الصحفيين</p><p class="x">في في</p>';
    const r = proofreadHtml(html);
    const fixed = r.fixAll();
    expect(fixed).toContain('<strong>الوزير</strong>');
    expect(fixed).toContain('<p class="x">');
    expect(fixed).toContain('أعلن');
    expect(fixed).toContain('&nbsp;');
  });
});
