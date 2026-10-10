import { describe, expect, it } from 'vitest';
import { saveFeedback, connectionFeedback } from '../src/shared/saveFeedback';

describe('save and connection feedback', () => {
  it('reports pending requests before any saved state', () => {
    expect(saveFeedback(true, 'saved', true)).toBe('جارٍ الحفظ على الخادم...');
    expect(saveFeedback(false, 'saved', true)).toBe('تغييرات غير محفوظة');
    expect(saveFeedback(false, 'saved', false)).toBe('تم الحفظ على الخادم');
    expect(saveFeedback(false, 'failed', true)).toContain('تعديلاتك باقية');
  });
  it('distinguishes device from server without promising every field is stored', () => {
    expect(connectionFeedback(false, false, 0)).toContain('الجهاز');
    expect(connectionFeedback(true, false, 0)).toContain('الخادم');
    expect(connectionFeedback(true, true, 2)).toContain('2');
    expect(connectionFeedback(true, true, 2)).not.toContain('تمت مزامنة');
    expect(connectionFeedback(true, true, 0)).not.toContain('كل التعديلات');
  });
});
