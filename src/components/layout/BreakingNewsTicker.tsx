import React, { useState, useEffect } from 'react';
import { BreakingNews } from '../../types';
import { Flame, ChevronLeft, ChevronRight, X, Pause, Play, Radio } from 'lucide-react';

interface TickerItem {
  id: string;
  title: string;
  time?: string;
  newsId?: string;
  isActive?: boolean;
}

interface BreakingNewsTickerProps {
  breakingItems?: BreakingNews[] | TickerItem[];
  items?: (BreakingNews | TickerItem)[];
  onOpenNews?: (newsId?: string) => void;
  onDismiss?: (id: string) => void;
}

export const BreakingNewsTicker: React.FC<BreakingNewsTickerProps> = ({
  breakingItems,
  items,
  onOpenNews,
  onDismiss,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const rawList = (breakingItems || items || []) as (BreakingNews | TickerItem)[];

  // Auto-advance ticker every 7 seconds if not paused
  useEffect(() => {
    if (isPaused || rawList.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % rawList.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [isPaused, rawList.length]);

  if (!rawList || rawList.length === 0) {
    return null;
  }

  const safeIndex = currentIndex % rawList.length;
  const activeItem = rawList[safeIndex];

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % rawList.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + rawList.length) % rawList.length);
  };

  return (
    <div className="bg-gradient-to-r from-red-600 via-red-700 to-rose-700 text-white flex items-center justify-between px-3 sm:px-4 py-1.5 text-xs font-semibold shadow-md border-b border-red-800 select-none z-40">
      <div className="flex items-center gap-2.5 sm:gap-3 overflow-hidden flex-1 min-w-0">
        {/* Pulsing Tag */}
        <div className="flex items-center gap-1.5 bg-black/25 px-2.5 py-1 rounded-lg shrink-0 border border-white/10">
          <Flame className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          <span className="font-extrabold tracking-wider text-[11px] uppercase">عاجل</span>
          {rawList.length > 1 && (
            <span className="bg-white/20 text-[10px] px-1.5 py-0.2 rounded font-mono font-bold">
              {safeIndex + 1}/{rawList.length}
            </span>
          )}
        </div>

        {/* Headline Text */}
        <div
          onClick={() => activeItem.newsId && onOpenNews?.(activeItem.newsId)}
          className={`truncate text-white text-xs sm:text-sm font-bold flex-1 transition-opacity duration-300 ${
            activeItem.newsId ? 'cursor-pointer hover:underline' : ''
          }`}
          title={activeItem.title}
        >
          {activeItem.title}
        </div>

        {(() => {
          const itemTime = 'time' in activeItem ? activeItem.time : 'startedAt' in activeItem ? activeItem.startedAt : null;
          if (!itemTime) return null;
          return (
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono text-red-100/80 bg-red-900/40 px-2 py-0.5 rounded shrink-0">
              <Radio className="w-3 h-3 text-red-300 animate-pulse" />
              {itemTime}
            </span>
          );
        })()}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0 pr-2 sm:pr-3">
        {rawList.length > 1 && (
          <div className="flex items-center bg-black/20 rounded-lg p-0.5 border border-white/10">
            <button
              type="button"
              onClick={handlePrev}
              className="p-1 hover:bg-white/20 rounded transition-colors text-white"
              title="الخبر السابق"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="p-1 hover:bg-white/20 rounded transition-colors text-white"
              title="الخبر التالي"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsPaused(!isPaused)}
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white"
          title={isPaused ? 'استئناف التمرير التلقائي' : 'إيقاف مؤقت'}
        >
          {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
        </button>

        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(activeItem.id)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-red-200 hover:text-white"
            title="إخفاء من شريط البث"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
