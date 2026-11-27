import { describe, expect, it } from 'vitest';
import { remapPrompterReadingPosition } from '../../src/shared/prompterControls';

describe('same-segment prompter corrections', () => {
  const old = 'بدأت النشرة الآن. الجملة الحالية تبقى في موضعها. وتأتي الجملة التالية بعد قليل.';
  const anchor = old.indexOf('تبقى');

  it('follows the same words after an edit to an already read sentence', () => {
    const current = old.replace('بدأت النشرة الآن.', 'بدأت نشرتنا المطوّلة على الهواء قبل قليل.');
    expect(remapPrompterReadingPosition(old, current, anchor)).toEqual({
      offset: current.indexOf('تبقى'),
      amendedPastSentence: true,
    });
  });

  it('does not flag a current-sentence correction as already read', () => {
    const current = old.replace('الجملة الحالية', 'العبارة الحالية المصححة');
    expect(remapPrompterReadingPosition(old, current, anchor)).toEqual({
      offset: current.indexOf('تبقى'),
      amendedPastSentence: false,
    });
  });

  it('keeps the same cursor when only future text changes', () => {
    const current = old.replace('تأتي الجملة التالية بعد قليل', 'تُقرأ الفقرة المقبلة أولًا');
    expect(remapPrompterReadingPosition(old, current, anchor)).toEqual({ offset: anchor, amendedPastSentence: false });
  });

  it('finds a stable reading anchor between two separate corrections', () => {
    const current = old.replace('بدأت النشرة الآن.', 'تتابعون نشرتنا.').replace('بعد قليل', 'بعد الفاصل');
    expect(remapPrompterReadingPosition(old, current, anchor)).toEqual({
      offset: current.indexOf('تبقى'),
      amendedPastSentence: true,
    });
  });
});
