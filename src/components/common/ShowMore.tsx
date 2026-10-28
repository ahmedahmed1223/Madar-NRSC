import React, { useEffect, useState } from 'react';

/**
 * Renders a long list a page at a time. After years of work a station holds thousands of guests,
 * tasks, episodes and media items; drawing all of them at once (tens of thousands of DOM nodes)
 * makes the screen slow to open and to scroll. Filters still search the whole list: only the
 * drawing is incremental. The window resets when `resetKey` changes (a new search or filter).
 */
export function useIncremental<T>(items: T[], step = 48, resetKey = '') {
  const [limit, setLimit] = useState(step);
  useEffect(() => setLimit(step), [resetKey, step]);
  return {
    visible: items.length > limit ? items.slice(0, limit) : items,
    remaining: Math.max(0, items.length - limit),
    showMore: () => setLimit((current) => current + step),
    showAll: () => setLimit(items.length),
  };
}

export const ShowMore: React.FC<{ remaining: number; onMore: () => void; onAll?: () => void; noun?: string; className?: string }> = ({ remaining, onMore, onAll, noun = 'عنصر', className = '' }) => {
  if (remaining <= 0) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 py-3 ${className}`}>
      <button type="button" onClick={onMore} className="min-h-11 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
        عرض المزيد ({remaining} {noun} متبقٍ)
      </button>
      {onAll && remaining > 48 && (
        <button type="button" onClick={onAll} className="min-h-11 px-3 rounded-xl text-sm font-semibold text-blue-700 hover:bg-blue-50">
          عرض الكل
        </button>
      )}
    </div>
  );
};
