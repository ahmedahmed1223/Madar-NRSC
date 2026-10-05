import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, Tv, Video, Users, CheckSquare, X } from 'lucide-react';
import { ApiService } from '../../services/api';
import { NewsItem, Program, Episode, Guest } from '../../types';
import { statusLabel } from '../../shared/labels';
import { useLiveData } from '../../hooks/useLiveData';

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
  const [groupFilter, setGroupFilter] = useState('');
  const [limit, setLimit] = useState(40);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dataVersion = useLiveData(['news', 'programs', 'episodes', 'guests', 'tasks']);

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    setGroupFilter('');
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
      ...r.news.map((n) => ({ key: `n-${n.id}`, group: 'الأخبار', icon: FileText, tone: 'text-blue-500', title: n.title, meta: n.summary, badge: statusLabel(n.status, 'news'), open: pick(onSelectNews, n.id) })),
      ...r.programs.map((p) => ({ key: `p-${p.id}`, group: 'البرامج', icon: Tv, tone: 'text-emerald-500', title: p.name, meta: [p.presenterName && `تقديم: ${p.presenterName}`, p.producerName && `إنتاج: ${p.producerName}`].filter(Boolean).join(' · '), open: pick(onSelectProgram, p.id) })),
      ...r.episodes.map((e) => ({ key: `e-${e.id}`, group: 'الحلقات', icon: Video, tone: 'text-purple-500', title: e.title, meta: `${e.programName} · حلقة ${e.episodeNumber} · ${e.broadcastDate || ''}`, badge: statusLabel(e.status, 'episode'), open: pick(onSelectEpisode, e.id) })),
      ...r.guests.map((g) => ({ key: `g-${g.id}`, group: 'الضيوف', icon: Users, tone: 'text-amber-500', title: g.fullName, meta: [g.jobTitle, g.organization].filter(Boolean).join(' — '), open: pick(onSelectGuest, g.id) })),
      ...r.tasks.map((t) => ({ key: `t-${t.id}`, group: 'المهام', icon: CheckSquare, tone: 'text-indigo-500', title: t.title, meta: t.assigneeName || t.assignedToName ? `المسند إليه: ${t.assigneeName || t.assignedToName}` : 'غير مسندة', badge: statusLabel(t.status, 'task'), open: pick(onSelectTask, t.id) })),
    ];
  }, [query, dataVersion, onClose, onSelectNews, onSelectProgram, onSelectEpisode, onSelectGuest, onSelectTask]);

  const filteredResults = results.filter(r => !groupFilter || r.group === groupFilter);
  const visibleResults = filteredResults.slice(0, limit);
  useEffect(() => { setActive(0); setLimit(40); }, [query, dataVersion, groupFilter]);
  useEffect(() => {
    document.getElementById(`cmdk-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!isOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' && e.target === inputRef.current) {
      e.preventDefault();
      setActive((i) => (visibleResults.length ? (i + 1) % visibleResults.length : 0));
    } else if (e.key === 'ArrowUp' && e.target === inputRef.current) {
      e.preventDefault();
      setActive((i) => (visibleResults.length ? (i - 1 + visibleResults.length) % visibleResults.length : 0));
    } else if (e.key === 'Enter' && visibleResults[active] && e.target === inputRef.current) {
      e.preventDefault();
      visibleResults[active].open();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('input, button, select');
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 sm:pt-20 p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="fixed inset-0" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="البحث الموحد"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-2xl bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden text-right flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[75vh]"
      >
        <div className="flex items-center px-4 py-3.5 border-b border-slate-200 bg-slate-50/50">
          <Search className="w-5 h-5 text-slate-500 shrink-0 ml-3" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={visibleResults.length > 0}
            aria-controls="cmdk-results"
            aria-activedescendant={visibleResults[active] ? `cmdk-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="بحث في الأخبار والبرامج والحلقات والضيوف والمهام"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث فوري في الأخبار، البرامج، الحلقات، الضيوف، والمهام…"
            className="w-full bg-transparent border-none text-slate-800 text-sm focus:outline-hidden placeholder:text-slate-400"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="مسح البحث" title="مسح البحث" className="w-11 h-11 shrink-0 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-md">
              <X className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="إغلاق البحث" title="إغلاق البحث" className="w-11 h-11 shrink-0 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-md ms-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-slate-100">
          <select aria-label="نوع نتائج البحث" value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="w-full sm:w-auto min-h-11 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700">
            <option value="">كل الأنواع</option>
            {['الأخبار', 'البرامج', 'الحلقات', 'الضيوف', 'المهام'].map(group => <option key={group} value={group}>{group}</option>)}
          </select>
        </div>
        <div className="p-2 overflow-y-auto overscroll-contain min-h-0 flex-1">
          {!query.trim() ? (
            <p className="p-8 text-center text-slate-500 text-xs">اكتب كلمة للبحث في المنظومة الإخبارية كلها</p>
          ) : visibleResults.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm" role="status">
              لا نتائج مطابقة لـ «{query}»
              {groupFilter && <button type="button" onClick={() => { setGroupFilter(''); inputRef.current?.focus(); }} className="block mx-auto mt-3 min-h-11 text-blue-600 font-semibold">البحث في كل الأنواع</button>}
            </div>
          ) : (
            <ul id="cmdk-results" role="listbox" aria-label="نتائج البحث" className="space-y-0.5">
              {visibleResults.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                const Icon = r.icon;
                return (
                  <React.Fragment key={r.key}>
                    {header && (
                      <li role="presentation" className="text-[11px] font-bold text-slate-500 mt-2 mb-1 px-2">
                        {header}
                      </li>
                    )}
                    <li
                      id={`cmdk-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={r.open}
                      className={`p-3 min-h-14 rounded-lg cursor-pointer flex items-center gap-3 ${i === active ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${r.tone}`} aria-hidden />
                      <span className="truncate flex-1 min-w-0">
                        <span className="text-sm font-semibold text-slate-800 block truncate" title={r.title}>{r.title}</span>
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

        {visibleResults.length < filteredResults.length && (
          <button type="button" onClick={() => {
            setLimit(current => current + 40);
            inputRef.current?.focus({ preventScroll: true });
          }} className="min-h-11 px-4 py-2 text-sm font-semibold text-blue-700 border-t border-slate-200 hover:bg-blue-50">
            عرض المزيد من النتائج ({filteredResults.length - visibleResults.length})
          </button>
        )}
        <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span className="hidden sm:inline">↑↓ للتنقل · Enter للفتح · Esc للإغلاق</span>
          <span aria-live="polite">{query.trim() ? `${visibleResults.length} من ${filteredResults.length} نتيجة` : ''}</span>
        </div>
      </div>
    </div>
  );
};
