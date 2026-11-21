import { Clock, Lock, Radio } from 'lucide-react';
import { longToday, useStationNow } from '../common/StationClock';
import { appLocale, basisZone } from '../../shared/dateFormat';
import { deviceDiffersFromStation, stationTimeZone } from '../../shared/dates';

export function TopbarClock({ timezone, locked, canToggle, onToggle }: {
  timezone?: string;
  locked: boolean;
  canToggle: boolean;
  onToggle: () => void;
}) {
  const { now, settings } = useStationNow();
  const station = stationTimeZone(timezone);
  const unified = basisZone(settings);
  const differs = !unified && deviceDiffersFromStation(station);
  const format = (timeZone: string | undefined, seconds: boolean) =>
    now.toLocaleTimeString(appLocale(settings), { timeZone, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

  return (
    <div className="hidden sm:flex items-center gap-2 shrink-0 border-e border-slate-200 pe-3 text-slate-800">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canToggle}
        aria-pressed={locked}
        aria-label={locked ? 'قفل البث المباشر مفعّل' : 'قفل البث المباشر غير مفعّل'}
        title={locked ? 'قفل البث المباشر مفعّل لكل المستخدمين (Ctrl+Alt+L لرفعه)' : 'تفعيل قفل البث المباشر (Ctrl+Alt+L)'}
        className={`min-h-9 flex items-center gap-1.5 rounded-lg px-1.5 text-2xs font-semibold ${locked ? 'text-red-700' : 'text-slate-600 enabled:hover:bg-slate-100'}`}
      >
        {locked ? <Lock className="size-4" aria-hidden="true" /> : <Radio className="size-4" aria-hidden="true" />}
        {locked && <span className="hidden 2xl:inline">قفل البث مفعّل</span>}
      </button>
      <div className="flex items-center gap-1.5" title={unified ? 'الساعة بتوقيت المحطة' : 'الساعة بتوقيت جهازك'}>
        <Clock className="size-3.5 text-slate-500" aria-hidden="true" />
        <bdi className="font-mono text-xs font-semibold tabular-nums whitespace-nowrap">{format(unified, settings.clockSeconds)}</bdi>
        <span className="hidden 2xl:inline text-2xs font-semibold text-slate-600 whitespace-nowrap">{longToday(now, settings)}</span>
        {unified && <span className="hidden xl:inline text-2xs text-slate-600">بتوقيت المحطة</span>}
      </div>
      {differs && <span className="hidden xl:inline text-2xs font-semibold text-amber-800 whitespace-nowrap" title={`توقيت جهازك يختلف عن توقيت المحطة (${station})`}>
        المحطة <bdi className="font-mono tabular-nums">{format(station, false)}</bdi>
      </span>}
    </div>
  );
}
