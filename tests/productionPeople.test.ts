import { expect, it } from 'vitest';
import { normalizeProductionName, productionPersonError, productionNameSuggestions } from '../src/shared/productionPeople';

const person = { id: 'p1', name: 'أحمد علي', roles: ['PRESENTER'] as const, active: true };
it('validates bounded names, roles, activity and notes', () => {
  expect(productionPersonError(person)).toBeNull();
  for (const change of [{ name: '' }, { name: 'x'.repeat(121) }, { roles: [] }, { roles: ['OTHER'] }, { roles: ['PRESENTER', 'PRESENTER'] }, { active: 'yes' }, { notes: 'x'.repeat(2001) }]) {
    expect(productionPersonError({ ...person, ...change })).toBeTruthy();
  }
});
it('normalizes spacing, case and Arabic marks without changing display text', () => {
  expect(normalizeProductionName('  أَحـمد   علي  ')).toBe(normalizeProductionName('أحمد علي'));
  expect(normalizeProductionName(' Alice ')).toBe('alice');
});
it('inactive or differently classified directory names never leak through account fallback', () => {
  const people: any[] = [{ ...person, active: false }, { ...person, id: 'p2', name: 'سارة', roles: ['DIRECTOR'] }, { ...person, id: 'p3', name: 'ريم', roles: ['PRESENTER', 'DIRECTOR'] }];
  expect(productionNameSuggestions(people, 'PRESENTER', ['أَحمد علي', 'سارة', 'ريم', 'منى', 'منى'])).toEqual(['ريم', 'منى']);
  expect(productionNameSuggestions([], 'PRESENTER', ['منى', 'منى'])).toEqual(['منى']);
});
