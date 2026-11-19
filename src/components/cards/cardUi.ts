import { appLocale, zoneOptions } from '../../shared/dateFormat';
import type { CardState, StepStatus } from '../../shared/productionCards';

/** Day and time in the station's format, e.g. «19 نوفمبر 21:15». */
export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export const timeOnly = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' }) : '');

/** Calendar day (YYYY-MM-DD) of a moment in the station's time zone. */
export const stationDay = (iso: string | number | Date) => new Date(iso).toLocaleDateString('en-CA', zoneOptions());

export const CARD_STATE_STYLE: Record<CardState, string> = {
  CLOSED: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
  BLOCKED: 'bg-rose-50 text-rose-700 border-rose-200',
  LATE: 'bg-amber-50 text-amber-800 border-amber-200',
  READY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  NEW: 'bg-white text-slate-600 border-slate-300',
};

export const STEP_STATUS_STYLE: Record<StepStatus, string> = {
  TODO: 'bg-white text-slate-600 border-slate-300',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  BLOCKED: 'bg-rose-50 text-rose-700 border-rose-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SKIPPED: 'bg-slate-100 text-slate-500 border-slate-200',
};

export const INPUT = 'w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900';
export const LABEL = 'block font-bold text-slate-700 mb-1';
