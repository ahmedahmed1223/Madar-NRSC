import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, Tv, Video, Users, CheckSquare, X } from 'lucide-react';
import { ApiService } from '../../services/api';
import { NewsItem, Program, Episode, Guest, EditorialTask } from '../../types';

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

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectNews = (_id: string) => {},
  onSelectProgram = (_id: string) => {},
  onSelectEpisode = (_id: string) => {},
  onSelectGuest = (_id: string) => {},
  onSelectTask = (_id: string) => {},
  onNavigate,
  onQuickCreateNews,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    news: NewsItem[];
    programs: Program[];
    episodes: Episode[];
    guests: Guest[];
    tasks: EditorialTask[];
  }>({
    news: [],
    programs: [],
    episodes: [],
    guests: [],
    tasks: [],
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults({ news: [], programs: [], episodes: [], guests: [], tasks: [] });
    }
  }, [isOpen]);

  useEffect(() => {
    if (query.trim().length >= 1) {
      const res = ApiService.globalSearch(query);
      setResults(res);
    } else {
      setResults({ news: [], programs: [], episodes: [], guests: [], tasks: [] });
    }
  }, [query]);

  if (!isOpen) return null;

  const totalResults =
    results.news.length +
    results.programs.length +
    results.episodes.length +
    results.guests.length +
    results.tasks.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="fixed inset-0" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-right flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-200 bg-slate-50/50">
          <Search className="w-5 h-5 text-slate-400 shrink-0 ml-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="بحث فوري في الأخبار، البرامج، الحلقات، الضيوف، والمهام (Ctrl + K)..."
            className="w-full bg-transparent border-none text-slate-800 text-sm focus:outline-hidden placeholder:text-slate-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results List */}
        <div className="p-2 overflow-y-auto divide-y divide-slate-100 flex-1">
          {query.trim().length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              اكتب كلمة للبحث في الأرشيف والمنظومة الإخبارية الكاملة
            </div>
          ) : totalResults === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              لم يتم العثور على أي نتائج مطابقة لـ "{query}"
            </div>
          ) : (
            <div className="space-y-4 p-2">
              {/* News */}
              {results.news.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                    <span>الأخبار والتقارير ({results.news.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.news.slice(0, 4).map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          onSelectNews(n.id);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div className="truncate flex-1">
                          <span className="text-xs font-bold text-slate-800">{n.title}</span>
                          <span className="text-[11px] text-slate-400 block truncate">{n.summary}</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                          {n.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Programs */}
              {results.programs.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
                    <Tv className="w-3.5 h-3.5 text-emerald-500" />
                    <span>البرامج التلفزيونية ({results.programs.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.programs.slice(0, 3).map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          onSelectProgram(p.id);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div className="truncate flex-1">
                          <span className="text-xs font-bold text-slate-800">{p.name}</span>
                          <span className="text-[11px] text-slate-400 block truncate">
                            تقديم: {p.presenterName} | إنتاج: {p.producerName}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Episodes */}
              {results.episodes.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5 text-purple-500" />
                    <span>حلقات البرامج ({results.episodes.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.episodes.slice(0, 3).map((e) => (
                      <div
                        key={e.id}
                        onClick={() => {
                          onSelectEpisode(e.id);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div className="truncate flex-1">
                          <span className="text-xs font-bold text-slate-800">{e.title}</span>
                          <span className="text-[11px] text-slate-400 block truncate">
                            برنامج {e.programName} | حلقة {e.episodeNumber}
                          </span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">
                          {e.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Guests */}
              {results.guests.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-amber-500" />
                    <span>الضيوف والخبراء ({results.guests.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.guests.slice(0, 3).map((g) => (
                      <div
                        key={g.id}
                        onClick={() => {
                          onSelectGuest(g.id);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div className="truncate flex-1">
                          <span className="text-xs font-bold text-slate-800">{g.fullName}</span>
                          <span className="text-[11px] text-slate-400 block truncate">
                            {g.jobTitle} - {g.organization}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks */}
              {results.tasks.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-2 flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-indigo-500" />
                    <span>المهام التحريرية ({results.tasks.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.tasks.slice(0, 3).map((t) => (
                      <div
                        key={t.id}
                        onClick={() => {
                          onSelectTask(t.id);
                          onClose();
                        }}
                        className="p-2.5 rounded-xl hover:bg-slate-100 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div className="truncate flex-1">
                          <span className="text-xs font-bold text-slate-800">{t.title}</span>
                          <span className="text-[11px] text-slate-400 block truncate">
                            المسند إليه: {t.assigneeName} | الحالة: {t.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>اضغط ESC للإغلاق</span>
          <span>نظام البحث الموحد للمحطة</span>
        </div>
      </div>
    </div>
  );
};
