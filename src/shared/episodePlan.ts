/**
 * How a producer builds an episode: a brief, topics (محاور) that group segments,
 * guests with roles and a booking pipeline, questions tied to a segment and a guest,
 * and filmed reports with a brief and a sourcing option.
 * Shared by the client and the server so both read old and new episodes the same way.
 */

// ---------------------------------------------------------------------------
// Brief & topics
// ---------------------------------------------------------------------------

export interface EpisodeBrief {
  idea?: string;
  angle?: string;
  message?: string;
  audience?: string;
  sources?: string;
}

export interface EpisodeTopic {
  id: string;
  title: string;
  angle?: string;
  /** Planned airtime for the whole topic, in seconds. */
  targetSeconds?: number;
  /** Research notes and talking points for the producer and presenter. */
  notes?: string;
  newsIds?: string[];
  storyId?: string;
}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

export const GUEST_ROLES = [
  { id: 'MAIN', name: 'ضيف رئيسي' },
  { id: 'COMMENTATOR', name: 'معقّب' },
  { id: 'CALLER', name: 'مداخلة' },
] as const;
export type GuestRole = (typeof GUEST_ROLES)[number]['id'];
export const guestRoleName = (id?: string) => GUEST_ROLES.find((r) => r.id === id)?.name || 'ضيف';

export interface SegmentGuest {
  guestId: string;
  guestName: string;
  role: GuestRole;
}

export const BOOKING_STATUSES = [
  { id: 'CANDIDATE', name: 'مرشّح', tone: 'slate' },
  { id: 'CONTACTED', name: 'تم التواصل', tone: 'amber' },
  { id: 'CONFIRMED', name: 'مؤكد', tone: 'emerald' },
  { id: 'DECLINED', name: 'اعتذر', tone: 'red' },
  { id: 'ARRIVED', name: 'وصل / على الخط', tone: 'blue' },
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number]['id'];
export const bookingStatusName = (id?: string) => BOOKING_STATUSES.find((s) => s.id === id)?.name || 'مرشّح';
export const isBooked = (s?: string) => s === 'CONFIRMED' || s === 'ARRIVED';

export const CONNECTION_TYPES = [
  { id: 'STUDIO', name: 'في الاستديو' },
  { id: 'SATELLITE', name: 'عبر الأقمار الصناعية' },
  { id: 'ZOOM_SKYPE', name: 'اتصال مرئي عبر الإنترنت' },
  { id: 'PHONE', name: 'هاتفياً' },
] as const;
export const connectionName = (id?: string) => CONNECTION_TYPES.find((c) => c.id === id)?.name || 'في الاستديو';

export interface ContactLogEntry {
  at: string;
  byName: string;
  note: string;
}

/** The booking status of an episode guest; older records only carried an arrival status. */
export function bookingStatusOf(g: any): BookingStatus {
  if (g?.bookingStatus && BOOKING_STATUSES.some((s) => s.id === g.bookingStatus)) return g.bookingStatus;
  if (g?.arrivalStatus === 'ARRIVED') return 'ARRIVED';
  if (g?.arrivalStatus === 'CONFIRMED') return 'CONFIRMED';
  if (g?.arrivalStatus === 'PENDING') return 'CONTACTED';
  return 'CANDIDATE';
}

/** Keeps the legacy arrival status in step so older screens stay correct. */
export function arrivalFromBooking(s: BookingStatus): 'CONFIRMED' | 'PENDING' | 'ARRIVED' {
  return s === 'ARRIVED' ? 'ARRIVED' : s === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING';
}

/** Guests of a segment; older segments had a single guestId. */
export function segmentGuests(seg: any): SegmentGuest[] {
  if (Array.isArray(seg?.guests)) return seg.guests.filter((g: any) => g && g.guestId);
  return seg?.guestId ? [{ guestId: seg.guestId, guestName: seg.guestName || '', role: 'MAIN' }] : [];
}

/** Legacy single-guest fields follow the first (main) guest of the list. */
export function withSegmentGuests<T extends Record<string, any>>(seg: T, guests: SegmentGuest[]): T {
  const main = guests.find((g) => g.role === 'MAIN') || guests[0];
  return { ...seg, guests, guestId: main?.guestId, guestName: main?.guestName };
}

export const guestKey = (g: any): string => g?.guestId || g?.id || '';

/**
 * Everyone taking part in the episode: the booked list plus anyone placed in a segment but
 * not yet on it (shown as candidates until the producer starts booking them).
 */
export function episodeGuestList(episode: any): any[] {
  const list: any[] = [...(episode?.guests || [])];
  const known = new Set(list.map(guestKey));
  for (const seg of episode?.rundown || []) {
    for (const g of segmentGuests(seg)) {
      if (known.has(g.guestId)) continue;
      known.add(g.guestId);
      list.push({ guestId: g.guestId, guestName: g.guestName, connectionType: 'STUDIO', segmentTopic: seg.title, arrivalStatus: 'PENDING', bookingStatus: 'CANDIDATE', virtual: true });
    }
  }
  return list;
}

