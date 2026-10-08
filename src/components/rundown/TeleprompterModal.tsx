import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  Type,
  ChevronRight,
  ChevronLeft,
  Clock,
  FlipHorizontal,
} from 'lucide-react';
import { RundownSegment } from '../../types';
import { formatSecondsToTime } from '../../shared/rundown';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { prompterScrollDelta, prompterShortcut } from '../../shared/prompterControls';

interface TeleprompterModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: RundownSegment[];
  episodeTitle?: string;
  /** While this episode is on air, the prompter follows the director's current segment. */
  episodeId?: string;
}

export const TeleprompterModal: React.FC<TeleprompterModalProps> = ({
  isOpen,
  onClose,
  segments,
  episodeTitle = 'الرانداون المباشر',
  episodeId,
}) => {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [followDirector, setFollowDirector] = useState(true);
  const liveVersion = useLiveData(['onAir'], 0);
  const liveSegmentId = episodeId ? apiService.getOnAir(episodeId) : null;
  const followId = liveSegmentId?.status === 'LIVE' ? liveSegmentId.currentSegmentId : null;
  useEffect(() => {
    if (!isOpen || !followId || !followDirector) return;
    const idx = segments.findIndex((s) => s.id === followId);
    if (idx >= 0) setCurrentSegmentIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followId, isOpen, liveVersion, followDirector, segments]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(48); // pixels per second
  const [fontSize, setFontSize] = useState(36); // px
  const [isMirrored, setIsMirrored] = useState(false);
  const [colorTheme, setColorTheme] = useState<'yellow' | 'white' | 'cyan'>('yellow');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [displayError, setDisplayError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const activeSegment = segments[currentSegmentIndex] || segments[0];
  useEffect(() => {
    if (currentSegmentIndex >= segments.length) setCurrentSegmentIndex(Math.max(0, segments.length - 1));
  }, [currentSegmentIndex, segments.length]);

  // Timer for elapsed reading time
  useEffect(() => {
    let timer: any = null;
    if (isPlaying && isOpen) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, isOpen]);

  // Smooth auto-scroll loop
  useEffect(() => {
    let previous: number | null = null;
    const scrollStep = (now: number) => {
      if (isPlaying && isOpen && scrollContainerRef.current) {
        const el = scrollContainerRef.current;
        el.scrollTop += prompterScrollDelta(scrollSpeed, previous === null ? 0 : now - previous);
        previous = now;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setIsPlaying(false); return; }
      }
      animationFrameRef.current = requestAnimationFrame(scrollStep);
    };

    if (isPlaying && isOpen) {
      animationFrameRef.current = requestAnimationFrame(scrollStep);
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, scrollSpeed, isOpen]);

  // Closing the prompter must stop the scroll loop (it would otherwise keep running hidden).
  useEffect(() => {
    if (!isOpen) setIsPlaying(false);
  }, [isOpen]);

  // Reset scroll and timer on segment change
  const handleSelectSegment = (idx: number) => {
    if (idx < 0 || idx >= segments.length) return;
    setFollowDirector(false);
    setIsPlaying(false);
    setCurrentSegmentIndex(idx);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setElapsedSeconds(0);
  };

  const handleResetScroll = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setElapsedSeconds(0);
    setIsPlaying(false);
  };

  const handleTogglePlay = () => {
    setIsPlaying((prev) => !prev);
  };
  const handleClose = () => {
    if (document.fullscreenElement === modalRef.current) void document.exitFullscreen().catch(() => {});
    onClose();
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === modalRef.current) await document.exitFullscreen();
      else if (modalRef.current?.requestFullscreen) await modalRef.current.requestFullscreen();
      else throw new Error();
      setDisplayError('');
    } catch { setDisplayError('تعذر ملء الشاشة في هذا المتصفح'); }
  };
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === modalRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    scrollContainerRef.current?.focus();
    const hidden = () => { if (document.hidden) setIsPlaying(false); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [isOpen]);
  useEffect(() => {
    setIsPlaying(false);
    setElapsedSeconds(0);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [activeSegment?.id]);

  // Keyboard controls: Space to play/pause, Arrows to switch segment
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Tab') {
        const items = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') || []).filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        return;
      }
      const target = e.target as HTMLElement;
      const action = prompterShortcut({ key: e.key, tagName: target.tagName, editable: target.isContentEditable, composing: e.isComposing, modified: e.ctrlKey || e.metaKey || e.altKey });
      if (!action) return;
      e.preventDefault(); e.stopPropagation();
      if (e.repeat && ['PLAY', 'FULLSCREEN', 'MIRROR', 'CLOSE'].includes(action)) return;
      if (action === 'FASTER') setScrollSpeed(s => Math.min(180, s + 6));
      if (action === 'SLOWER') setScrollSpeed(s => Math.max(6, s - 6));
      if (action === 'LARGER') setFontSize(f => Math.min(72, f + 2));
      if (action === 'SMALLER') setFontSize(f => Math.max(22, f - 2));
      if (action === 'RESET') handleResetScroll();
      if (action === 'FULLSCREEN') void toggleFullscreen();
      if (action === 'MIRROR') setIsMirrored(m => !m);
      if (action === 'PAGE_UP' || action === 'PAGE_DOWN') {
        setIsPlaying(false);
        const el = scrollContainerRef.current;
        if (el) el.scrollBy({ top: el.clientHeight * 0.75 * (action === 'PAGE_DOWN' ? 1 : -1) });
      }
      if (action === 'PLAY' && activeSegment) {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (action === 'PREVIOUS') {
        e.preventDefault();
        if (currentSegmentIndex > 0) {
          handleSelectSegment(currentSegmentIndex - 1);
        }
      } else if (action === 'NEXT') {
        e.preventDefault();
        if (currentSegmentIndex < segments.length - 1) {
          handleSelectSegment(currentSegmentIndex + 1);
        }
      } else if (action === 'CLOSE') {
        handleClose();
      }
    };

    const el = modalRef.current;
    el?.addEventListener('keydown', handleKeyDown);
    return () => el?.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentSegmentIndex, segments.length, onClose]);

  if (!isOpen) return null;

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const themeTextColor = {
    yellow: 'text-amber-300',
    white: 'text-white',
    cyan: 'text-cyan-300',
  }[colorTheme];

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="الملقّن" className="theme-fixed fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-amber-300" dir="rtl">
      {/* Studio Prompter Top Bar */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-700 flex flex-wrap gap-3 items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1 basis-full md:basis-auto">
          <span className="px-2.5 py-1 bg-red-600 text-white font-mono text-xs font-bold rounded-md">
            الملقّن
          </span>
          <div className="min-w-0 truncate">
            <h2 className="text-sm font-bold text-slate-100">{episodeTitle}</h2>
            <div className="text-xs text-zinc-300">
              الفقرة {currentSegmentIndex + 1} من {segments.length}: {activeSegment?.title || 'فقرة مجهولة'}
            </div>
          </div>
        </div>

        {/* Prompter Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Color theme switch */}
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-700">
            <button
              type="button"
              onClick={() => setColorTheme('yellow')}
              className={`w-6 h-6 rounded-md bg-amber-400 ${colorTheme === 'yellow' ? 'ring-2 ring-white' : 'opacity-70'}`}
              title="أصفر استوديو كلاسيكي"
              aria-label="لون النص أصفر" aria-pressed={colorTheme === 'yellow'}
            />
            <button
              type="button"
              onClick={() => setColorTheme('white')}
              className={`w-6 h-6 rounded-md bg-white ${colorTheme === 'white' ? 'ring-2 ring-blue-500' : 'opacity-70'}`}
              title="أبيض عالي التباين"
              aria-label="لون النص أبيض" aria-pressed={colorTheme === 'white'}
            />
            <button
              type="button"
              onClick={() => setColorTheme('cyan')}
              className={`w-6 h-6 rounded-md bg-cyan-400 ${colorTheme === 'cyan' ? 'ring-2 ring-white' : 'opacity-70'}`}
              title="سماوي هادئ"
              aria-label="لون النص سماوي" aria-pressed={colorTheme === 'cyan'}
            />
          </div>

          {/* Mirror Toggle (for physical hardware prompters) */}
          <button
            type="button"
            onClick={() => setIsMirrored(!isMirrored)}
            className={`p-2 rounded-lg transition-colors ${
              isMirrored ? 'bg-amber-700 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
            title={isMirrored ? 'إلغاء وضع المرآة للزجاج' : 'تفعيل وضع المرآة لعاكس الكاميرا'}
            aria-label="المرآة (M)" aria-pressed={isMirrored}
          >
            <FlipHorizontal className="w-4 h-4" />
          </button>

          {/* Font Size Controls */}
          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <Type className="w-3.5 h-3.5 text-slate-500" />
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.max(22, f - 4))}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded font-bold"
              title="تصغير الخط"
              aria-label="تصغير الخط"
            >
              -
            </button>
            <output aria-label="حجم الخط" className="w-6 text-center font-mono">{fontSize}</output>
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.min(64, f + 4))}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded font-bold"
              title="تكبير الخط"
              aria-label="تكبير الخط"
            >
              +
            </button>
          </div>

          {/* Speed Controls */}
          <label className="flex items-center gap-2 text-sm flex-1 min-w-48">سرعة التمرير<input aria-label="سرعة التمرير" type="range" min="6" max="180" step="6" value={scrollSpeed} onChange={e => setScrollSpeed(Number(e.target.value))} className="w-full min-w-16 h-11 accent-amber-400"/><output className="w-9 shrink-0 tabular-nums">{scrollSpeed}</output></label>
          <button type="button" aria-label="ملء الشاشة (F)" title="ملء الشاشة (F)" className="p-2 bg-zinc-800 rounded-md" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={20}/> : <Maximize2 size={20}/>}</button>
          {followId && <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={followDirector} onChange={e => setFollowDirector(e.target.checked)}/>متابعة المخرج</label>}

          {/* Close Prompter */}
          <button
            type="button"
            onClick={handleClose}
            className="p-2 bg-slate-900 hover:bg-red-900/50 text-slate-500 hover:text-red-300 rounded-lg transition-colors"
            title="خروج من شاشة الملقن (Esc)"
            aria-label="إغلاق الملقّن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      {displayError && <p role="alert" className="px-3 py-2 text-red-300">{displayError}</p>}

      {/* Prompter Main Content & Segments Rail */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Segments Navigation Rail */}
        <div className="w-64 bg-slate-950 border-l border-slate-900 flex flex-col shrink-0 hidden md:flex">
          <div className="p-3 border-b border-slate-900 text-xs font-bold text-zinc-300">
            تسلسل فقرات الحلقة ({segments.length})
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {segments.map((seg, idx) => {
              const isActive = idx === currentSegmentIndex;
              return (
                <button
                  key={seg.id || idx}
                  aria-current={isActive ? 'true' : undefined}
                  type="button"
                  onClick={() => handleSelectSegment(idx)}
                  className={`w-full text-right p-2.5 rounded-xl text-xs transition-all ${
                    isActive
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 font-bold'
                      : 'text-zinc-300 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-zinc-300">#{seg.orderIndex || idx + 1}</span>
                    <span className="font-mono text-xs text-zinc-300">{formatSecondsToTime(seg.durationSeconds || 0)}</span>
                  </div>
                  <div className="truncate text-xs">{seg.title}</div>
                  {seg.presenterName && (
                    <div className="text-xs text-zinc-300 mt-0.5 truncate">
                      المقدم: {seg.presenterName}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Prompter Reading View */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-black relative">
          {/* Eyeline Marker (Horizontal line across reading area) */}
          <div className="absolute top-1/3 left-0 right-0 h-14 border-y border-red-500/20 bg-red-500/5 pointer-events-none z-10 flex items-center justify-between px-4">
            <span aria-hidden="true" className="text-xs text-red-300">خط القراءة</span>
          </div>

          {/* Reading Text Container */}
          <div
            ref={scrollContainerRef}
            tabIndex={0} role="region" aria-label="نص الملقّن"
            onWheel={() => setIsPlaying(false)} onTouchStart={() => setIsPlaying(false)} onPointerDown={() => setIsPlaying(false)}
            className={`flex-1 overflow-y-auto px-6 sm:px-16 py-32 transition-transform duration-100 ${
              isMirrored ? 'scale-x-[-1]' : ''
            }`}
          >
            {activeSegment ? (
              <div className="max-w-4xl mx-auto space-y-8">
                {/* Segment Meta Info Header */}
                <div className="border-b border-slate-800 pb-4">
                  <div className="text-amber-400/80 font-mono text-sm mb-1">
                    الفقرة: {activeSegment.orderIndex || currentSegmentIndex + 1} • النوع: {activeSegment.segmentType} • المستهدف: {formatSecondsToTime(activeSegment.durationSeconds || 0)}
                  </div>
                  <h1 className="text-2xl sm:text-4xl font-extrabold text-white">
                    {activeSegment.title}
                  </h1>
                  {activeSegment.presenterName && (
                    <div className="text-sm text-slate-500 mt-2">
                      مقدم الفقرة: <span className="text-slate-200 font-semibold">{activeSegment.presenterName}</span>
                    </div>
                  )}
                </div>

                {/* Script Body */}
                <div
                  style={{ fontSize: `${fontSize}px`, lineHeight: 1.7, overflowWrap: 'anywhere' }}
                  className={`font-sans font-medium text-right leading-relaxed ${themeTextColor}`}
                >
                  {(activeSegment.scriptText || activeSegment.script) ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml((activeSegment.scriptText || activeSegment.script || '').replace(/\n/g, '<br />')),
                      }}
                    />
                  ) : (
                    <div className="text-slate-600 text-center py-20 italic">
                      [لا يوجد نص أوتوكيو مكتوب لهذه الفقرة - اعتمد على الملاحظات الإخراجية]
                    </div>
                  )}
                </div>

                {/* Segment Technical Notes */}
                {activeSegment.notes && (
                  <div className="mt-12 p-4 bg-slate-900/80 rounded-xl border border-slate-800 text-sm text-amber-200/90">
                    <span className="font-bold block mb-1 text-amber-400">ملاحظات المخرج وغرفة التحكم:</span>
                    {activeSegment.notes}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-600">
                لا توجد فقرات للعرض في هذا الرانداون
              </div>
            )}
          </div>

          {/* Bottom Playback Control Bar */}
          <div className="p-3 bg-zinc-950 border-t border-zinc-700 flex flex-wrap gap-2 items-center justify-between shrink-0 z-20">
            {/* Segment switch buttons */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <button
                type="button"
                disabled={currentSegmentIndex === 0}
                onClick={() => handleSelectSegment(currentSegmentIndex - 1)}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 rounded-lg text-xs text-slate-300 font-semibold transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                <span className="hidden sm:inline">الفقرة السابقة</span><span className="sr-only sm:hidden">الفقرة السابقة</span>
              </button>
              <select aria-label="الفقرة المعروضة" value={currentSegmentIndex} onChange={e => handleSelectSegment(Number(e.target.value))} disabled={!segments.length} className="bg-zinc-800 text-white min-h-11 min-w-0 flex-1 md:w-48 text-sm rounded-md px-2">{segments.map((seg, idx) => <option key={seg.id} value={idx}>{idx + 1}. {seg.title}</option>)}</select>

              <button
                type="button"
                disabled={currentSegmentIndex >= segments.length - 1}
                onClick={() => handleSelectSegment(currentSegmentIndex + 1)}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 rounded-lg text-xs text-slate-300 font-semibold transition-colors"
              >
                <span className="hidden sm:inline">الفقرة التالية</span><span className="sr-only sm:hidden">الفقرة التالية</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Play/Pause & Reset */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleResetScroll}
                className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl transition-colors"
                title="إعادة التمرير للبداية"
                aria-label="إعادة التمرير للبداية"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleTogglePlay}
                disabled={!activeSegment}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold shadow-md transition-all ${
                  isPlaying
                    ? 'bg-amber-700 hover:bg-amber-800 text-black'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 fill-current" />
                    إيقاف مؤقت
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    بدء التمرير
                  </>
                )}
              </button>
            </div>

            {/* Elapsed Timer */}
            <div className="flex items-center gap-2 font-mono text-sm text-slate-300 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>{formatTimer(elapsedSeconds)}</span>
              <span className="text-[10px] text-slate-500 font-sans">مدة الإلقاء</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
