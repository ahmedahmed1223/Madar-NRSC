/**
 * Pure helpers for an episode's basic details (title, numbering, slot and crew): shared by the
 * «إعداد حلقة جديدة» form and «تعديل بيانات الحلقة», plus the status names used on every
 * episode screen.
 */
import type { Episode, EpisodeStatus } from '../../types';

export type EpisodeStatusVariant = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'default';

/** Every episode status in workflow order, with its Arabic name and badge colour. */
export const EPISODE_STATUS_INFO: { id: EpisodeStatus; label: string; variant: EpisodeStatusVariant }[] = [
  { id: 'PLANNING', label: 'مرحلة التخطيط', variant: 'default' },
  { id: 'IN_PREPARATION', label: 'قيد الإعداد والتحرير', variant: 'warning' },
  { id: 'PREPARING', label: 'تجهيز المحتوى', variant: 'warning' },
  { id: 'READY', label: 'جاهز للتسجيل', variant: 'info' },
  { id: 'RECORDING', label: 'جاري التسجيل', variant: 'danger' },
  { id: 'RECORDED', label: 'تم التسجيل', variant: 'purple' },
  { id: 'EDITING', label: 'المونتاج والمكساج', variant: 'info' },
  { id: 'READY_FOR_BROADCAST', label: 'جاهز للبث المباشر', variant: 'success' },
  { id: 'ON_AIR', label: 'على الهواء مباشرة', variant: 'danger' },
  { id: 'BROADCASTED', label: 'تم البث', variant: 'primary' },
  { id: 'ARCHIVED', label: 'مؤرشفة', variant: 'default' },
  { id: 'CANCELLED', label: 'ملغاة', variant: 'danger' },
];

/** Name and badge colour of a status (an unknown code is shown as-is, never hidden). */
export function episodeStatusInfo(status: string | undefined): { label: string; variant: EpisodeStatusVariant } {
  const found = EPISODE_STATUS_INFO.find((s) => s.id === status);
  return found ? { label: found.label, variant: found.variant } : { label: status || '—', variant: 'default' };
}

export const EPISODE_DURATION_PRESETS = [30, 45, 50, 60, 90];

export interface EpisodeDetailsValues {
  title: string;
  episodeNumber: number;
  seasonNumber: number;
  broadcastDate: string;
  startTime: string;
  durationMinutes: number;
  presenterName: string;
  producerName: string;
  studioName: string;
  directorName: string;
  description: string;
}

const minutesOf = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
};

/** End of the slot as HH:MM (wraps past midnight); the start unchanged when it is not a time. */
export function episodeEndTime(start: string, durationMinutes: number): string {
  const s = minutesOf(start);
  if (s === null) return start;
  const total = s + Math.max(0, Number(durationMinutes) || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** True when the slot runs past midnight into the next day. */
export function episodeEndsNextDay(start: string, durationMinutes: number): boolean {
  const s = minutesOf(start);
  return s !== null && s + Math.max(0, Number(durationMinutes) || 0) >= 24 * 60;
}

/** The editable details of a saved episode, as the form shows them. */
export function episodeDetailsOf(ep: Partial<Episode>): EpisodeDetailsValues {
  return {
    title: ep.title || '',
    episodeNumber: Number(ep.episodeNumber) || 1,
    seasonNumber: Number(ep.seasonNumber) || 1,
    broadcastDate: ep.broadcastDate || '',
    startTime: ep.startTime || '',
    durationMinutes: Number(ep.durationMinutes) || 0,
    presenterName: ep.presenterName || '',
    producerName: ep.producerName || '',
    studioName: ep.studioName || '',
    directorName: ep.directorName || '',
    description: ep.description || '',
  };
}

/** Why the form cannot be saved as filled in (null when it can). */
export function episodeDetailsError(values: EpisodeDetailsValues): string | null {
  if (!values.title.trim()) return 'اكتب عنوان الحلقة.';
  if (!(Number(values.episodeNumber) >= 1)) return 'رقم الحلقة يبدأ من 1.';
  if (!(Number(values.seasonNumber) >= 1)) return 'رقم الموسم يبدأ من 1.';
  if (minutesOf(values.startTime) === null) return 'وقت البدء غير صالح.';
  const d = Number(values.durationMinutes);
  if (!(d >= 1 && d <= 480)) return 'مدة الحلقة بين دقيقة و480 دقيقة.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.broadcastDate || '')) return 'اختر تاريخ البث.';
  return null;
}

/**
 * Only the fields that changed (plus the id), so the save does not overwrite a colleague's
 * edits to other parts of the episode. The end of the slot follows the start and length.
 * Returns null when nothing changed.
 */
export function episodeDetailsPatch(ep: Episode, values: EpisodeDetailsValues): Partial<Episode> | null {
  const before = episodeDetailsOf(ep);
  const next: EpisodeDetailsValues = {
    ...values,
    title: values.title.trim(),
    episodeNumber: Number(values.episodeNumber) || 1,
    seasonNumber: Number(values.seasonNumber) || 1,
    durationMinutes: Number(values.durationMinutes) || 0,
    presenterName: values.presenterName.trim(),
    producerName: values.producerName.trim(),
    studioName: values.studioName.trim(),
    directorName: values.directorName.trim(),
    description: values.description.trim(),
  };
  const patch: Partial<Episode> = {};
  (Object.keys(next) as (keyof EpisodeDetailsValues)[]).forEach((key) => {
    if (next[key] !== before[key]) (patch as any)[key] = next[key];
  });
  const endTime = episodeEndTime(next.startTime, next.durationMinutes);
  if (endTime !== (ep.endTime || '')) patch.endTime = endTime;
  if (Object.keys(patch).length === 0) return null;
  return { id: ep.id, ...patch };
}

/** True when the patch moves the episode's slot or studio (worth re-checking studio clashes). */
export const patchMovesSlot = (patch: Partial<Episode>): boolean =>
  ['broadcastDate', 'startTime', 'durationMinutes', 'studioName'].some((k) => k in patch);

/**
 * Why this user cannot edit the episode's details right now (null when they can): the
 * permission, a colleague holding the episode's edit lock, or the shared on-air lock while
 * the episode is on air.
 */
export function episodeDetailsBlock(opts: {
  mayEdit: boolean;
  lockedByName?: string | null;
  liveLock?: boolean;
  status?: string;
}): string | null {
  if (!opts.mayEdit) return 'صلاحياتك لا تسمح بتعديل بيانات الحلقة.';
  if (opts.lockedByName) return `الحلقة قيد التحرير الآن لدى ${opts.lockedByName}.`;
  if (opts.liveLock && opts.status === 'ON_AIR') return 'قفل البث المباشر مفعّل والحلقة على الهواء؛ لا تُعدَّل بياناتها حتى يُرفع القفل.';
  return null;
}
