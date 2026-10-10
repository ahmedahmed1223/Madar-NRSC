import { expect, it } from 'vitest';
import { matchingPronunciations } from '../src/shared/pronunciation';
import { offlineAirPacketSchema } from '../src/shared/offlineAir';
it('matches Arabic words but not embedded substrings and leaves script unchanged', () => {
  const script = 'أَحْمَد، يقدم الخبر من عمان. أعمال مختلفة.';
  const term = (name: string, enabled = true) => ({ id: name, term: name, pronunciation: name, note: '', enabled });
  expect(matchingPronunciations(script, [term('احمد'), term('عمان'), term('عمل'), term('الخبر', false)])).toHaveLength(2);
  expect(matchingPronunciations(script, [term('احمد'), term('احمد')])).toHaveLength(1);
  expect(matchingPronunciations('احمد عمان', [term('احمد'), term('عمان')], 1)).toHaveLength(1);
  expect(script).toBe('أَحْمَد، يقدم الخبر من عمان. أعمال مختلفة.');
  const terms = Array.from({ length: 201 }, (_, i) => term(`اسم${i}`));
  expect(matchingPronunciations(terms.map(t => t.term).join(' '), terms)).toHaveLength(200);
});
it('bounds offline reference notes independently of legacy packets', () => {
  const field = offlineAirPacketSchema.shape.pronunciationNotes;
  expect(field.safeParse(undefined).success).toBe(true);
  expect(field.safeParse(Array.from({ length: 200 }, () => ({ term: 'اسم', pronunciation: 'نطق', note: '' }))).success).toBe(true);
  expect(field.safeParse(Array.from({ length: 201 }, () => ({ term: 'اسم', pronunciation: 'نطق', note: '' }))).success).toBe(false);
  for (const [key, max] of [['term', 200], ['pronunciation', 300], ['note', 1000]] as const) expect(field.safeParse([{ term: 'اسم', pronunciation: 'نطق', note: '', [key]: 'x'.repeat(max + 1) }]).success).toBe(false);
});
