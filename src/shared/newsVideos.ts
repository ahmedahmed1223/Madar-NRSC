/**
 * A story's video clips, in playout order. Each clip is a playable link, an item from the media
 * library, or — when the file is not in the system yet — a written location («على خادم المونتاج:
 * ‎\\NAS01\summit\clip2‎»، «مع المراسل على البطاقة 2») so production knows where to find it.
 */

export type NewsVideoKind = 'link' | 'library' | 'location';

export interface NewsVideo {
  id: string;
  /** Short name the gallery and director use («لقطات الافتتاح»). */
  title: string;
  kind: NewsVideoKind;
  url?: string;
  mediaId?: string;
  /** Where the clip is when it is not attached (free text). */
  location?: string;
  /** Duration in seconds, when known. */
  seconds?: number;
  /** In/out points, sound, rights… */
  note?: string;
}

export const MAX_NEWS_VIDEOS = 30;
export const VIDEO_KIND_NAMES: Record<NewsVideoKind, string> = { link: 'رابط', library: 'من المكتبة', location: 'مكان المقطع' };

const LINK = /^(https?:\/\/|\/)\S+$/i;

/** The clips of a story; older stories with a single `videoUrl` get it as their one clip. */
export function videosOf(item: { videos?: unknown; videoUrl?: string } | null | undefined): NewsVideo[] {
  if (Array.isArray(item?.videos)) return item!.videos as NewsVideo[];
  return item?.videoUrl ? [{ id: 'vid-legacy', title: 'المقطع', kind: 'link', url: item.videoUrl }] : [];
}

/** First playable link, kept in `videoUrl` for screens that show one video. */
export function primaryVideoUrl(videos: NewsVideo[], mediaUrl?: (id: string) => string | undefined): string | undefined {
  for (const v of videos) {
    if (v.kind === 'link' && v.url) return v.url;
    if (v.kind === 'library' && v.mediaId) {
      const u = mediaUrl?.(v.mediaId);
      if (u) return u;
    }
  }
  return undefined;
}

export const totalVideoSeconds = (videos: NewsVideo[]) => videos.reduce((t, v) => t + (Number(v.seconds) > 0 ? Number(v.seconds) : 0), 0);

/** "01:20" → 80; "" → undefined; invalid → NaN. */
export function parseClipDuration(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const m = /^(?:(\d{1,2}):)?(\d{1,2})$/.exec(t);
  if (!m) return NaN;
  const secs = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  return m[1] && Number(m[2]) > 59 ? NaN : secs;
}

export const formatClipDuration = (s?: number) =>
  s && s > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

/** What is wrong with one clip (null when fine). */
export function videoError(v: NewsVideo, index: number): string | null {
  const n = `المقطع ${index + 1}`;
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id) return `${n}: بيانات غير صالحة`;
  if (typeof v.title !== 'string' || v.title.length > 120) return `${n}: الاسم طويل أو غير صالح`;
  if (!['link', 'library', 'location'].includes(v.kind)) return `${n}: نوع غير معروف`;
  if (v.kind === 'link' && !(typeof v.url === 'string' && LINK.test(v.url.trim()) && v.url.length <= 2000)) return `${n}: الرابط يجب أن يبدأ بـ https:// أو /`;
  if (v.kind === 'library' && !(typeof v.mediaId === 'string' && v.mediaId)) return `${n}: اختر المادة من مكتبة الوسائط`;
  if (v.kind === 'location' && !(typeof v.location === 'string' && v.location.trim() && v.location.length <= 500)) return `${n}: اكتب أين يوجد المقطع`;
  if (v.seconds !== undefined && !(Number.isFinite(v.seconds) && v.seconds >= 0 && v.seconds <= 6 * 3600)) return `${n}: المدة غير صالحة`;
  if (v.note !== undefined && (typeof v.note !== 'string' || v.note.length > 1000)) return `${n}: الملاحظة طويلة`;
  return null;
}

export function videosError(videos: unknown): string | null {
  if (videos === undefined || videos === null) return null;
  if (!Array.isArray(videos)) return 'قائمة المقاطع غير صالحة';
  if (videos.length > MAX_NEWS_VIDEOS) return `الحد الأقصى ${MAX_NEWS_VIDEOS} مقطعاً للخبر`;
  for (let i = 0; i < videos.length; i++) {
    const e = videoError(videos[i] as NewsVideo, i);
    if (e) return e;
  }
  return null;
}

/** One line per clip for production (print, rundown notes): order, name, duration, where. */
export function videoLines(videos: NewsVideo[], mediaName?: (id: string) => string | undefined): string[] {
  return videos.map((v, i) => {
    const where =
      v.kind === 'link' ? v.url : v.kind === 'library' ? `مكتبة الوسائط: ${mediaName?.(v.mediaId || '') || v.mediaId}` : `المكان: ${v.location}`;
    const dur = formatClipDuration(v.seconds);
    return [`${i + 1}. ${v.title || 'مقطع'}`, dur && `(${dur})`, '—', where, v.note && `— ${v.note}`].filter(Boolean).join(' ');
  });
}
