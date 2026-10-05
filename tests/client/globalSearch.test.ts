import { afterEach, expect, it, vi } from 'vitest';
import { ApiService } from '../../src/services/api';

afterEach(() => vi.restoreAllMocks());

it('finds Arabic words across fields regardless of accents and order', () => {
  vi.spyOn(ApiService, 'getNews').mockReturnValue([
    { id: 'one', title: 'القِمّة الاقتصادية', locationName: 'إسطنبول', keywords: ['٢٠٢٦'] },
    { id: 'two', title: 'أخبار الرياضة' },
  ] as any);
  for (const method of ['getPrograms', 'getEpisodes', 'getGuests', 'getTasks'] as const) {
    vi.spyOn(ApiService, method).mockReturnValue([]);
  }
  expect(ApiService.globalSearch('2026 اسطنبول القمه').news.map(n => n.id)).toEqual(['one']);
  expect(ApiService.globalSearch('القمه الرياضة').news).toEqual([]);
});
