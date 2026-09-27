/**
 * Arabic names for the internal status and priority codes, so enum values never leak into the UI.
 * One dictionary for lists, search results, logs and exports.
 */
import { NEWS_STATUS_LABELS } from './newsWorkflow';

export const EPISODE_STATUS_LABELS: Record<string, string> = {
  PLANNING: 'مرحلة التخطيط',
  IN_PREPARATION: 'قيد الإعداد',
  READY_FOR_BROADCAST: 'جاهزة للبث',
  ON_AIR: 'على الهواء',
  BROADCASTED: 'تم البث',
  ARCHIVED: 'مؤرشفة',
  CANCELLED: 'ملغاة',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: 'مطلوبة',
  IN_PROGRESS: 'قيد التنفيذ',
  IN_REVIEW: 'قيد المراجعة',
  BLOCKED: 'متوقفة',
  DONE: 'مكتملة',
  COMPLETED: 'مكتملة',
  CANCELLED: 'ملغاة',
};

export const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'حرجة',
  URGENT: 'عاجلة',
  BREAKING: 'عاجل وفوري',
  HIGH: 'عالية',
  MEDIUM: 'متوسطة',
  NORMAL: 'عادية',
  LOW: 'منخفضة',
};

export const PROGRAM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'نشط',
  PAUSED: 'متوقف مؤقتاً',
  ARCHIVED: 'مؤرشف',
  DRAFT: 'مسودة',
};

/** Tasks marked DONE (older data) and COMPLETED are the same state. */
export const normalizeTaskStatus = (s: string | undefined): string => (s === 'DONE' ? 'COMPLETED' : s || 'TODO');

/** Any known status code in Arabic (falls back to the code itself only if it is unknown). */
export function statusLabel(code: string | undefined, kind?: 'news' | 'episode' | 'task' | 'program'): string {
  if (!code) return '—';
  const maps =
    kind === 'news'
      ? [NEWS_STATUS_LABELS as Record<string, string>]
      : kind === 'episode'
        ? [EPISODE_STATUS_LABELS]
        : kind === 'task'
          ? [TASK_STATUS_LABELS]
          : kind === 'program'
            ? [PROGRAM_STATUS_LABELS]
            : [NEWS_STATUS_LABELS as Record<string, string>, EPISODE_STATUS_LABELS, TASK_STATUS_LABELS, PROGRAM_STATUS_LABELS];
  for (const m of maps) if (m[code]) return m[code];
  return code;
}

export const priorityLabel = (code: string | undefined) => (code ? PRIORITY_LABELS[code] || code : '—');
