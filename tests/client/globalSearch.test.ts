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

it('ranks title matches first and also finds bulletins and production cards', () => {
  vi.spyOn(ApiService, 'getNews').mockReturnValue([
    { id: 'body', title: 'أخبار الصباح', summary: 'تحدث الوزير عن المؤتمر الصحفي', updatedAt: '2026-11-19T10:00:00Z' },
    { id: 'title', title: 'المؤتمر الصحفي لوزير الخارجية', updatedAt: '2026-11-01T10:00:00Z' },
  ] as any);
  for (const method of ['getPrograms', 'getEpisodes', 'getGuests', 'getTasks'] as const) {
    vi.spyOn(ApiService, method).mockReturnValue([]);
  }
  vi.spyOn(ApiService, 'getBulletins').mockReturnValue([{ id: 'b1', title: 'نشرة المؤتمرات المسائية', date: '2026-11-19', anchors: [] }] as any);
  vi.spyOn(ApiService, 'getCards').mockReturnValue([{ id: 'c1', title: 'تقرير عن مؤتمر المانحين', steps: [] }] as any);
  const r = ApiService.globalSearch('بالمؤتمر');
  expect(r.news.map((n) => n.id)).toEqual(['title', 'body']);
  expect(r.bulletins.map((b) => b.id)).toEqual(['b1']);
  expect(r.cards.map((c) => c.id)).toEqual(['c1']);
});
