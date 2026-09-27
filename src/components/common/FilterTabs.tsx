import React, { useRef } from 'react';

export type TabTone = 'blue' | 'amber' | 'red' | 'emerald' | 'violet' | 'sky' | 'slate' | 'rose';

export interface FilterTab<K extends string = string> {
  id: K;
  label: string;
  count?: number;
  tone?: TabTone;
  /** Secondary tabs (archive, trash…) sit after a divider. */
  secondary?: boolean;
}

const DOT: Record<TabTone, string> = {
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  sky: 'bg-sky-500',
  slate: 'bg-slate-400',
  rose: 'bg-rose-500',
};
const ACTIVE_COUNT: Record<TabTone, string> = {
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  emerald: 'bg-emerald-100 text-emerald-800',
  violet: 'bg-violet-100 text-violet-800',
  sky: 'bg-sky-100 text-sky-800',
  slate: 'bg-slate-200 text-slate-700',
  rose: 'bg-rose-100 text-rose-700',
};

/**
 * Status filter as one calm segmented bar: a coloured dot per status, the count in a pill
 * (dimmed when empty), secondary views after a divider, all inside one container (wrapping
 * when narrow); on phones it becomes a single dropdown. Arrow keys, Home and End move.
 */
export function FilterTabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
  className = '',
}: {
  tabs: FilterTab<K>[];
  active: K;
  onChange: (id: K) => void;
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const focusTab = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length];
    onChange(t.id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab="${t.id}"]`)?.focus());
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    // Right-to-left: the left arrow moves forward.
    if (e.key === 'ArrowLeft') focusTab(i + 1);
    else if (e.key === 'ArrowRight') focusTab(i - 1);
    else if (e.key === 'Home') focusTab(0);
    else if (e.key === 'End') focusTab(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={className}>
      <label className="sm:hidden block">
        <span className="sr-only">{label}</span>
        <select value={active} onChange={(e) => onChange(e.target.value as K)} className="w-full px-3 py-2.5 bg-white text-sm font-bold text-slate-800">
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.count !== undefined ? ` (${t.count})` : ''}
            </option>
          ))}
        </select>
      </label>

      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="hidden sm:flex flex-wrap items-center gap-0.5 max-w-full w-fit p-1 bg-slate-100 border border-slate-200 rounded-2xl text-xs font-semibold"
      >
        {(() => {
          const renderTab = (t: FilterTab<K>) => {
            const i = tabs.indexOf(t);
            const on = t.id === active;
            const tone = t.tone || 'slate';
            const empty = t.count === 0;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                onClick={() => onChange(t.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl whitespace-nowrap transition-colors ${
                  on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : `text-slate-600 hover:text-slate-900 hover:bg-white/70 ${empty ? 'opacity-70' : ''}`
                }`}
              >
                {t.tone && <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${DOT[tone]}`} />}
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span
                    className={`min-w-5 px-1.5 py-px rounded-full text-[10px] font-bold text-center tabular-nums ${
                      on ? ACTIVE_COUNT[tone] : empty ? 'text-slate-400' : 'bg-slate-200/80 text-slate-700'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          };
          const main = tabs.filter((t) => !t.secondary);
          const more = tabs.filter((t) => t.secondary);
          return (
            <>
              <div role="presentation" className="flex flex-wrap items-center gap-0.5">
                {main.map(renderTab)}
              </div>
              {more.length > 0 && (
                // Secondary views stay together and wrap as one group.
                <div role="presentation" className="flex flex-wrap items-center gap-0.5 border-s border-slate-300 ps-1 ms-0.5">
                  {more.map(renderTab)}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
