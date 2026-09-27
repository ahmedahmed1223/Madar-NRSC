import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, Tv, Video, Users, CheckSquare, X } from 'lucide-react';
import { ApiService } from '../../services/api';
import { NewsItem, Program, Episode, Guest } from '../../types';
import { statusLabel } from '../../shared/labels';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNews?: (id: string) => void;
  onSelectProgram?: (id: string) => void;
  onSelectEpisode?: (id: string) => void;
  onSelectGuest?: (id: string) => void;
  onSelectTask?: (id: string) => void;
  onNavigate?: (view: string) => void;
  onQuickCreateNews?: () => void;
  newsList?: NewsItem[];
  programs?: Program[];
  episodes?: Episode[];
  guests?: Guest[];
}

interface Result {
  key: string;
  group: string;
  icon: React.ElementType;
  tone: string;
  title: string;
  meta?: string;
  badge?: string;
  open: () => void;
}

/**
 * Unified search (Ctrl+K) as an accessible dialog: a combobox with a listbox of results.
 * ↑/↓ move, Enter opens, Escape closes from anywhere inside, and focus stays in the dialog.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectNews = () => {},
  onSelectProgram = () => {},
  onSelectEpisode = () => {},
  onSelectGuest = () => {},
  onSelectTask = () => {},
}) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      openerRef.current?.focus?.();
    };
  }, [isOpen]);

  const results: Result[] = useMemo(() => {
    if (!query.trim()) return [];
    const r = ApiService.globalSearch(query);
    const pick = (fn: (id: string) => void, id: string) => () => {
      fn(id);
      onClose();
    };
    return [
      ...r.news.slice(0, 5).map((n) => ({ key: `n-${n.id}`, group: 'الأخبار', icon: FileText, tone: 'text-blue-500', title: n.title, meta: n.summary, badge: statusLabel(n.status, 'news'), open: pick(onSelectNews, n.id) })),
      ...r.programs.slice(0, 3).map((p) => ({ key: `p-${p.id}`, group: 'البرامج', icon: Tv, tone: 'text-emerald-500', title: p.name, meta: [p.presenterName && `تقديم: ${p.presenterName}`, p.producerName && `إنتاج: ${p.producerName}`].filter(Boolean).join(' · '), open: pick(onSelectProgram, p.id) })),
      ...r.episodes.slice(0, 4).map((e) => ({ key: `e-${e.id}`, group: 'الحلقات', icon: Video, tone: 'text-purple-500', title: e.title, meta: `${e.programName} · حلقة ${e.episodeNumber} · ${e.broadcastDate || ''}`, badge: statusLabel(e.status, 'episode'), open: pick(onSelectEpisode, e.id) })),
      ...r.guests.slice(0, 3).map((g) => ({ key: `g-${g.id}`, group: 'الضيوف', icon: Users, tone: 'text-amber-500', title: g.fullName, meta: [g.jobTitle, g.organization].filter(Boolean).join(' — '), open: pick(onSelectGuest, g.id) })),
      ...r.tasks.slice(0, 3).map((t) => ({ key: `t-${t.id}`, group: 'المهام', icon: CheckSquare, tone: 'text-indigo-500', title: t.title, meta: t.assigneeName || t.assignedToName ? `المسند إليه: ${t.assigneeName || t.assignedToName}` : 'غير مسندة', badge: statusLabel(t.status, 'task'), open: pick(onSelectTask, t.id) })),
    ];
  }, [query, onClose, onSelectNews, onSelectProgram, onSelectEpisode, onSelectGuest, onSelectTask]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`cmdk-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!isOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter' && results[active] && e.target === inputRef.current) {
      e.preventDefault();
      results[active].open();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('input, button');
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="fixed inset-0" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="البحث الموحد"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-right flex flex-col max-h-[75vh]"
      >
        <div className="flex items-center px-4 py-3.5 border-b border-slate-200 bg-slate-50/50">
          <Search className="w-5 h-5 text-slate-400 shrink-0 ml-3" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="cmdk-results"
            aria-activedescendant={results[active] ? `cmdk-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="بحث في الأخبار والبرامج والحلقات والضيوف والمهام"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث فوري في الأخبار، البرامج، الحلقات، الضيوف، والمهام…"
            className="w-full bg-transparent border-none text-slate-800 text-sm focus:outline-hidden placeholder:text-slate-400"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="مسح البحث" className="p-1 text-slate-400 hover:text-slate-600 rounded-md">
              <X className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="إغلاق البحث" className="p-1 text-slate-400 hover:text-slate-600 rounded-md ms-1">
            <span className="text-[10px] font-mono border border-slate-300 rounded px-1">Esc</span>
          </button>
        </div>

        <div className="p-2 overflow-y-auto flex-1">
          {!query.trim() ? (
            <p className="p-8 text-center text-slate-400 text-xs">اكتب كلمة للبحث في المنظومة الإخبارية كلها</p>
          ) : results.length === 0 ? (
            <p className="p-8 text-center text-slate-400 text-xs" role="status">
              لا نتائج مطابقة لـ «{query}»
            </p>
          ) : (
            <ul id="cmdk-results" role="listbox" aria-label="نتائج البحث" className="space-y-0.5">
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                const Icon = r.icon;
                return (
                  <React.Fragment key={r.key}>
                    {header && (
                      <li role="presentation" className="text-[11px] font-bold text-slate-400 mt-2 mb-1 px-2">
                        {header}
                      </li>
                    )}
                    <li
                      id={`cmdk-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={r.open}
                      className={`p-2.5 rounded-xl cursor-pointer flex items-center gap-2 ${i === active ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${r.tone}`} aria-hidden />
                      <span className="truncate flex-1 min-w-0">
                        <span className="text-xs font-bold text-slate-800 block truncate">{r.title}</span>
                        {r.meta && <span className="text-[11px] text-slate-500 block truncate">{r.meta}</span>}
                      </span>
                      {r.badge && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium shrink-0">{r.badge}</span>}
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span>↑↓ للتنقل · Enter للفتح · Esc للإغلاق</span>
          <span aria-live="polite">{query.trim() ? `${results.length} نتيجة` : ''}</span>
        </div>
      </div>
    </div>
  );
};
