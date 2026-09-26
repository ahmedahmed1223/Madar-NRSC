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
  Volume2,
} from 'lucide-react';
import { RundownSegment } from '../../types';
import { formatSecondsToTime } from '../../shared/rundown';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

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
  const liveVersion = useLiveData(['onAir'], 0);
  const liveSegmentId = episodeId ? apiService.getOnAir(episodeId) : null;
  const followId = liveSegmentId?.status === 'LIVE' ? liveSegmentId.currentSegmentId : null;
  useEffect(() => {
    if (!isOpen || !followId) return;
    const idx = segments.findIndex((s) => s.id === followId);
    if (idx >= 0) setCurrentSegmentIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followId, isOpen, liveVersion]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(2); // 1 to 5
  const [fontSize, setFontSize] = useState(36); // px
  const [isMirrored, setIsMirrored] = useState(false);
  const [colorTheme, setColorTheme] = useState<'yellow' | 'white' | 'cyan'>('yellow');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const activeSegment = segments[currentSegmentIndex] || segments[0];

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
    const scrollStep = () => {
      if (isPlaying && isOpen && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop += scrollSpeed * 0.8;
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

  // Keyboard controls: Space to play/pause, Arrows to switch segment
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (currentSegmentIndex > 0) {
          handleSelectSegment(currentSegmentIndex - 1);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (currentSegmentIndex < segments.length - 1) {
          handleSelectSegment(currentSegmentIndex + 1);
        }
      } else if (e.code === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    <div className="theme-fixed fixed inset-0 z-50 bg-black text-white flex flex-col select-none" dir="rtl">
      {/* Studio Prompter Top Bar */}
      <div className="h-16 px-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 bg-red-600 text-white font-mono text-xs font-bold rounded-md animate-pulse">
            PROMPTER LIVE
          </span>
          <div className="truncate">
            <h2 className="text-sm font-bold text-slate-100">{episodeTitle}</h2>
            <div className="text-xs text-slate-400">
              الفقرة {currentSegmentIndex + 1} من {segments.length}: {activeSegment?.title || 'فقرة مجهولة'}
            </div>
          </div>
        </div>

        {/* Prompter Controls */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Color theme switch */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setColorTheme('yellow')}
              className={`w-6 h-6 rounded-md bg-amber-400 ${colorTheme === 'yellow' ? 'ring-2 ring-white' : 'opacity-70'}`}
              title="أصفر استوديو كلاسيكي"
            />
            <button
              type="button"
              onClick={() => setColorTheme('white')}
              className={`w-6 h-6 rounded-md bg-white ${colorTheme === 'white' ? 'ring-2 ring-blue-500' : 'opacity-70'}`}
              title="أبيض عالي التباين"
            />
            <button
              type="button"
              onClick={() => setColorTheme('cyan')}
              className={`w-6 h-6 rounded-md bg-cyan-400 ${colorTheme === 'cyan' ? 'ring-2 ring-white' : 'opacity-70'}`}
              title="سماوي هادئ"
            />
          </div>

          {/* Mirror Toggle (for physical hardware prompters) */}
          <button
            type="button"
            onClick={() => setIsMirrored(!isMirrored)}
            className={`p-2 rounded-lg transition-colors ${
              isMirrored ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
            title={isMirrored ? 'إلغاء وضع المرآة للزجاج' : 'تفعيل وضع المرآة لعاكس الكاميرا (Prompter Glass)'}
          >
            <FlipHorizontal className="w-4 h-4" />
          </button>

          {/* Font Size Controls */}
          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <Type className="w-3.5 h-3.5 text-slate-400" />
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.max(22, f - 4))}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded font-bold"
              title="تصغير الخط"
            >
              -
            </button>
            <span className="w-6 text-center font-mono">{fontSize}</span>
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.min(64, f + 4))}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded font-bold"
              title="تكبير الخط"
            >
              +
            </button>
          </div>

          {/* Speed Controls */}
          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400 text-[11px]">السرعة:</span>
            <button
              type="button"
              onClick={() => setScrollSpeed((s) => Math.max(1, s - 1))}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded font-bold"
            >
              -
            </button>
            <span className="w-4 text-center font-mono">{scrollSpeed}x</span>
            <button
              type="button"
              onClick={() => setScrollSpeed((s) => Math.min(6, s + 1))}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded font-bold"
            >
              +
            </button>
          </div>

          {/* Close Prompter */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-slate-900 hover:bg-red-900/50 text-slate-400 hover:text-red-300 rounded-lg transition-colors"
            title="خروج من شاشة الملقن (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prompter Main Content & Segments Rail */}
      <div className="flex-1 flex overflow-hidden">
        {/* Segments Navigation Rail */}
        <div className="w-64 bg-slate-950 border-l border-slate-900 flex flex-col shrink-0 hidden md:flex">
          <div className="p-3 border-b border-slate-900 text-xs font-bold text-slate-400 uppercase tracking-wider">
            تسلسل فقرات الحلقة ({segments.length})
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {segments.map((seg, idx) => {
              const isActive = idx === currentSegmentIndex;
              return (
                <button
                  key={seg.id || idx}
                  type="button"
                  onClick={() => handleSelectSegment(idx)}
                  className={`w-full text-right p-2.5 rounded-xl text-xs transition-all ${
                    isActive
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 font-bold'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[11px] text-slate-500">#{seg.orderIndex || idx + 1}</span>
                    <span className="font-mono text-[10px] text-slate-400">{formatSecondsToTime(seg.durationSeconds || 0)}</span>
                  </div>
                  <div className="truncate text-xs">{seg.title}</div>
                  {seg.presenterName && (
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                      المقدم: {seg.presenterName}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Prompter Reading View */}
        <div className="flex-1 flex flex-col bg-black relative">
          {/* Eyeline Marker (Horizontal line across reading area) */}
          <div className="absolute top-1/3 left-0 right-0 h-14 border-y border-red-500/20 bg-red-500/5 pointer-events-none z-10 flex items-center justify-between px-4">
            <span className="text-[10px] font-mono text-red-400/60 uppercase">▲ خط نظر الكاميرا / EYELINE</span>
            <span className="text-[10px] font-mono text-red-400/60 uppercase">EYELINE ▲</span>
          </div>

          {/* Reading Text Container */}
          <div
            ref={scrollContainerRef}
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
                    <div className="text-sm text-slate-400 mt-2">
                      مقدم الفقرة: <span className="text-slate-200 font-semibold">{activeSegment.presenterName}</span>
                    </div>
                  )}
                </div>

                {/* Script Body */}
                <div
                  style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
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
          <div className="h-16 px-6 bg-slate-950 border-t border-slate-900 flex items-center justify-between shrink-0 z-20">
            {/* Segment switch buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentSegmentIndex === 0}
                onClick={() => handleSelectSegment(currentSegmentIndex - 1)}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 rounded-lg text-xs text-slate-300 font-semibold transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                الفقرة السابقة
              </button>

              <button
                type="button"
                disabled={currentSegmentIndex >= segments.length - 1}
                onClick={() => handleSelectSegment(currentSegmentIndex + 1)}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 rounded-lg text-xs text-slate-300 font-semibold transition-colors"
              >
                الفقرة التالية
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
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleTogglePlay}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold shadow-md transition-all ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-600 text-black'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 fill-current" />
                    إيقاف مؤقت (Space)
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    بدء التمرير التلقائي (Space)
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
