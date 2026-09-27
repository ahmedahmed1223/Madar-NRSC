import { arabicDate } from './dates';

/**
 * News bulletins, modelled on how newsroom systems (Octopus, iNEWS) run a newscast:
 * a rundown of stories with professional story types, read time from the anchor script
 * plus clip time, front/back timing against a hard out, float/kill, and editor approval.
 * Shared by the client and the server so both apply the same rules.
 */

// ---------------------------------------------------------------------------
// Story types
// ---------------------------------------------------------------------------

export const STORY_TYPES = [
  { id: 'READER', name: 'قراءة', code: 'RDR', hint: 'المذيع يقرأ الخبر', read: true, clip: false, manual: false },
  { id: 'VO', name: 'صورة بصوت المذيع', code: 'VO', hint: 'المذيع يقرأ فوق الصورة', read: true, clip: true, manual: false },
  { id: 'SOT', name: 'تصريح', code: 'SOT', hint: 'مقدمة من المذيع ثم التصريح', read: true, clip: true, manual: false },
  { id: 'VOSOT', name: 'صورة وتصريح', code: 'VO/SOT', hint: 'قراءة فوق الصورة ثم تصريح', read: true, clip: true, manual: false },
  { id: 'PKG', name: 'تقرير', code: 'PKG', hint: 'مقدمة المذيع ثم التقرير كاملاً', read: true, clip: true, manual: false },
  { id: 'LIVE', name: 'رسالة مباشرة', code: 'LIVE', hint: 'مقدمة ثم المراسل على الهواء', read: true, clip: false, manual: true },
  { id: 'PHONE', name: 'اتصال هاتفي', code: 'PHO', hint: 'مقدمة ثم مداخلة هاتفية', read: true, clip: false, manual: true },
  { id: 'HEADLINES', name: 'العناوين', code: 'HDL', hint: 'عناوين النشرة', read: true, clip: false, manual: false },
  { id: 'SPORT', name: 'رياضة', code: 'SPT', hint: 'فقرة الرياضة', read: true, clip: true, manual: false },
  { id: 'WEATHER', name: 'طقس', code: 'WX', hint: 'النشرة الجوية', read: true, clip: false, manual: true },
  { id: 'BREAK', name: 'فاصل', code: 'BRK', hint: 'فاصل إعلاني', read: false, clip: false, manual: true },
] as const;
export type StoryType = (typeof STORY_TYPES)[number]['id'];
export const storyTypeOf = (id?: string) => STORY_TYPES.find((t) => t.id === id) || STORY_TYPES[0];

export const STORY_STATUSES = [
  { id: 'DRAFT', name: 'مسودة' },
  { id: 'READY', name: 'جاهزة للاعتماد' },
  { id: 'APPROVED', name: 'معتمدة' },
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number]['id'];
export const storyStatusName = (id?: string) => STORY_STATUSES.find((s) => s.id === id)?.name || 'مسودة';

export const GRAPHIC_KINDS = [
  { id: 'STRAP', name: 'شارة اسم' },
  { id: 'TITLE', name: 'عنوان سفلي' },
  { id: 'FULLSCREEN', name: 'شاشة كاملة' },
  { id: 'MAP', name: 'خريطة' },
] as const;
export type GraphicKind = (typeof GRAPHIC_KINDS)[number]['id'];

export interface StoryGraphic {
  kind: GraphicKind;
  lines: string[];
}

export const BULLETIN_KINDS = [
  { id: 'MAIN', name: 'نشرة رئيسية' },
  { id: 'BRIEF', name: 'موجز' },
  { id: 'HOURLY', name: 'نشرة الساعة' },
  { id: 'SPECIAL', name: 'تغطية خاصة' },
] as const;
export type BulletinKind = (typeof BULLETIN_KINDS)[number]['id'];
export const bulletinKindName = (id?: string) => BULLETIN_KINDS.find((k) => k.id === id)?.name || 'نشرة';

