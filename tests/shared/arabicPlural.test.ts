import { describe, expect, it } from 'vitest';
import { AR, countLabel, countWithNumber } from '../../src/shared/arabicPlural';

describe('Arabic number agreement', () => {
  const point = AR.point;
  it('uses whole phrases for one and two', () => {
    expect(countLabel(1, point)).toBe('نقطة واحدة');
    expect(countLabel(2, point)).toBe('نقطتان');
  });
  it('uses the plural from 3 to 10 and the singular from 11', () => {
    expect(countLabel(4, point)).toBe('4 نقاط');
    expect(countLabel(10, point)).toBe('10 نقاط');
    expect(countLabel(11, point)).toBe('11 نقطة');
    expect(countLabel(14, AR.task)).toBe('14 مهمة');
    expect(countLabel(6, AR.hour)).toBe('6 ساعات');
    expect(countLabel(5, AR.blocker)).toBe('5 موانع');
  });
  it('follows the last two digits past a hundred', () => {
    expect(countLabel(103, point)).toBe('103 نقاط');
    expect(countLabel(111, point)).toBe('111 نقطة');
    expect(countLabel(100, point)).toBe('100 نقطة');
  });
  it('says zero with its own phrase when given', () => {
    expect(countLabel(0, point)).toBe('0 نقاط');
    expect(countLabel(0, { ...point, zero: 'لا نقاط' })).toBe('لا نقاط');
  });
  it('keeps the digit for compact cells', () => {
    expect(countWithNumber(1, { one: 'مهمة', two: 'مهمة', few: 'مهام', many: 'مهمة' })).toBe('1 مهمة');
    expect(countWithNumber(7, { one: 'مهمة', two: 'مهمة', few: 'مهام', many: 'مهمة' })).toBe('7 مهام');
  });
});
