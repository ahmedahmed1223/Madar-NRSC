import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpenText, Link2, Printer, Search, X } from 'lucide-react';
import type { User } from '../types';
import { previewWorkspacePage } from '../services/documents/printPreview';
import { GUIDE_CHAPTERS, GUIDE_PARTS, GUIDE_TITLE, ROLE_FAMILIES, roleFamilyOf, type GuideChapter, type GuideEntry } from '../content/userGuide';
import { findGuideTarget, guideSuggestion, searchGuide } from '../shared/userGuideTools';
import { RbacService } from '../services/rbacService';
import { navigateTo, setupCommand, tourCommand } from '../services/uiEvents';
import { toursFor } from '../components/help/TourHost';
import { Highlight } from '../components/common/Highlight';
import { DidYouMean } from '../components/common/SearchHints';
import { EntryLink, GuideBlockView, type GuideActions } from '../components/guide/GuideBlocks';
import { notify } from '../services/notify';
import { countLabel } from '../shared/arabicPlural';
import './guide.css';

interface GuideViewProps {
  currentUser: User;
  /** Chapter or entry in the address (/guide/<id>). */
  focusId?: string | null;
  onFocus: (id: string | null) => void;
}

const anchorId = (id: string) => `guide-${id}`;

/** Who an entry is written for, as role families («يخص: …»). */
function familiesOf(entry: GuideEntry): string {
  if (!entry.roles.length) return '';
  const titles = ROLE_FAMILIES.filter((f) => f.roles.some((r) => entry.roles.includes(r))).map((f) => f.title);
  return titles.length === ROLE_FAMILIES.length ? '' : titles.join('، ');
}

/**
 * «دليل الاستخدام»: the long-form guide (src/content/userGuide.ts) as a reading screen. A table of
 * contents by part (the reader's own role chapter opens first), Arabic-aware search with
 * highlights and «هل تقصد», a comfortable reading column with anchored entries and prev/next, tour
 * and «افتح الشاشة» buttons for what the reader may open, and printing of a chapter or the whole
 * guide.
 */
