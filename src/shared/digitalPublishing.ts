import type { NewsItem } from '../types';

export const DIGITAL_FIELDS = [
  { key: 'x', label: 'نص X', limit: 280 },
  { key: 'telegram', label: 'نص Telegram', limit: 500 },
  { key: 'youtubeTitle', label: 'عنوان YouTube', limit: 100 },
  { key: 'youtubeDescription', label: 'وصف YouTube', limit: 5000 },
  { key: 'youtubeChapters', label: 'فصول YouTube', limit: 2000 },
  { key: 'instagram', label: 'نص Instagram', limit: 2200 },
  { key: 'reels', label: 'نص Reels', limit: 1200 },
] as const;

export type DigitalCopyField = typeof DIGITAL_FIELDS[number]['key'];
export type DigitalCopy = Record<DigitalCopyField, string>;
export type DigitalPublishingPackage = DigitalCopy & {
  approval?: { by: string; at: string };
  /** Transient request stripped by the server before writing. */
  requestApproval?: true;
};

export const emptyDigitalPackage = (): DigitalCopy => ({
  x: '', telegram: '', youtubeTitle: '', youtubeDescription: '', youtubeChapters: '', instagram: '', reels: '',
});

export const digitalLength = (value: string) => Array.from(value).length;
export const digitalCopyOf = (value?: Partial<DigitalCopy>): DigitalCopy => {
  const fields = emptyDigitalPackage();
  for (const { key } of DIGITAL_FIELDS) fields[key] = typeof value?.[key] === 'string' ? value[key] : '';
  return fields;
};
export const hasDigitalCopy = (value: DigitalCopy) => DIGITAL_FIELDS.some(({ key }) => value[key].trim());
export const digitalApprovalStatus = (status?: string) => status === 'APPROVED' || status === 'PUBLISHED' || status === 'SCHEDULED';

function chaptersError(value: string) {
  let previous = -1;
  for (const line of value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const parts = /^(?:(\d{1,3}):)?(\d{1,2}):([0-5]\d)\s+\S/.exec(line);
    if (!parts || (parts[1] && Number(parts[2]) >= 60)) return 'اكتب وقتاً وعنواناً لكل فصل، مثل 00:00 المقدمة';
    const seconds = Number(parts[1] || 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
    if (previous < 0 ? seconds !== 0 : seconds <= previous) return 'ابدأ الفصول من 00:00 ورتّبها زمنياً';
    previous = seconds;
  }
  return null;
}

export function digitalPackageError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'حزمة النشر غير صالحة';
  const record = value as Record<string, unknown>;
  for (const { key, limit, label } of DIGITAL_FIELDS) {
    const text = record[key];
    if (text !== undefined && (typeof text !== 'string' || digitalLength(text) > limit)) return `${label} يصل إلى ${limit} حرفاً`;
  }
  if (record.requestApproval !== undefined && record.requestApproval !== true) return 'طلب اعتماد حزمة النشر غير صالح';
  return typeof record.youtubeChapters === 'string' ? chaptersError(record.youtubeChapters) : null;
}

const sourceFields = ['title', 'shortTitle', 'summary', 'content', 'categoryId', 'sourceId', 'keywords', 'embargoUntil'] as const;

/** Only the server can stamp approval. Later changes to the copy or underlying news invalidate it. */
export function prepareDigitalPackage(
  before: Partial<NewsItem> | null,
  after: Partial<NewsItem>,
  actor: { id: string; canApprove: boolean; now: string },
): { error?: string; value?: DigitalPublishingPackage } {
  const previous = before?.digitalPackage;
  const error = digitalPackageError(after.digitalPackage);
  if (error) return { error };
  const incoming = after.digitalPackage ?? previous;
  if (incoming === undefined) return {};
  const value = digitalCopyOf(incoming);
  const sourceChanged = !before || sourceFields.some(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
  if (incoming.requestApproval) {
    if (!actor.canApprove) return { error: 'اعتماد حزمة النشر لمن يملك صلاحية اعتماد الأخبار' };
    if (sourceChanged || !digitalApprovalStatus(before?.status) || !digitalApprovalStatus(after.status) || after.deletedAt) {
      return { error: 'احفظ نسخة الخبر واعتمدها تحريرياً قبل اعتماد حزمة النشر' };
    }
    if (!hasDigitalCopy(value)) return { error: 'أضف نصاً للحزمة قبل اعتمادها' };
    return { value: { ...value, approval: { at: actor.now, by: actor.id } } };
  }
  if (previous?.approval && digitalApprovalStatus(after.status) && !sourceChanged &&
    DIGITAL_FIELDS.every(({ key }) => value[key] === (previous[key] || ''))) {
    return { value: { ...value, approval: previous.approval } };
  }
  return { value };
}
