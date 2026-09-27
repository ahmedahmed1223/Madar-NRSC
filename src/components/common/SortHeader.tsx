import React, { useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, ArrowUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};

/** Sort column and direction, remembered per screen on this device. */
export function usePersistentSort<K extends string>(storageKey: string, initial: SortState<K>, allowed: readonly K[]) {
  const [sort, setSort] = useState<SortState<K>>(() => {
    const saved = read(storageKey, initial);
    return allowed.includes(saved.key) && (saved.dir === 'asc' || saved.dir === 'desc') ? saved : initial;
  });
  const toggle = (key: K, defaultDir: SortDir = 'asc') => {
    const next: SortState<K> = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir };
    setSort(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Private mode: sorting still works for this visit.
    }
  };
  return [sort, toggle] as const;
}

/** Compares two values for sorting (text in Arabic order, numbers, ISO dates). */
export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ar', { numeric: true, sensitivity: 'base' });
}

export function sortList<T, K extends string>(list: T[], sort: SortState<K>, value: (item: T, key: K) => unknown): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((x, y) => sign * compareValues(value(x, sort.key), value(y, sort.key)));
}

/** A clickable column header that shows and toggles the sort. */
export function SortTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  defaultDir = 'asc',
  className = '',
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K, defaultDir?: SortDir) => void;
  defaultDir?: SortDir;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUpNarrowWide : ArrowDownNarrowWide;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDir)}
        className={`inline-flex items-center gap-1 hover:text-blue-700 ${active ? 'text-blue-700' : ''}`}
        title={`ترتيب حسب ${label}`}
      >
        {label}
        <Icon className={`w-3.5 h-3.5 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  );
}
