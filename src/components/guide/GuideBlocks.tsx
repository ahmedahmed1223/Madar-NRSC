import React from 'react';
import { AlertTriangle, ExternalLink, Lightbulb, PlayCircle, Settings2 } from 'lucide-react';
import type { GuideBlock } from '../../content/userGuide';
import { Highlight } from '../common/Highlight';
import { guideEntry, guideScreenName, guideScreenPath, tourTitle } from '../../shared/userGuideTools';

export interface GuideActions {
  /** Highlighted words (the guide search). */
  query: string;
  canOpen: (screen: string) => boolean;
  canTour: (tour: string) => boolean;
  canSetup: boolean;
  openScreen: (path: string) => void;
  startTour: (tour: string) => void;
  openSetup: () => void;
  /** Opens another entry of the guide. */
  openEntry: (id: string) => void;
}

/** Small controls of the reading view: hidden on paper (see src/views/guide.css). */
const ACTION = 'guide-action inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-3 rounded-lg border text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
const OPEN = `${ACTION} border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-blue-50`;
const TRY = `${ACTION} border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100`;

const T: React.FC<{ text: string; q: string }> = ({ text, q }) => <Highlight text={text} query={q} />;

/** A link to another entry; prints as text. */
export const EntryLink: React.FC<{ id: string; onOpen: (id: string) => void; children?: React.ReactNode }> = ({ id, onOpen, children }) => (
  <a
    href={`/guide/${encodeURIComponent(id)}`}
    onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      onOpen(id);
    }}
    className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:decoration-blue-700"
  >
    {children ?? guideEntry(id)?.title ?? id}
  </a>
);

/** One block of an entry. */
export const GuideBlockView: React.FC<{ block: GuideBlock; actions: GuideActions }> = ({ block, actions }) => {
  const q = actions.query;
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <T text={block.text} q={q} />
        </p>
      );
    case 'sub':
      return (
        <h4 className="text-base font-bold text-slate-900 pt-2">
          <T text={block.text} q={q} />
        </h4>
      );
    case 'steps':
      return (
        <ol className="guide-steps space-y-3">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden="true" className="guide-step-number mt-0.5 w-7 h-7 shrink-0 rounded-full bg-slate-900 text-white text-xs font-bold tabular-nums flex items-center justify-center">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="sr-only">الخطوة {i + 1}: </span>
                <T text={item} q={q} />
              </span>
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className="list-disc ps-6 space-y-2 marker:text-slate-400">
          {block.items.map((item, i) => (
            <li key={i}>
              <T text={item} q={q} />
            </li>
          ))}
        </ul>
      );
    case 'tip':
    case 'warning': {
      const warning = block.kind === 'warning';
      const Icon = warning ? AlertTriangle : Lightbulb;
      return (
        <aside className={`guide-callout flex gap-3 rounded-lg border p-4 ${warning ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
          <Icon className={`w-5 h-5 shrink-0 mt-1 ${warning ? 'text-amber-700' : 'text-blue-700'}`} aria-hidden="true" />
          <p className="min-w-0">
            <strong className={warning ? 'text-amber-900' : 'text-blue-900'}>{warning ? 'تنبيه: ' : 'نصيحة: '}</strong>
            <T text={block.text} q={q} />
          </p>
        </aside>
      );
    }
    case 'screen': {
      if (!actions.canOpen(block.screen)) return null;
      const name = guideScreenName(block.screen);
      return (
        <p>
          <button type="button" onClick={() => actions.openScreen(guideScreenPath(block))} className={OPEN}>
            <ExternalLink className="w-4 h-4 text-blue-700" aria-hidden="true" />
            {block.label || `افتح الشاشة: «${name}»`}
          </button>
        </p>
      );
    }
    case 'screens':
      return (
        <ul className="divide-y divide-slate-200 border-y border-slate-200">
          {block.items.map((item) => {
            const name = guideScreenName(item.screen);
            const allowed = actions.canOpen(item.screen);
            return (
              <li key={item.screen} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="flex-1 min-w-0">
                  <strong className="text-slate-900">
                    «<T text={name} q={q} />»
                  </strong>{' '}
                  <span className="text-slate-700">
                    — <T text={item.text} q={q} />
                  </span>
                  {!allowed && <span className="guide-action block text-2xs text-slate-500 mt-0.5">ليست ضمن صفحات دورك.</span>}
                </span>
                {allowed && (
                  <button type="button" onClick={() => actions.openScreen(`/${item.screen}`)} aria-label={`افتح الشاشة: ${name}`} className={`${OPEN} self-start sm:self-auto`}>
                    <ExternalLink className="w-4 h-4 text-blue-700" aria-hidden="true" />
                    افتح
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      );
    case 'tour':
      if (!actions.canTour(block.tour)) return null;
      return (
        <p>
          <button type="button" onClick={() => actions.startTour(block.tour)} className={TRY}>
            <PlayCircle className="w-4 h-4" aria-hidden="true" />
            جرّب الجولة: «{tourTitle(block.tour)}»
          </button>
        </p>
      );
    case 'setup':
      if (!actions.canSetup) return null;
      return (
        <p>
          <button type="button" onClick={actions.openSetup} className={TRY}>
            <Settings2 className="w-4 h-4" aria-hidden="true" />
            افتح الإعداد السريع
          </button>
        </p>
      );
    case 'see':
      return (
        <p className="text-slate-700">
          <span className="font-semibold">اقرأ أيضاً: </span>
          {block.entries.map((id, i) => (
            <React.Fragment key={id}>
              {i > 0 && '، '}
              <EntryLink id={id} onOpen={actions.openEntry} />
            </React.Fragment>
          ))}
        </p>
      );
  }
};
