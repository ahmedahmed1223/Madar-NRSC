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
    expect(connectionFeedback(false, false, 0)).toContain('غير متصل');
    expect(connectionFeedback(false, false, 3)).toBe('غير متصل — 3 تغييرات بانتظار الإرسال');
    expect(connectionFeedback(false, true, 1)).toBe('غير متصل — تغيير واحد بانتظار الإرسال');
    expect(connectionFeedback(true, false, 0)).toContain('الخادم');
    expect(connectionFeedback(true, true, 2)).toContain('تغييران');
    expect(connectionFeedback(true, true, 5)).toContain('5 تغييرات');
    expect(connectionFeedback(true, true, 2)).not.toContain('تمت مزامنة');
    expect(connectionFeedback(true, true, 0)).not.toContain('كل التعديلات');
  });
});
