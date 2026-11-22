import type { Category } from '../types';

export const CATEGORY_HAS_CHILDREN = 'انقل التصنيفات الفرعية إلى تصنيف آخر قبل الحذف';

function groupCategories(categories: Category[]) {
  const parents = new Set(categories.map(category => category.id));
  const children = new Map<string | null, Category[]>();
  for (const category of categories) {
    const parentId = category.parentId && parents.has(category.parentId) ? category.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(category);
    else children.set(parentId, [category]);
  }
  return children;
}

export function categoryTree(categories: Category[]) {
  const groups = groupCategories(categories);
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER));
  }
  const entries: { category: Category; path: string; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (roots: Category[]) => {
    const pending = roots.map(category => ({ category, path: category.nameAr, depth: 0 })).reverse();
    while (pending.length) {
      const entry = pending.pop()!;
      if (seen.has(entry.category.id)) continue;
      seen.add(entry.category.id);
      entries.push(entry);
      const children = groups.get(entry.category.id) || [];
      for (const category of [...children].reverse()) {
        pending.push({ category, path: `${entry.path} / ${category.nameAr}`, depth: entry.depth + 1 });
      }
    }
  };
  visit(groups.get(null) || []);
  // Keep categories from older or inconsistent imports visible and editable.
  if (seen.size < categories.length) visit(categories);
  return entries;
}

export function categoryBranchIds(categories: Category[], id: string) {
  const groups = groupCategories(categories);
  const pending = [id];
  const ids = new Set<string>();
  while (pending.length) {
    const next = pending.pop()!;
    if (ids.has(next)) continue;
    ids.add(next);
    for (const child of groups.get(next) || []) pending.push(child.id);
  }
  return ids;
}

export function resolveCategoryId(categories: Category[], value: string): string {
  if (value === 'ALL' || categories.some(category => category.id === value)) return value;
  return categories.find(category => category.nameAr === value)?.id ?? value;
}

export function categoryParentError(category: Category, categories: Category[]): string | null {
  const byId = new Map(categories.map(item => [item.id, item]));
  const seen = new Set([category.id]);
  let parentId = category.parentId;
  while (parentId != null) {
    if (typeof parentId !== 'string' || !byId.has(parentId)) return 'التصنيف الرئيسي المحدد غير موجود';
    if (seen.has(parentId)) return 'اختر تصنيفاً رئيسياً خارج هذا التصنيف وفروعه';
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return null;
}
