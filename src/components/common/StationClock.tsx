import React, { useEffect, useState } from 'react';
import { appLocale, basisZone, getDateSettings, onDateFormat, zoneOptions } from '../../shared/dateFormat';

/** Weekday and date in the station's conventions ("السبت، 27 سبتمبر 2026"). */
export function longToday(now: Date, settings = getDateSettings()): string {
  return now.toLocaleDateString(appLocale(settings), {
    ...zoneOptions(settings),
    weekday: 'long',
    ...(settings.dateStyle === 'numeric' ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' }),
  });
}

/** Ticks once a second and redraws when the station's date/time conventions change. */
export function useStationNow() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState(getDateSettings);
  useEffect(() => onDateFormat(() => setSettings(getDateSettings())), []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return { now, settings };
}

/**
 * The station clock: time and today's date in the station's conventions (and its zone under
 * unified time). `hero` for the sign-in screen, `strip` for the top of the dashboard.
 */
export const StationClock: React.FC<{ variant?: 'hero' | 'strip'; className?: string; onDark?: boolean }> = ({ variant = 'strip', className = '', onDark = false }) => {
  const { now, settings } = useStationNow();
  const time = now.toLocaleTimeString(appLocale(settings), {
    ...zoneOptions(settings),
    hour: '2-digit',
    minute: '2-digit',
    ...(settings.clockSeconds ? { second: '2-digit' } : {}),
  });
  const zone = basisZone(settings);
  const date = longToday(now, settings);

  if (variant === 'hero') {
    return (
      <div className={`text-center ${className}`} role="timer" aria-live="off" aria-label={`الساعة ${time}، ${date}`}>
        <p className={`text-4xl sm:text-5xl font-black tabular-nums tracking-tight ${onDark ? 'theme-fixed text-white' : 'text-slate-900'}`}>
          {time}
        </p>
        <p className={`mt-1 text-sm font-bold ${onDark ? 'theme-fixed text-slate-300' : 'text-slate-600'}`}>{date}</p>
        {zone && <p className="theme-fixed text-[11px] text-slate-400 mt-0.5">بتوقيت المحطة ({zone})</p>}
      </div>
    );
  }
  return (
    <div className={`inline-flex items-baseline gap-2 ${className}`} role="timer" aria-live="off" aria-label={`الساعة ${time}، ${date}`}>
      <span className="text-sm font-black text-slate-900 tabular-nums">
        {time}
      </span>
      <span className="text-xs font-bold text-slate-600">{date}</span>
      {zone && <span className="text-[10px] text-slate-400">بتوقيت المحطة</span>}
    </div>
  );
};
