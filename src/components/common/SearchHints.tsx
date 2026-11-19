import React, { useRef } from 'react';
import { History, Search, X } from 'lucide-react';

/** «هل تقصد: …» as one clickable line. */
export const DidYouMean: React.FC<{ suggestion: string | null | undefined; onPick: (query: string) => void; className?: string }> = ({ suggestion, onPick, className = '' }) => {
  if (!suggestion) return null;
  return (
    <p className={`text-sm text-slate-600 ${className}`}>
      هل تقصد:{' '}
      <button type="button" onClick={() => onPick(suggestion)} className="min-h-11 sm:min-h-8 px-1 font-bold text-blue-700 underline underline-offset-4 hover:text-blue-800">
        {suggestion}
      </button>
      ؟
    </p>
  );
};

export interface SearchHint {
  /** The whole query the chip puts in the box. */
  query: string;
  /** What the chip shows (defaults to the query). */
  label?: string;
  kind: 'completion' | 'recent';
}

interface SearchHintsProps {
  hints: SearchHint[];
  onPick: (query: string) => void;
  /** Clears the recent searches (shown when recent ones are listed). */
  onClearRecent?: () => void;
  /** Focus goes back here on Escape or Arrow-up from the chips. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  id?: string;
  className?: string;
}

/**
 * Suggestions under a search box: completions of the word being typed («اقتراحات») and recent
 * searches («عمليات بحث سابقة»), as plain buttons. Arrow keys move between them, Escape returns to
 * the box. 44px targets on phones.
 */
export const SearchHints: React.FC<SearchHintsProps> = ({ hints, onPick, onClearRecent, inputRef, id, className = '' }) => {
  const groupRef = useRef<HTMLDivElement>(null);
  if (!hints.length) return null;
  const recent = hints.filter((h) => h.kind === 'recent');
  const completions = hints.filter((h) => h.kind === 'completion');

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(groupRef.current?.querySelectorAll<HTMLButtonElement>('button[data-hint]') || [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' && inputRef?.current) {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current.focus();
    } else if (at >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowDown')) {
      e.preventDefault();
      buttons[(at + 1) % buttons.length]?.focus();
    } else if (at >= 0 && e.key === 'ArrowRight') {
      e.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    } else if (at >= 0 && e.key === 'ArrowUp') {
      e.preventDefault();
      if (at === 0 && inputRef?.current) inputRef.current.focus();
      else buttons[at - 1]?.focus();
    }
  };

  const chip = (h: SearchHint) => (
    <button
      key={`${h.kind}:${h.query}`}
      type="button"
      data-hint
      onClick={() => onPick(h.query)}
      className="min-h-11 sm:min-h-8 max-w-full inline-flex items-center gap-1.5 px-3 rounded-full border border-slate-200 bg-white text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      {h.kind === 'recent' ? <History className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden /> : <Search className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden />}
      <span className="truncate">{h.label || h.query}</span>
    </button>
  );

  return (
    <div ref={groupRef} id={id} onKeyDown={onKeyDown} className={`flex flex-col gap-1.5 ${className}`}>
      {completions.length > 0 && (
        <div role="group" aria-label="اقتراحات" className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-bold text-slate-500" aria-hidden>اقتراحات</span>
          {completions.map(chip)}
        </div>
      )}
      {recent.length > 0 && (
        <div role="group" aria-label="عمليات بحث سابقة" className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-bold text-slate-500" aria-hidden>عمليات بحث سابقة</span>
          {recent.map(chip)}
          {onClearRecent && (
            <button type="button" onClick={onClearRecent} aria-label="حذف عمليات البحث السابقة" title="حذف عمليات البحث السابقة" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