export const GuideView: React.FC<GuideViewProps> = ({ currentUser, focusId, onFocus }) => {
  const family = roleFamilyOf(currentUser.role);
  const target = findGuideTarget(focusId);
  const chapter: GuideChapter = target?.chapter || GUIDE_CHAPTERS.find((c) => c.id === family.id) || GUIDE_CHAPTERS[0];
  const chapterIndex = GUIDE_CHAPTERS.indexOf(chapter);
  const prev = GUIDE_CHAPTERS[chapterIndex - 1];
  const next = GUIDE_CHAPTERS[chapterIndex + 1];

  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [printing, setPrinting] = useState<'chapter' | 'all' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchGuide(query), [query]);
  const suggestion = useMemo(() => (query.trim() ? guideSuggestion(query, hits.length) : null), [query, hits.length]);
  const resultsOpen = showResults && !!query.trim();
  // Words found by the search stay marked in the text after a result is opened.
  const marked = query.trim() && !printing ? query : '';

  const go = useCallback(
    (id: string) => {
      setShowResults(false);
      onFocus(id);
    },
    [onFocus]
  );

  const tours = useMemo(() => new Set(toursFor(currentUser).map((t) => t.id)), [currentUser]);
  const actions: GuideActions = {
    query: marked,
    canOpen: (screen) => RbacService.canOpenScreen(currentUser, screen),
    canTour: (id) => tours.has(id),
    canSetup: RbacService.hasPermission(currentUser, 'system.settings'),
    openScreen: (path) => navigateTo.emit(path),
    startTour: (id) => tourCommand.emit(id),
    openSetup: () => setupCommand.emit('open'),
    openEntry: (id) => go(id),
  };

  // Bring the entry into view when the address names one; a new chapter starts at its top (only
  // when that top has scrolled away, so the title and the search stay in view on arrival).
  useEffect(() => {
    if (resultsOpen) return;
    const el = document.getElementById(target?.entry ? anchorId(target.entry.id) : 'guide-reading');
    if (!el) return;
    if (!target?.entry && el.getBoundingClientRect().top >= 0) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    if (target?.entry) (el.querySelector('h3, dt') as HTMLElement | null)?.focus({ preventScroll: true });
  }, [focusId, resultsOpen, target?.entry]);

  // Capture the requested chapters before restoring the current reading view.
  useEffect(() => {
    if (!printing) return;
    const frame = window.requestAnimationFrame(() => {
      previewWorkspacePage(printing === 'all' ? GUIDE_TITLE : chapter.title);
      setPrinting(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [printing, chapter.title]);

  const copyLink = async (entry: GuideEntry) => {
    const url = `${window.location.origin}/guide/${encodeURIComponent(entry.id)}`;
    onFocus(entry.id);
    try {
      await navigator.clipboard.writeText(url);
      notify({ type: 'success', message: `نُسخ رابط «${entry.title}»` });
    } catch {
      notify({ type: 'info', message: `رابط القسم: ${url}` });
    }
  };

  const tocLink = (c: GuideChapter, extra?: React.ReactNode) => {
    const active = c.id === chapter.id && !resultsOpen;
    return (
      <li key={c.id}>
        <a
          href={`/guide/${c.id}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            go(c.id);
          }}
          aria-current={active ? 'page' : undefined}
          className={`flex items-center gap-2 min-h-10 px-3 py-1.5 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${
            active ? 'bg-blue-50 text-blue-900 font-bold' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span className="flex-1 min-w-0">{c.title}</span>
          {extra}
        </a>
      </li>
    );
  };

  const chaptersShown = printing === 'all' ? GUIDE_CHAPTERS : [chapter];

  const renderEntry = (c: GuideChapter, entry: GuideEntry) => {
    const forWhom = c.part === 'roles' ? '' : familiesOf(entry);
    return (
      <section key={entry.id} id={anchorId(entry.id)} aria-labelledby={`${anchorId(entry.id)}-title`} className="guide-entry scroll-mt-20 pt-8 first:pt-0">
        <div className="group flex items-start gap-2">
          <h3 id={`${anchorId(entry.id)}-title`} tabIndex={-1} className="flex-1 min-w-0 text-lg font-bold text-slate-900 leading-snug outline-none">
            <Highlight text={entry.title} query={marked} />
          </h3>
          <button
            type="button"
            onClick={() => void copyLink(entry)}
            aria-label={`انسخ رابط «${entry.title}»`}
            title="انسخ رابط هذا القسم"
            className="guide-action shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md text-slate-500 opacity-70 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Link2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {forWhom && <p className="text-xs text-slate-600 mt-1">يخص: {forWhom}</p>}
        <div className="guide-prose mt-4 space-y-4">
          {entry.body.map((block, i) => (
            <GuideBlockView key={i} block={block} actions={actions} />
          ))}
        </div>
      </section>
    );
  };

  const renderChapter = (c: GuideChapter) => {
    const mine = c.id === family.id;
    const glossary = c.part === 'glossary';
    return (
      <article key={c.id} className="guide-chapter" aria-labelledby={`chapter-${c.id}`}>
        <header className="space-y-3 pb-6 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`chapter-${c.id}`} className="text-xl font-bold text-slate-900">
              {c.title}
            </h2>
            {mine && c.part === 'roles' && <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-2xs font-bold">دورك</span>}
          </div>
          <p className="text-base text-slate-700 leading-[1.9]">{c.intro}</p>
          {c.roles && c.roles.length > 0 && (
            <p className="text-xs text-slate-600">
              الأدوار: {c.roles.map((r) => RbacService.getRoleDefinitions().find((d) => d.roleCode === r)?.nameAr || r).join('، ')}
            </p>
          )}
          {mine && c.part === 'roles' && (
            <p className="guide-action text-sm text-slate-700">
              جديد على «مدار»؟ ابدأ من <EntryLink id="start" onOpen={go}>«ابدأ هنا»</EntryLink>.
            </p>
          )}
          {!glossary && c.entries.length > 2 && (
            <nav aria-label={`في فصل ${c.title}`} className="guide-action pt-1">
              <p className="text-xs font-bold text-slate-600 mb-1.5">في هذا الفصل</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {c.entries.map((e) => (
                  <li key={e.id}>
                    <EntryLink id={e.id} onOpen={go}>
                      {e.title}
                    </EntryLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </header>
        {glossary ? (
          <dl className="guide-prose divide-y divide-slate-200">
            {c.entries.map((e) => (
              <div key={e.id} id={anchorId(e.id)} className="guide-entry scroll-mt-20 py-4 sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
                <dt tabIndex={-1} className="font-bold text-slate-900 outline-none">
                  <Highlight text={e.title} query={marked} />
                </dt>
                <dd className="mt-1 sm:mt-0 space-y-3">
                  {e.body.map((block, i) => (
                    <GuideBlockView key={i} block={block} actions={actions} />
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="divide-y divide-slate-200 [&>section]:pb-8 [&>section:last-child]:pb-0 pt-8">{c.entries.map((e) => renderEntry(c, e))}</div>
        )}
      </article>
    );
  };

  return (
    <div className="guide-screen space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BookOpenText className="w-5 h-5 text-blue-600" aria-hidden="true" />
            {GUIDE_TITLE}
          </h1>
          <p className="text-sm text-slate-600 mt-2 max-w-[70ch]">كيف تعمل في «مدار»: حسب دورك، شاشة بشاشة، وخطوة بخطوة، مع المصطلحات والأسئلة الشائعة.</p>
        </div>
        <div className="guide-toolbar flex flex-wrap gap-2 no-print">
          <button
            type="button"
            onClick={() => {
              setShowResults(false);
              setPrinting('chapter');
            }}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            طباعة الفصل
          </button>
          <button
            type="button"
            onClick={() => {
              setShowResults(false);
              setPrinting('all');
            }}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            طباعة الدليل كاملاً
          </button>
        </div>
      </div>

      <div className="guide-search no-print space-y-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setShowResults(true);
          }}
          className="relative"
        >
          <label htmlFor="guide-search-input" className="sr-only">
            بحث في دليل الاستخدام
          </label>
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            ref={searchRef}
            id="guide-search-input"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => query.trim() && setShowResults(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
                setShowResults(false);
              }
            }}
            placeholder="ابحث في الدليل: كلمة أو سؤال…"
            autoComplete="off"
            className="w-full min-h-11 pr-9 pl-10 py-2.5 border border-slate-300 rounded-lg text-sm bg-white placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setShowResults(false);
                searchRef.current?.focus();
              }}
              aria-label="مسح البحث"
              className="absolute left-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </form>
        {query.trim() && !resultsOpen && (
          <p className="text-xs text-slate-600">
            الكلمات التي بحثت عنها مُبرزة في النص.{' '}
            <button type="button" onClick={() => setShowResults(true)} className="min-h-11 sm:min-h-0 font-bold text-blue-700 underline underline-offset-4">
              العودة إلى النتائج ({hits.length})
            </button>
          </p>
        )}
      </div>

      {/* Phones: the contents as one list of chapters. */}
      <div className="guide-toc lg:hidden no-print">
        <label htmlFor="guide-chapter-select" className="block text-xs font-bold text-slate-700 mb-1">
          الفصل
        </label>
        <select id="guide-chapter-select" value={chapter.id} onChange={(e) => go(e.target.value)} className="w-full min-h-11 px-3 border border-slate-300 rounded-lg text-sm bg-white">
          {GUIDE_PARTS.map((part) => (
            <optgroup key={part.id} label={part.title}>
              {GUIDE_CHAPTERS.filter((c) => c.part === part.id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.id === family.id ? ' (دورك)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="guide-layout lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8 items-start">
        <nav aria-label="فهرس الدليل" className="guide-toc hidden lg:block sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pe-1 no-print">
          {GUIDE_PARTS.map((part) => (
            <div key={part.id} className="mb-4">
              <h2 className="px-3 mb-1 text-xs font-bold text-slate-600">{part.title}</h2>
              <ul className="space-y-0.5">
                {GUIDE_CHAPTERS.filter((c) => c.part === part.id).map((c) =>
                  tocLink(c, c.id === family.id ? <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-3xs font-bold shrink-0">دورك</span> : undefined)
                )}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {resultsOpen ? (
            <section aria-labelledby="guide-results-title" className="bg-white border border-slate-200 rounded-xl p-5 sm:p-8">
              <h2 id="guide-results-title" className="text-lg font-bold text-slate-900">
                نتائج البحث عن «{query.trim()}»
              </h2>
              <p className="text-sm text-slate-600 mt-1" role="status">
                {countLabel(hits.length, { zero: 'لا نتائج في الدليل', one: 'نتيجة واحدة', two: 'نتيجتان', few: 'نتائج', many: 'نتيجة' })}.
              </p>
              <DidYouMean
                suggestion={suggestion}
                onPick={(q) => {
                  setQuery(q);
                  setShowResults(true);
                }}
                className="mt-2"
              />
              {hits.length === 0 && <p className="text-sm text-slate-600 mt-3">جرّب كلمة أقل أو مرادفاً، أو تصفّح الفصول من الفهرس.</p>}
              {hits.length > 0 && (
                <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
                  {hits.map((hit) => (
                    <li key={hit.entry.id}>
                      <a
                        href={`/guide/${hit.entry.id}`}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                          e.preventDefault();
                          go(hit.entry.id);
                        }}
                        className="block py-3 px-2 -mx-2 rounded-md hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500"
                      >
                        <span className="block text-base font-bold text-blue-800">
                          <Highlight text={hit.entry.title} query={query} />
                        </span>
                        <span className="block text-xs text-slate-600 mt-0.5">
                          {GUIDE_PARTS.find((p) => p.id === hit.chapter.part)?.title} ← {hit.chapter.title}
                        </span>
                        {hit.snippet && (
                          <span className="block text-sm text-slate-700 mt-1 leading-relaxed">
                            <Highlight text={hit.snippet} query={query} />
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div id="guide-reading" className="guide-reading scroll-mt-20 bg-white border border-slate-200 rounded-xl px-5 py-6 sm:px-10 sm:py-10">
              <div className="max-w-[70ch] space-y-14">{chaptersShown.map(renderChapter)}</div>
              {printing !== 'all' && (
                <nav aria-label="التنقل بين الفصول" className="guide-pager max-w-[70ch] mt-12 pt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {prev ? (
                    <a
                      href={`/guide/${prev.id}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        go(prev.id);
                      }}
                      className="flex items-center gap-3 min-h-14 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50"
                    >
                      <ArrowRight className="w-5 h-5 text-slate-500 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-xs text-slate-600">الفصل السابق</span>
                        <span className="block text-sm font-bold text-slate-900">{prev.title}</span>
                      </span>
                    </a>
                  ) : (
                    <span />
                  )}
                  {next && (
                    <a
                      href={`/guide/${next.id}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        go(next.id);
                      }}
                      className="flex items-center justify-end gap-3 min-h-14 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs text-slate-600">الفصل التالي</span>
                        <span className="block text-sm font-bold text-slate-900">{next.title}</span>
                      </span>
                      <ArrowLeft className="w-5 h-5 text-slate-500 shrink-0" aria-hidden="true" />
                    </a>
                  )}
                </nav>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