export const BULLETIN_STATUSES = [
  { id: 'PLANNING', name: 'قيد الإعداد' },
  { id: 'ON_AIR', name: 'على الهواء' },
  { id: 'DONE', name: 'أُذيعت' },
] as const;
export type BulletinStatus = (typeof BULLETIN_STATUSES)[number]['id'];

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface Bulletin {
  id: string;
  title: string;
  kind: BulletinKind;
  /** Local air date (YYYY-MM-DD) and time (HH:MM). */
  date: string;
  startTime: string;
  /** Planned length; the hard out is start + planned. */
  plannedSeconds: number;
  editorId?: string;
  editorName?: string;
  anchors: string[];
  studioName?: string;
  status: BulletinStatus;
  notes?: string;
  formatId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BulletinStory {
  id: string;
  bulletinId: string;
  /** Sort key; moving a story only rewrites that story, so colleagues' edits never collide. */
  rank: number;
  slug: string;
  type: StoryType;
  anchorName?: string;
  /** What the anchor reads (intro / link / full reader). */
  script: string;
  clipMediaId?: string;
  clipSeconds?: number;
  /** Duration for live links, phone-ins, weather and breaks. */
  manualSeconds?: number;
  graphics?: StoryGraphic[];
  directorNotes?: string;
  newsId?: string;
  /** updatedAt of the newsroom story when its text was taken, to flag later changes. */
  newsUpdatedAt?: string;
  wireId?: string;
  status: StoryStatus;
  floated?: boolean;
  killed?: boolean;
  writerId?: string;
  writerName?: string;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string;
  returnNote?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/** A reusable bulletin layout, optionally on a weekly schedule. */
export interface BulletinFormat {
  id: string;
  name: string;
  kind: BulletinKind;
  startTime: string;
  plannedSeconds: number;
  /** Weekdays it airs (0 = Sunday). Empty = template only, never scheduled. */
  days: number[];
  /** Create the day's bulletin automatically (otherwise the desk creates it from the list). */
  autoCreate: boolean;
  editorId?: string;
  editorName?: string;
  anchors?: string[];
  studioName?: string;
  stories: { slug: string; type: StoryType; manualSeconds?: number; script?: string }[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Arabic newsreading pace (about 130 words a minute). */
export const WORDS_PER_SECOND = 2.16;

export function plainText(html: string): string {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Anchor read time; bracketed directions like [كاميرا 2] are not read aloud. */
export function readSeconds(script: string): number {
  const words = (String(script || '').replace(/\[[^\]]*\]/g, ' ').match(/\S+/g) || []).length;
  return words ? Math.max(3, Math.ceil(words / WORDS_PER_SECOND)) : 0;
}

export function storyTiming(s: Pick<BulletinStory, 'type' | 'script' | 'clipSeconds' | 'manualSeconds'>) {
  const t = storyTypeOf(s.type);
  const read = t.read ? readSeconds(s.script) : 0;
  const clip = t.clip ? Math.round(Number(s.clipSeconds) || 0) : 0;
  const manual = t.manual ? Math.round(Number(s.manualSeconds) || 0) : 0;
  return { read, clip, manual, total: read + clip + manual };
}

export const byRank = <T extends { rank: number }>(a: T, b: T) => a.rank - b.rank;

/** Stories that air: ordered, not floated, not killed. */
export const airStories = <T extends BulletinStory>(stories: T[]) => stories.filter((s) => !s.deletedAt && !s.floated && !s.killed).sort(byRank);

export const minutesOfDay = (hhmm?: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

export const clockOf = (secondsOfDay: number) => {
  const s = ((Math.round(secondsOfDay) % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const mmss = (seconds: number) => {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(Math.round(seconds));
  return `${sign}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Front time (when each story starts on the clock), back time (when it must start to hit
 * the hard out), and over/under for the whole bulletin.
 */
export function bulletinTiming(bulletin: Pick<Bulletin, 'startTime' | 'plannedSeconds'>, stories: BulletinStory[]) {
  const start = minutesOfDay(bulletin.startTime) * 60;
  const hardOut = start + (Number(bulletin.plannedSeconds) || 0);
  const list = airStories(stories);
  const durations = list.map((s) => storyTiming(s).total);
  const total = durations.reduce((a, b) => a + b, 0);
  const rows = new Map<string, { front: number; back: number; duration: number }>();
  let front = start;
  let remaining = total;
  list.forEach((s, i) => {
    rows.set(s.id, { front, back: hardOut - remaining, duration: durations[i] });
    front += durations[i];
    remaining -= durations[i];
  });
  return { start, hardOut, total, planned: Number(bulletin.plannedSeconds) || 0, overUnder: total - (Number(bulletin.plannedSeconds) || 0), rows };
}

/** Rank between two neighbours (or at an end) for inserting/moving a story. */
export function rankBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const CONTENT_FIELDS = ['slug', 'type', 'script', 'clipMediaId', 'clipSeconds', 'manualSeconds', 'graphics', 'anchorName'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const storyContentChanged = (before: any, after: any) => CONTENT_FIELDS.some((k) => !same(before?.[k], after?.[k]));

export interface BulletinActor {
  id: string;
  /** Holds bulletins.approve (chief editors). */
  canApprove: boolean;
  canEdit: boolean;
}

/** The bulletin's responsible editor or a chief editor approves its stories. */
export const isApprover = (bulletin: Pick<Bulletin, 'editorId'> | null | undefined, actor: BulletinActor) =>
  actor.canApprove || (!!bulletin?.editorId && bulletin.editorId === actor.id);

export function storyError(s: any): string | null {
  if (!s || typeof s.bulletinId !== 'string' || !s.bulletinId) return 'القصة غير مرتبطة بنشرة';
  if (typeof s.slug !== 'string' || !s.slug.trim() || s.slug.length > 200) return 'عنوان القصة (Slug) مطلوب';
  if (!STORY_TYPES.some((t) => t.id === s.type)) return 'نوع القصة غير معروف';
  if (!STORY_STATUSES.some((t) => t.id === s.status)) return 'حالة القصة غير معروفة';
  if (typeof s.rank !== 'number' || !Number.isFinite(s.rank)) return 'ترتيب القصة غير صالح';
  if (typeof s.script !== 'string' || s.script.length > 20000) return 'نص القصة غير صالح';
  if (s.graphics !== undefined && (!Array.isArray(s.graphics) || s.graphics.length > 20 || s.graphics.some((g: any) => !GRAPHIC_KINDS.some((k) => k.id === g?.kind) || !Array.isArray(g.lines))))
    return 'الشارات غير صالحة';
  return null;
}

/**
 * Status changes: writers mark a story ready (or pull it back to draft); only an approver
 * approves or sends it back. Returns an error, or null when allowed.
 */
export function storyStatusError(before: any, after: any, bulletin: any, actor: BulletinActor): string | null {
  const from = before?.status || 'DRAFT';
  const to = after.status;
  if (from === to) return null;
  if (to === 'APPROVED') return isApprover(bulletin, actor) ? null : 'اعتماد القصة لمحرر النشرة المسؤول';
  if (from === 'APPROVED') return isApprover(bulletin, actor) || storyContentChanged(before, after) ? null : 'إلغاء الاعتماد لمحرر النشرة';
  return actor.canEdit ? null : 'صلاحياتك لا تسمح بتعديل قصص النشرة';
}

export function bulletinError(b: any): string | null {
  if (!b || typeof b.title !== 'string' || !b.title.trim()) return 'عنوان النشرة مطلوب';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return 'تاريخ النشرة غير صالح';
  if (!/^\d{2}:\d{2}$/.test(b.startTime || '')) return 'موعد النشرة غير صالح';
  if (!(Number(b.plannedSeconds) > 0) || b.plannedSeconds > 6 * 3600) return 'مدة النشرة غير صالحة';
  if (!BULLETIN_KINDS.some((k) => k.id === b.kind)) return 'نوع النشرة غير معروف';
  if (!BULLETIN_STATUSES.some((k) => k.id === b.status)) return 'حالة النشرة غير معروفة';
  if (!Array.isArray(b.anchors)) return 'المذيعون غير صالحين';
  return null;
}

export function formatError(f: any): string | null {
  if (!f || typeof f.name !== 'string' || !f.name.trim()) return 'اسم القالب مطلوب';
  if (!/^\d{2}:\d{2}$/.test(f.startTime || '')) return 'موعد القالب غير صالح';
  if (!(Number(f.plannedSeconds) > 0)) return 'مدة القالب غير صالحة';
  if (!Array.isArray(f.days) || f.days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) return 'أيام الجدولة غير صالحة';
  if (!Array.isArray(f.stories) || f.stories.length > 80 || f.stories.some((s: any) => !s?.slug || !STORY_TYPES.some((t) => t.id === s.type))) return 'قصص القالب غير صالحة';
  return null;
}

// ---------------------------------------------------------------------------
// Formats & scheduling
// ---------------------------------------------------------------------------

/** Stable id so a scheduled bulletin is created once per day, whoever creates it. */
export const scheduledBulletinId = (formatId: string, date: string) => `bul-${formatId}-${date}`;

export const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay();

export const isScheduledOn = (f: Pick<BulletinFormat, 'days' | 'deletedAt'>, date: string) => !f.deletedAt && f.days.includes(weekdayOf(date));

/** Builds a bulletin and its skeleton stories from a format. */
export function bulletinFromFormat(
  f: BulletinFormat,
  date: string,
  id: string,
  makeId: (prefix: string) => string,
  now = new Date().toISOString()
): { bulletin: Bulletin; stories: BulletinStory[] } {
  const bulletin: Bulletin = {
    id,
    title: `${f.name} — ${arabicDate(date)}`,
    kind: f.kind,
    date,
    startTime: f.startTime,
    plannedSeconds: f.plannedSeconds,
    editorId: f.editorId,
    editorName: f.editorName,
    anchors: f.anchors || [],
    studioName: f.studioName,
    status: 'PLANNING',
    formatId: f.id,
    createdAt: now,
    updatedAt: now,
  };
  const stories = f.stories.map((s, i) => ({
    id: makeId('bst'),
    bulletinId: id,
    rank: (i + 1) * 1000,
    slug: s.slug,
    type: s.type,
    script: s.script || '',
    manualSeconds: s.manualSeconds,
    status: 'DRAFT' as const,
    createdAt: now,
    updatedAt: now,
  }));
  return { bulletin, stories };
}

/** Headline lines from the top stories: the first sentence of each script, or its slug. */
export function headlinesFrom(stories: BulletinStory[], count = 4): string {
  return airStories(stories)
    .filter((s) => !['HEADLINES', 'BREAK', 'WEATHER'].includes(s.type))
    .slice(0, count)
    .map((s) => {
      const first = s.script.split(/[.!؟?\n]/)[0]?.trim();
      return `• ${first && first.length <= 140 ? first : s.slug}`;
    })
    .join('\n');
}

/** A bulletin as a playable show for on-air mode, the studio screen and the prompter. */
export function bulletinAsShow(b: Bulletin, stories: BulletinStory[]) {
  return {
    id: b.id,
    kind: 'bulletin' as const,
    title: b.title,
    programName: bulletinKindName(b.kind),
    broadcastDate: b.date,
    startTime: b.startTime,
    status: b.status === 'ON_AIR' ? 'ON_AIR' : b.status === 'DONE' ? 'BROADCASTED' : 'READY_FOR_BROADCAST',
    durationMinutes: Math.round((b.plannedSeconds || 0) / 60),
    presenterName: b.anchors.join('، '),
    studioName: b.studioName,
    guests: [],
    questions: [],
    rundown: airStories(stories).map((s, i) => ({
      id: s.id,
      episodeId: b.id,
      orderIndex: i + 1,
      title: s.slug,
      segmentType: s.type === 'BREAK' ? 'BREAK' : s.type === 'PKG' ? 'REPORT' : 'NEWS_ITEM',
      durationSeconds: storyTiming(s).total,
      presenterName: s.anchorName || b.anchors[0] || '',
      // Only approved copy reaches the prompter.
      scriptText: s.status === 'APPROVED' ? s.script : '⟨القصة بانتظار اعتماد محرر النشرة⟩',
      graphics: s.graphics || [],
      notApproved: s.status !== 'APPROVED',
      notes: s.directorNotes || '',
      storyType: s.type,
    })),
  };
}

/** The playable show behind an on-air id: a programme episode or a bulletin. */
export function findShow(id: string, list: (collection: 'episodes' | 'bulletins' | 'bulletinStories') => any[]): any | null {
  const episode = list('episodes').find((e) => e.id === id && !e.deletedAt);
  if (episode) return episode;
  const bulletin = list('bulletins').find((b) => b.id === id && !b.deletedAt);
  if (!bulletin) return null;
  return bulletinAsShow(bulletin, list('bulletinStories').filter((s) => s.bulletinId === id && !s.deletedAt));
}
