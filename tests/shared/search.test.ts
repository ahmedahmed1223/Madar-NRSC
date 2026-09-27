import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeArabic } from '../../src/shared/search';
import { compareValues, sortList } from '../../src/components/common/SortHeader';
import { moveInArray } from '../../src/components/dnd/Sortable';

describe('Arabic-aware search', () => {
  it('ignores hamza forms, taa marbuta, alef maqsura, diacritics and tatweel', () => {
    expect(normalizeArabic('أحمد إبراهيم آمنة')).toBe('احمد ابراهيم امنه');
    expect(normalizeArabic('مُصْطَفَى')).toBe('مصطفي');
    expect(normalizeArabic('الـــقمة ٢٠٢٦')).toBe('القمه 2026');
  });

  it('matches every word across fields, in any order, and survives missing fields', () => {
    expect(matchesQuery('احمد التحرير', 'أحمد المنصوري', undefined, 'غرفة التحرير')).toBe(true);
    expect(matchesQuery('احمد الرياضة', 'أحمد المنصوري', 'غرفة التحرير')).toBe(false);
    expect(matchesQuery('  ', null)).toBe(true);
    expect(matchesQuery('القمة', ['وسم', 'القمه الاقتصادية'])).toBe(true);
  });
});

describe('sorting', () => {
  it('orders Arabic text, numbers and empty values sensibly', () => {
    expect(['ب', 'أ', 'ت'].sort(compareValues)).toEqual(['أ', 'ب', 'ت']);
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues(undefined, 'a')).toBeGreaterThan(0);
    const rows = [{ n: 'ب', v: 2 }, { n: 'أ', v: 3 }, { n: 'ت', v: 1 }];
    expect(sortList(rows, { key: 'v', dir: 'desc' }, (r, k) => (r as any)[k]).map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it('moves an item to a new position', () => {
    expect(moveInArray(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInArray(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveInArray(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
  });
});
