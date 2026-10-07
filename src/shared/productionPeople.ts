import { z } from 'zod';

export type ProductionRole = 'PRESENTER' | 'DIRECTOR';
export interface ProductionPerson {
  id: string;
  name: string;
  roles: ProductionRole[];
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
const personSchema = z.object({
  name: z.string().trim().min(1).max(120),
  roles: z.array(z.enum(['PRESENTER', 'DIRECTOR'])).min(1).max(2).refine(roles => new Set(roles).size === roles.length),
  active: z.boolean(),
  notes: z.string().max(2000).optional(),
});
export function productionPersonError(value: unknown): string | null {
  return personSchema.safeParse(value).success ? null : 'الاسم مطلوب حتى 120 حرفاً، مع دور صحيح وحالة تفعيل؛ الملاحظات حتى 2000 حرف';
}
export function normalizeProductionName(name: string): string {
  return name.normalize('NFKC').replace(/[\u0640\u064B-\u065F\u0670]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
export function productionNameSuggestions(people: ProductionPerson[], role: ProductionRole, fallback: string[]): string[] {
  const managed = new Set(people.map(p => normalizeProductionName(p.name)));
  const names = people.filter(p => p.active && p.roles.includes(role)).map(p => p.name);
  const seen = new Set(names.map(normalizeProductionName));
  for (const name of fallback) {
    const key = normalizeProductionName(name);
    if (key && !managed.has(key) && !seen.has(key)) { names.push(name.trim()); seen.add(key); }
  }
  return names.sort((a, b) => a.localeCompare(b, 'ar'));
}
