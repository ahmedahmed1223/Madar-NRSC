import React, { useState, useEffect } from 'react';
import {
  Tv,
  Radio,
  Clock,
  Play,
  Pause,
  SkipForward,
  Plus,
  Minus,
  AlertTriangle,
  Volume2,
  Video,
  X,
  CheckCircle2,
  ChevronLeft,
  Flame,
  Maximize2,
  Sliders,
} from 'lucide-react';
import { RundownSegment, Episode } from '../../types';
import { formatSecondsToTime } from '../../services/api';

interface LivePcrMasterControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  episode: Episode;
  segments: RundownSegment[];
  onUpdateSegments: (segments: RundownSegment[]) => void;
}

export const LivePcrMasterControlModal: React.FC<LivePcrMasterControlModalProps> = ({
  isOpen,
  onClose,
  episode,
  segments,
  onUpdateSegments,
}) => {
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(0);
  const [isOnAir, setIsOnAir] = useState(true);
  const [segmentRemainingSeconds, setSegmentRemainingSeconds] = useState(180);
  const plannedMinutes = episode.durationMinutes || (episode as any).plannedDurationMinutes || 30;
  const [showRemainingSeconds, setShowRemainingSeconds] = useState(plannedMinutes * 60);
  const [studioTallyCamera, setStudioTallyCamera] = useState<string>('CAM 1 (Presenter)');
  const [activeVtStatus, setActiveVtStatus] = useState<string>('PLAYING 1080p50');
  const [audioMasterMuted, setAudioMasterMuted] = useState(false);
  const [emergencyAlertMsg, setEmergencyAlertMsg] = useState<string | null>(null);

  const activeSegment = segments[activeSegmentIdx] || segments[0];
  const nextSegment = segments[activeSegmentIdx + 1] || null;

  // Initialize remaining time on active segment change
  useEffect(() => {
    if (activeSegment) {
      setSegmentRemainingSeconds(activeSegment.durationSeconds || 180);
    }
  }, [activeSegmentIdx, activeSegment]);

  // Master Studio Clock Loop
  const [currentTimeStr, setCurrentTimeStr] = useState('');
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString('en-GB', { hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Live On-Air Countdown Loop
  useEffect(() => {
    let interval: any = null;
    if (isOnAir && isOpen) {
      interval = setInterval(() => {
        setSegmentRemainingSeconds((prev) => Math.max(0, prev - 1));
        setShowRemainingSeconds((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOnAir, isOpen]);

  if (!isOpen) return null;

  // Runtime differential calculation
  const totalRundownPlanned = segments.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
  const scheduledTime = (episode.durationMinutes || (episode as any).plannedDurationMinutes || 30) * 60;
  const timeDifference = totalRundownPlanned - scheduledTime;

  // Quick On-Air Actions
  const handleNextSegment = () => {
    if (activeSegmentIdx < segments.length - 1) {
      setActiveSegmentIdx((prev) => prev + 1);
    }
  };

  const handleExtendCurrent = (delta: number) => {
    if (!activeSegment) return;
    const updated = segments.map((s, idx) =>
      idx === activeSegmentIdx
        ? { ...s, durationSeconds: Math.max(10, (s.durationSeconds || 180) + delta) }
        : s
    );
    onUpdateSegments(updated);
    setSegmentRemainingSeconds((prev) => Math.max(0, prev + delta));
    setEmergencyAlertMsg(`تم ${delta > 0 ? 'تمديد' : 'تقليص'} وقت الفقرة الحالية بمقدار ${Math.abs(delta)} ثانية`);
    setTimeout(() => setEmergencyAlertMsg(null), 3000);
  };

  const handleSkipSegment = () => {
    if (confirm('هل أنت متأكد من إلغاء وتخطي هذه الفقرة فوراً من البث؟')) {
      handleNextSegment();
      setEmergencyAlertMsg('تم تخطي الفقرة والقفز للفقرة التالية على الهواء');
      setTimeout(() => setEmergencyAlertMsg(null), 3500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col select-none overflow-hidden" dir="rtl">
      {/* Top Header / Studio Info */}
      <div className="h-16 px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-600/90 text-white font-mono text-xs font-black rounded-lg border border-red-500 shadow-lg animate-pulse">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
            ON AIR LIVE
          </div>
          <div>
            <h1 className="text-sm font-black text-white flex items-center gap-2">
              <Tv className="w-4 h-4 text-blue-400" />
              غرفة التحكم والبث المباشر (PCR Master Control Desk) - {episode.title}
            </h1>
            <span className="text-[11px] text-slate-400">
              الاستوديو الرئيسي: {(episode as any).studioId || (episode as any).studio || 'Main Studio HD'} • المخرج المناوب: تحكم البث الآلي
            </span>
          </div>
        </div>

        {/* Master Clocks */}
        <div className="flex items-center gap-4">
          <div className="text-left bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-500 font-mono block">توقيت الاستوديو الحقيقي (LTC)</span>
            <span className="text-base font-black font-mono text-emerald-400 tracking-wider">
              {currentTimeStr}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors"
            title="إغلاق لوحة التحكم"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Emergency Message Toast */}
      {emergencyAlertMsg && (
        <div className="bg-amber-500 text-slate-950 px-6 py-2 text-xs font-black flex items-center justify-between animate-in slide-in-from-top-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {emergencyAlertMsg}
          </span>
          <button onClick={() => setEmergencyAlertMsg(null)} className="font-mono text-sm font-bold">×</button>
        </div>
      )}

      {/* Main PCR Workspace Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-y-auto">
        {/* Left Column (4 cols): Segments Stack */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <span className="text-xs font-black text-slate-300">تسلسل فقرات النشرة ({segments.length})</span>
            <span className="text-[11px] font-mono text-blue-400">
              مجموع الرانداون: {formatSecondsToTime(totalRundownPlanned)}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {segments.map((seg, idx) => {
              const isCurrent = idx === activeSegmentIdx;
              const isPast = idx < activeSegmentIdx;
              const isUpcoming = idx > activeSegmentIdx;

              return (
                <button
                  key={seg.id || idx}
                  type="button"
                  onClick={() => setActiveSegmentIdx(idx)}
                  className={`w-full text-right p-3 rounded-xl text-xs transition-all border ${
                    isCurrent
                      ? 'bg-red-950/70 border-red-500/80 text-white shadow-lg ring-1 ring-red-500/40'
                      : isPast
                      ? 'bg-slate-950/40 border-slate-800 text-slate-500 opacity-60'
                      : 'bg-slate-950/80 border-slate-800/80 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-slate-400 font-bold">#{idx + 1}</span>
                      {isCurrent && (
                        <span className="px-1.5 py-0.2 bg-red-600 text-white text-[9px] font-black rounded">
                          ON AIR
                        </span>
                      )}
                      {idx === activeSegmentIdx + 1 && (
                        <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 text-[9px] font-black rounded">
                          NEXT CUE
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 font-bold">
                      {formatSecondsToTime(seg.durationSeconds || 180)}
                    </span>
                  </div>

                  <div className="font-bold text-xs truncate text-white">{seg.title}</div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                    <span>{seg.segmentType}</span>
                    <span>{seg.presenterName || 'المذيع الرئيسي'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center/Right Column (8 cols): On-Air Command & Tally */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Active On-Air Focus Display */}
          <div className="bg-slate-900 border-2 border-red-600/80 rounded-2xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-red-600 via-amber-500 to-red-600 animate-pulse" />

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono text-red-400 font-black tracking-widest block uppercase">
                  ● الفقرة الحالية على الهواء مباشرة (ON AIR NOW)
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  {activeSegment ? activeSegment.title : 'لا توجد فقرة جارية'}
                </h2>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                  <span>نوع الفقرة: <strong className="text-white">{activeSegment?.segmentType}</strong></span>
                  <span>•</span>
                  <span>المقدم: <strong className="text-blue-400">{activeSegment?.presenterName || 'استوديو الأخبار'}</strong></span>
                </div>
              </div>

              {/* Big Countdown Clock */}
              <div className="text-left bg-slate-950 px-6 py-3 rounded-2xl border border-red-500/40 shadow-inner">
                <span className="text-[10px] text-red-400 font-bold block font-mono uppercase">
                  الوقت المتبقي للفقرة (REMAINING)
                </span>
                <div className={`text-4xl sm:text-5xl font-black font-mono tracking-wider ${
                  segmentRemainingSeconds <= 30 ? 'text-red-500 animate-pulse' : 'text-amber-400'
                }`}>
                  {formatSecondsToTime(segmentRemainingSeconds)}
                </div>
              </div>
            </div>

            {/* Script Text Box Preview */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-200 leading-relaxed font-sans max-h-36 overflow-y-auto">
              <span className="text-[10px] text-slate-500 font-bold block mb-1 font-mono uppercase">
                نص القراءة والملقن للمذيع:
              </span>
              {activeSegment?.scriptText || activeSegment?.notes || 'لا يوجد نص مكتوب - اعتمد على المداخلة والحوار المباشر.'}
            </div>

            {/* Next Cue Preview Card */}
            {nextSegment && (
              <div className="bg-slate-950/80 border border-amber-500/40 p-3 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black text-[10px] rounded">
                    التالي NEXT
                  </span>
                  <div>
                    <strong className="text-white block">{nextSegment.title}</strong>
                    <span className="text-slate-400 text-[10px]">{nextSegment.segmentType} • {nextSegment.presenterName}</span>
                  </div>
                </div>
                <span className="font-mono text-amber-400 font-bold">
                  {formatSecondsToTime(nextSegment.durationSeconds || 180)}
                </span>
              </div>
            )}

            {/* On-The-Fly Director Live Controls */}
            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExtendCurrent(30)}
                  className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-xl text-xs font-black transition-colors border border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  +30 ثانية
                </button>
                <button
                  type="button"
                  onClick={() => handleExtendCurrent(-30)}
                  className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-xl text-xs font-black transition-colors border border-slate-700"
                >
                  <Minus className="w-3.5 h-3.5" />
                  -30 ثانية
                </button>
                <button
                  type="button"
                  onClick={handleSkipSegment}
                  className="flex items-center gap-1 px-3 py-2 bg-red-900/40 hover:bg-red-900/70 text-red-300 rounded-xl text-xs font-black transition-colors border border-red-800/60"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  تخطي الفقرة (Kill)
                </button>
              </div>

              <button
                type="button"
                onClick={handleNextSegment}
                disabled={activeSegmentIdx >= segments.length - 1}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-black transition-all shadow-lg"
              >
                <span>الانتقال للفقرة التالية (Take Next)</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tally & Vision Mixer Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-2">
              <span className="text-[10px] text-slate-400 font-mono block">مصدر الصورة الفعلي (Vision Tally)</span>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  {studioTallyCamera}
                </span>
                <select
                  value={studioTallyCamera}
                  onChange={(e) => setStudioTallyCamera(e.target.value)}
                  className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-200"
                >
                  <option value="CAM 1 (Presenter)">CAM 1 (Presenter)</option>
                  <option value="CAM 2 (Wide Studio)">CAM 2 (Wide Studio)</option>
                  <option value="VT 1 (Video Server)">VT 1 (Video Server)</option>
                  <option value="SNG Live Link">SNG Live Satellite</option>
                </select>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-2">
              <span className="text-[10px] text-slate-400 font-mono block">فارق التوقيت للنشرة (Over/Under)</span>
              <div className="text-sm font-black font-mono">
                {timeDifference > 0 ? (
                  <span className="text-red-400">+{formatSecondsToTime(timeDifference)} زيادة (OVER)</span>
                ) : timeDifference < 0 ? (
                  <span className="text-amber-400">-{formatSecondsToTime(Math.abs(timeDifference))} عجز (UNDER)</span>
                ) : (
                  <span className="text-emerald-400">00:00:00 مطابق تماماً (ON TIME)</span>
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-2">
              <span className="text-[10px] text-slate-400 font-mono block">مؤقت انتهاء النشرة بالكامل</span>
              <div className="text-sm font-black font-mono text-cyan-400">
                {formatSecondsToTime(showRemainingSeconds)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