/** Segments a guest appears in, in rundown order. */
export const guestSegments = (episode: any, guestId: string) =>
  (episode?.rundown || []).filter((s: any) => segmentGuests(s).some((g) => g.guestId === guestId));

const minutesOf = (hhmm?: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Other episodes airing at an overlapping time that have the same guest. */
export function guestClashes(episode: any, guestId: string, allEpisodes: any[]): any[] {
  const day = (episode?.broadcastDate || '').slice(0, 10);
  const start = minutesOf(episode?.startTime);
  const end = minutesOf(episode?.endTime);
  return allEpisodes.filter((other) => {
    if (!other || other.id === episode.id || other.deletedAt || ['CANCELLED', 'ARCHIVED'].includes(other.status)) return false;
    if ((other.broadcastDate || '').slice(0, 10) !== day) return false;
    if (!episodeGuestList(other).some((g) => guestKey(g) === guestId && bookingStatusOf(g) !== 'DECLINED')) return false;
    const os = minutesOf(other.startTime);
    const oe = minutesOf(other.endTime);
    if (start === null || end === null || os === null || oe === null) return true;
    return os < end && start < oe;
  });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const QUESTION_KINDS = [
  { id: 'MAIN', name: 'أساسي' },
  { id: 'BACKUP', name: 'احتياطي' },
  { id: 'FOLLOWUP', name: 'متابعة' },
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number]['id'];
export const questionKindName = (id?: string) => QUESTION_KINDS.find((k) => k.id === id)?.name || 'أساسي';

/** Segment types built around a conversation, which need prepared questions. */
export const TALK_SEGMENT_TYPES = new Set(['LIVE_INTERVIEW', 'DISCUSSION']);

/** Questions prepared for a segment: linked ones, plus older ones aimed at one of its guests. */
export function segmentQuestions(episode: any, seg: any): any[] {
  const names = new Set(segmentGuests(seg).map((g) => g.guestName).filter(Boolean));
  return (episode?.questions || []).filter((q: any) => (q.segmentId ? q.segmentId === seg.id : !!q.assignedToName && names.has(q.assignedToName)));
}

// ---------------------------------------------------------------------------
// Filmed reports
// ---------------------------------------------------------------------------

export const REPORT_SOURCES = [
  { id: 'FIELD', name: 'طلب لقسم المراسلين', hint: 'يصل لمناوبي قسم المراسلين ويقبله أحدهم', requestType: 'FIELD' },
  { id: 'ASSIGNED', name: 'تكليف مراسل بالاسم', hint: 'يصل الطلب للمراسل المختار مباشرة', requestType: 'FIELD' },
  { id: 'IN_HOUSE', name: 'إعداد داخلي من فريق البرنامج', hint: 'المعد يجهز المادة من مصادر متاحة', requestType: null },
  { id: 'ARCHIVE', name: 'مواد من الأرشيف', hint: 'يصل طلب لقسم الأرشيف لتجهيز المواد', requestType: 'ARCHIVE' },
  { id: 'AGENCY', name: 'مواد وكالات الأنباء', hint: 'اختر المادة من مكتبة الوسائط أو البرقيات', requestType: null },
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number]['id'];
export const reportSourceOf = (id?: string) => REPORT_SOURCES.find((s) => s.id === id);

export interface ReportBrief {
  source: ReportSource;
  reporterId?: string;
  reporterName?: string;
  location?: string;
  /** Shots and interviews wanted. */
  shots?: string;
  soundbites?: string;
  targetSeconds?: number;
  sourceNote?: string;
  dueAt?: string;
}

export function reportBriefError(r: any): string | null {
  if (!r) return null;
  if (!reportSourceOf(r.source)) return 'مصدر التقرير غير معروف';
  if (r.source === 'ASSIGNED' && !r.reporterId) return 'اختر المراسل المكلف بالتقرير';
  return null;
}

/** Structural checks the server applies to every saved episode. */
export function episodePlanError(ep: any): string | null {
  if (ep.topics !== undefined) {
    if (!Array.isArray(ep.topics) || ep.topics.length > 50) return 'محاور الحلقة غير صالحة';
    const ids = new Set<string>();
    for (const t of ep.topics) {
      if (!t || typeof t.id !== 'string' || typeof t.title !== 'string' || !t.title.trim()) return 'لكل محور عنوان';
      if (ids.has(t.id)) return 'محور مكرر';
      ids.add(t.id);
    }
  }
  for (const seg of Array.isArray(ep.rundown) ? ep.rundown : []) {
    if (seg?.guests !== undefined) {
      if (!Array.isArray(seg.guests) || seg.guests.length > 12) return 'ضيوف الفقرة غير صالحين';
      if (seg.guests.some((g: any) => !g?.guestId || !GUEST_ROLES.some((r) => r.id === g.role))) return 'دور الضيف في الفقرة غير معروف';
    }
    const err = reportBriefError(seg?.report);
    if (err) return `«${seg.title}»: ${err}`;
  }
  for (const g of Array.isArray(ep.guests) ? ep.guests : []) {
    if (g?.bookingStatus !== undefined && !BOOKING_STATUSES.some((s) => s.id === g.bookingStatus)) return 'حالة حجز الضيف غير معروفة';
  }
  for (const q of Array.isArray(ep.questions) ? ep.questions : []) {
    if (q?.kind !== undefined && !QUESTION_KINDS.some((k) => k.id === q.kind)) return 'نوع السؤال غير معروف';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arranging the rundown by topic
// ---------------------------------------------------------------------------

/** Segments grouped under the episode's topics (rundown order kept inside each group). */
export function groupByTopic(episode: any): { topic: EpisodeTopic | null; segments: any[] }[] {
  const topics: EpisodeTopic[] = episode?.topics || [];
  const ids = new Set(topics.map((t) => t.id));
  const rundown: any[] = episode?.rundown || [];
  const groups = topics.map((topic) => ({ topic, segments: rundown.filter((s) => s.topicId === topic.id) }));
  const loose = rundown.filter((s) => !s.topicId || !ids.has(s.topicId));
  return loose.length ? [...groups, { topic: null, segments: loose }] : groups;
}

/**
 * Rebuilds the rundown so each topic's segments sit together in topic order.
 * Segments without a topic that open the show stay first; the rest (closing, breaks) go last.
 */
export function arrangeByTopics<T extends { topicId?: string }>(rundown: T[], topics: EpisodeTopic[]): T[] {
  const order = new Map(topics.map((t, i) => [t.id, i]));
  const firstTopical = rundown.findIndex((s) => s.topicId && order.has(s.topicId));
  if (firstTopical === -1) return rundown;
  const head = rundown.slice(0, firstTopical).filter((s) => !s.topicId || !order.has(s.topicId));
  const tail = rundown.slice(firstTopical).filter((s) => !s.topicId || !order.has(s.topicId));
  const topical = rundown
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.topicId && order.has(s.topicId))
    .sort((a, b) => order.get(a.s.topicId!)! - order.get(b.s.topicId!)! || a.i - b.i)
    .map(({ s }) => s);
  return [...head, ...topical, ...tail];
}

/** Inserts a new segment at the end of its topic (or before the closing segments). */
export function insertIntoTopic<T extends { topicId?: string; segmentType?: string }>(rundown: T[], seg: T): T[] {
  const lastOfTopic = seg.topicId ? rundown.map((s) => s.topicId).lastIndexOf(seg.topicId) : -1;
  if (lastOfTopic !== -1) return [...rundown.slice(0, lastOfTopic + 1), seg, ...rundown.slice(lastOfTopic + 1)];
  const outro = rundown.findIndex((s) => s.segmentType === 'OUTRO');
  if (outro !== -1) return [...rundown.slice(0, outro), seg, ...rundown.slice(outro)];
  return [...rundown, seg];
}

export const sumSeconds = (segs: { durationSeconds?: number }[]) => segs.reduce((a, s) => a + (s.durationSeconds || 0), 0);

// ---------------------------------------------------------------------------
// Program templates
// ---------------------------------------------------------------------------

export interface TemplateSegment {
  title: string;
  segmentType: string;
  durationSeconds: number;
  topicIndex?: number;
  scriptText?: string;
}

export interface ProgramTemplate {
  topics: { title: string; targetSeconds?: number }[];
  segments: TemplateSegment[];
  updatedAt?: string;
  updatedByName?: string;
}

/** The reusable structure of an episode (no guests, questions or media). */
export function templateFromEpisode(episode: any): ProgramTemplate {
  const topics: EpisodeTopic[] = episode?.topics || [];
  const index = new Map(topics.map((t, i) => [t.id, i]));
  return {
    topics: topics.map((t) => ({ title: t.title, targetSeconds: t.targetSeconds })),
    segments: (episode?.rundown || []).map((s: any) => ({
      title: s.title,
      segmentType: s.segmentType,
      durationSeconds: s.durationSeconds || 0,
      topicIndex: s.topicId && index.has(s.topicId) ? index.get(s.topicId) : undefined,
      // Fixed wording (openings, closings) is worth keeping; story scripts are not.
      scriptText: ['INTRO', 'OUTRO', 'BREAK'].includes(s.segmentType) ? s.scriptText || '' : '',
    })),
  };
}

/** Fresh topics and segments for a new episode, with new ids. */
export function structureFromTemplate(
  template: ProgramTemplate,
  episodeId: string,
  makeId: (prefix: string) => string,
  presenterName?: string
): { topics: EpisodeTopic[]; rundown: any[] } {
  const topics = template.topics.map((t) => ({ id: makeId('topic'), title: t.title, targetSeconds: t.targetSeconds }));
  const rundown = template.segments.map((s, i) => ({
    id: makeId('seg'),
    episodeId,
    orderIndex: i + 1,
    title: s.title,
    segmentType: s.segmentType,
    durationSeconds: s.durationSeconds,
    startTimeOffset: '00:00:00',
    endTimeOffset: '00:00:00',
    presenterName: presenterName || '',
    scriptText: s.scriptText || '',
    notes: '',
    isCompleted: false,
    topicId: s.topicIndex !== undefined ? topics[s.topicIndex]?.id : undefined,
  }));
  return { topics, rundown };
}
