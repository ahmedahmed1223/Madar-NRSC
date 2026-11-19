import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { User } from '../../types';
import { RbacService } from '../../services/rbacService';
import { navigateTo, tourCommand } from '../../services/uiEvents';
import { TOURS, type Tour } from '../../content/tours';

const OFFERED_KEY = (userId: string) => `madar-tour-offered:${userId}`;
const PAD = 8;

/** Tours this colleague can take: their role opens the screen and holds the permission. */
export function toursFor(user: User): Tour[] {
  return TOURS.filter((t) => (!t.screen || RbacService.canOpenScreen(user, t.screen)) && (!t.permission || RbacService.hasPermission(user, t.permission)));
}

/** First visible element matching a selector list (the same control may exist for phone and desktop). */
function findTarget(selector?: string): HTMLElement | null {
  if (!selector) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/**
 * Runs the interactive tours: a dimmed screen with a window around the control being explained and
 * a card beside it. Keyboard: arrows move, Escape ends. On the first sign-in it offers the basic
 * tour once.
 */
export const TourHost: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [tour, setTour] = useState<Tour | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [offer, setOffer] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const start = useCallback((id: string) => {
    const next = TOURS.find((t) => t.id === id);
    if (!next) return;
    opener.current = document.activeElement as HTMLElement | null;
    setOffer(false);
    setIndex(0);
    setTour(next);
  }, []);
  const end = useCallback(() => {
    setTour(null);
    setRect(null);
    requestAnimationFrame(() => opener.current?.focus?.());
  }, []);

  useEffect(() => tourCommand.on(start), [start]);

  // Offer the basic tour once, a moment after the first sign-in on this device.
  useEffect(() => {
    // Automated browsers (tests, monitoring) are never offered the tour.
    if (navigator.webdriver) return;
    let offered = true;
    try {
      offered = localStorage.getItem(OFFERED_KEY(currentUser.id)) === '1';
    } catch {
      // Storage blocked: never nag.
    }
    if (offered) return;
    const t = window.setTimeout(() => setOffer(true), 1500);
    return () => window.clearTimeout(t);
  }, [currentUser.id]);
  const closeOffer = () => {
    setOffer(false);
    try {
      localStorage.setItem(OFFERED_KEY(currentUser.id), '1');
    } catch {
      // Lasts for this visit.
    }
  };

  const step = tour?.steps[index];

  // Open the step's screen, then find its control (screens load lazily, so look for a moment).
  useEffect(() => {
    if (!step) return;
    if (step.nav && window.location.pathname !== step.nav) navigateTo.emit(step.nav);
    setRect(null);
    let tries = 0;
    let frame = 0;
    const look = () => {
      const el = findTarget(step.target);
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
        return;
      }
      if (step.target && tries++ < 40) frame = window.setTimeout(look, 50) as unknown as number;
    };
    look();
    return () => window.clearTimeout(frame);
  }, [step]);

  // Follow the control while the page scrolls or resizes.
  useEffect(() => {
    if (!step?.target) return;
    const follow = () => {
      const el = findTarget(step.target);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [step]);

  // Keyboard and focus.
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        end();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.min(tour.steps.length - 1, i + 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [tour, end]);
  useLayoutEffect(() => {
    if (tour) cardRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true });
  }, [tour, index]);

  if (!tour || !step) {
    if (!offer) return null;
    return (
      <section aria-labelledby="tour-offer-title" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-5 sm:w-96 z-[60] bg-white border border-slate-200 rounded-xl shadow-xl p-4 space-y-3">
        <h2 id="tour-offer-title" className="strap text-base">جولة سريعة على «مدار»؟</h2>
        <p className="text-sm text-slate-700 leading-6">دقيقة واحدة تعرّفك بالقائمة والبحث والإشعارات والمراسلات. تجدها لاحقاً في «المساعدة».</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => { closeOffer(); start('basics'); }} className="min-h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold">
            ابدأ الجولة
          </button>
          <button type="button" onClick={closeOffer} className="min-h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
            لاحقاً
          </button>
        </div>
      </section>
    );
  }

  const last = index === tour.steps.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const phone = vw < 640;
  const hole = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;
  // The card sits below the control when there is room, otherwise above; on phones it is a bottom sheet.
  const cardStyle: React.CSSProperties = (() => {
    if (!hole || phone) return {};
    const width = Math.min(380, vw - 32);
    const left = Math.max(16, Math.min(vw - width - 16, hole.left + hole.width / 2 - width / 2));
    const below = hole.top + hole.height + 12;
    return below + 220 < vh ? { top: below, left, width } : { bottom: vh - hole.top + 12, left, width };
  })();

  return (
    <div className="fixed inset-0 z-[70]" aria-live="polite">
      {hole ? (
        <div
          aria-hidden="true"
          className="tour-hole fixed rounded-lg pointer-events-none"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-slate-950/55" />
      )}
      {/* Clicks outside the card do nothing: the tour ends only by choice. */}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        style={cardStyle}
        className={`fixed bg-white border border-slate-200 rounded-xl shadow-xl p-4 space-y-3 ${
          phone ? 'inset-x-3 bottom-3' : hole ? '' : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(26rem,calc(100vw-2rem))]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="tour-step-title" className="strap text-base">{step.title}</h2>
          <button type="button" onClick={end} aria-label="إنهاء الجولة" className="shrink-0 min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p id="tour-step-body" className="text-sm text-slate-700 leading-6">{step.body}</p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-2xs text-slate-500 tabular-nums">
            {tour.title} · {index + 1} من {tour.steps.length}
          </span>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" onClick={() => setIndex(index - 1)} className="min-h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1">
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                السابق
              </button>
            )}
            <button
              type="button"
              data-primary
              onClick={() => (last ? end() : setIndex(index + 1))}
              className="min-h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1"
            >
              {last ? 'إنهاء' : 'التالي'}
              {!last && <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
