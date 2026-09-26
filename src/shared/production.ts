/**
 * Shared production rules: video states, requests between departments and on-air readiness.
 * Used by the browser (UI) and the server (policies), so both always agree.
 */
import type { DepartmentId } from './departments';

// ---------------------------------------------------------------------------
// Video workflow
// ---------------------------------------------------------------------------

export const VIDEO_STATUSES = [
  { id: 'RAW', name: 'خام' },
  { id: 'EDITING', name: 'قيد المونتاج' },
  { id: 'READY', name: 'جاهز' },
  { id: 'APPROVED', name: 'معتمد للبث' },
] as const;

export type VideoStatus = (typeof VIDEO_STATUSES)[number]['id'];

export const videoStatusName = (s?: string) => VIDEO_STATUSES.find((v) => v.id === s)?.name || 'خام';
export const isVideoReady = (s?: string) => s === 'READY' || s === 'APPROVED';

// ---------------------------------------------------------------------------
// Requests between departments
// ---------------------------------------------------------------------------

export const REQUEST_TYPES = [
  { id: 'MONTAGE', name: 'مونتاج', departmentId: 'montage' },
  { id: 'GRAPHICS', name: 'جرافيك وشارات', departmentId: 'graphics' },
  { id: 'STUDIO', name: 'تجهيز الاستديو', departmentId: 'studio' },
  { id: 'GUEST', name: 'تنسيق ضيف', departmentId: 'production' },
  { id: 'AUDIO', name: 'الصوت', departmentId: 'audio' },
  { id: 'LIGHTING', name: 'الإضاءة', departmentId: 'lighting' },
  { id: 'ARCHIVE', name: 'مواد من الأرشيف', departmentId: 'archive' },
  { id: 'FIELD', name: 'تغطية ميدانية', departmentId: 'field' },
  { id: 'DIRECTION', name: 'الإخراج', departmentId: 'direction' },
  { id: 'CONTROL', name: 'الكنترول', departmentId: 'control' },
] as const satisfies readonly { id: string; name: string; departmentId: DepartmentId }[];

export type RequestType = (typeof REQUEST_TYPES)[number]['id'];

export const REQUEST_STATUSES = [
  { id: 'OPEN', name: 'جديد' },
  { id: 'ACCEPTED', name: 'قيد التنفيذ' },
  { id: 'DONE', name: 'منجز' },
  { id: 'REJECTED', name: 'مرفوض' },
  { id: 'CANCELLED', name: 'ملغى' },
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number]['id'];

export const requestTypeOf = (id?: string) => REQUEST_TYPES.find((t) => t.id === id);
export const requestStatusName = (s?: string) => REQUEST_STATUSES.find((r) => r.id === s)?.name || s || '';
export const isRequestClosed = (s?: string) => s === 'DONE' || s === 'REJECTED' || s === 'CANCELLED';

export interface RequestLink {
  kind: 'news' | 'segment' | 'episode';
  newsId?: string;
  episodeId?: string;
  segmentId?: string;
  title: string;
}

export interface DeptRequest {
  id: string;
  type: RequestType;
  departmentId: DepartmentId;
  title: string;
  details?: string;
  priority: 'NORMAL' | 'URGENT';
  status: RequestStatus;
  requesterId: string;
  requesterName: string;
  requesterDepartmentId?: string;
  assigneeId?: string;
  assigneeName?: string;
  link?: RequestLink;
  /** e.g. lower-third lines for the graphics desk. */
  lines?: string[];
  /** Media produced for the request (e.g. the edited package). */
  resultMediaId?: string;
  resolution?: string;
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
  history?: { status: RequestStatus; byId: string; byName: string; at: string; note?: string }[];
  deletedAt?: string | null;
}

interface Actor {
  id: string;
  departmentId: string;
  /** Holds requests.manage (desk chiefs and management). */
  canManage: boolean;
}

const CONTENT_FIELDS = ['title', 'details', 'priority', 'dueAt', 'lines', 'link'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Who may move a request between states. Returns an error message, or null when allowed.
 * Handlers are members of the target department; requesters may edit or cancel their own requests.
 */
export function requestChangeError(before: DeptRequest | null, after: DeptRequest, actor: Actor): string | null {
  const type = requestTypeOf(after.type);
  if (!type) return 'نوع الطلب غير معروف';
  if (after.departmentId !== type.departmentId) return 'القسم لا يطابق نوع الطلب';
  if (typeof after.title !== 'string' || !after.title.trim()) return 'عنوان الطلب مطلوب';
  if (!REQUEST_STATUSES.some((s) => s.id === after.status)) return 'حالة الطلب غير معروفة';

  if (!before) return after.status === 'OPEN' ? null : 'الطلب الجديد يبدأ بحالة «جديد»';

  const isRequester = before.requesterId === actor.id;
  const isHandler = actor.departmentId === before.departmentId || actor.canManage;
  if (before.type !== after.type || before.requesterId !== after.requesterId) return 'لا يمكن تغيير نوع الطلب أو صاحبه';

  if (before.status !== after.status) {
    const from = before.status;
    const to = after.status;
    const ok =
      (to === 'ACCEPTED' && from === 'OPEN' && isHandler) ||
      (to === 'OPEN' && from === 'ACCEPTED' && (isHandler || isRequester)) ||
      (to === 'DONE' && (from === 'OPEN' || from === 'ACCEPTED') && isHandler) ||
      (to === 'REJECTED' && (from === 'OPEN' || from === 'ACCEPTED') && isHandler) ||
      (to === 'CANCELLED' && !isRequestClosed(from) && (isRequester || actor.canManage)) ||
      (to === 'ACCEPTED' && from === 'DONE' && (isRequester || actor.canManage));
    if (!ok) return 'لا يمكنك نقل الطلب إلى هذه الحالة';
    if (to === 'REJECTED' && !(after.resolution || '').trim()) return 'اذكر سبب الرفض';
  }

  const contentChanged = CONTENT_FIELDS.some((k) => !same((before as any)[k], (after as any)[k]));
  if (contentChanged && !(isRequester || actor.canManage)) return 'تعديل تفاصيل الطلب لصاحبه فقط';
  if (contentChanged && isRequestClosed(before.status)) return 'لا يمكن تعديل طلب مغلق';
  const resultChanged = !same(before.resultMediaId, after.resultMediaId) || !same(before.resolution, after.resolution);
  if (resultChanged && !isHandler && !isRequester) return 'نتيجة الطلب يسجلها القسم المنفذ';
  return null;
}

// ---------------------------------------------------------------------------
// On-air readiness
// ---------------------------------------------------------------------------

export type ReadinessState = 'ready' | 'pending' | 'missing';

export interface ReadinessItem {
  key: string;
  label: string;
  departmentId: DepartmentId;
  state: ReadinessState;
  detail: string;
}

interface ReadinessContext {
  requests: DeptRequest[];
  media: { id: string; mediaType?: string; videoStatus?: string; title?: string; fileName?: string }[];
}

/** Segment types that are played out as a package and therefore need an edited video. */
export const VIDEO_SEGMENT_TYPES = new Set(['REPORT']);

export function segmentReadiness(segment: any, episode: any, ctx: ReadinessContext): ReadinessItem[] {
  if (!segment || segment.segmentType === 'BREAK') return [];
  const items: ReadinessItem[] = [];

  const hasText = !!((segment.scriptText || segment.script || '').trim() || segment.newsId);
  items.push({
    key: 'text',
    label: 'النص',
    departmentId: 'newsroom',
    state: hasText ? 'ready' : 'missing',
    detail: hasText ? 'النص جاهز' : 'لا يوجد نص للفقرة',
  });

  if (VIDEO_SEGMENT_TYPES.has(segment.segmentType)) {
    // Attached videos plus packages delivered through a finished montage request for this segment.
    const delivered = ctx.requests
      .filter((r) => !r.deletedAt && r.type === 'MONTAGE' && r.status === 'DONE' && r.link?.segmentId === segment.id && r.resultMediaId)
      .map((r) => r.resultMediaId as string);
    const videos = [...new Set([...(segment.mediaIds || []), ...delivered])]
      .map((id: string) => ctx.media.find((m) => m.id === id))
      .filter((m: any) => m && m.mediaType === 'VIDEO');
    const ready = videos.some((v: any) => isVideoReady(v.videoStatus)) || !!segment.videoAssetUrl;
    items.push({
      key: 'video',
      label: 'الفيديو',
      departmentId: 'montage',
      state: ready ? 'ready' : videos.length ? 'pending' : 'missing',
      detail: ready ? 'الفيديو جاهز' : videos.length ? `الفيديو ${videoStatusName(videos[0].videoStatus)}` : 'لم يُرفق فيديو',
    });
  }

  if (segment.guestId) {
    const g = (episode?.guests || []).find((x: any) => (x.guestId || x.id) === segment.guestId);
    const confirmed = g && (g.arrivalStatus === 'CONFIRMED' || g.arrivalStatus === 'ARRIVED');
    items.push({
      key: 'guest',
      label: 'الضيف',
      departmentId: 'production',
      state: confirmed ? 'ready' : 'pending',
      detail: confirmed ? (g.arrivalStatus === 'ARRIVED' ? 'الضيف وصل' : 'الضيف مؤكد') : 'لم يُؤكد حضور الضيف',
    });
  }

  // Requests raised for this segment: every department involved must have finished.
  const open = new Map<string, DeptRequest[]>();
  for (const r of ctx.requests) {
    if (r.deletedAt || r.link?.segmentId !== segment.id || r.status === 'CANCELLED' || r.status === 'REJECTED') continue;
    const list = open.get(r.departmentId) || [];
    list.push(r);
    open.set(r.departmentId, list);
  }
  for (const [departmentId, list] of open) {
    const pending = list.filter((r) => r.status !== 'DONE');
    const type = requestTypeOf(list[0].type);
    items.push({
      key: `req:${departmentId}`,
      label: type?.name || departmentId,
      departmentId: departmentId as DepartmentId,
      state: pending.length ? 'pending' : 'ready',
      detail: pending.length ? `${pending.length} طلب قيد التنفيذ` : 'الطلبات منجزة',
    });
  }
  return items;
}

export function episodeReadiness(episode: any, ctx: ReadinessContext) {
  const segments = (episode?.rundown || []).filter((s: any) => s.segmentType !== 'BREAK');
  const blockers: { segmentId: string; segmentTitle: string; label: string; detail: string; departmentId: DepartmentId }[] = [];
  let readySegments = 0;
  for (const seg of segments) {
    const items = segmentReadiness(seg, episode, ctx);
    const notReady = items.filter((i) => i.state !== 'ready');
    if (!notReady.length) readySegments++;
    notReady.forEach((i) => blockers.push({ segmentId: seg.id, segmentTitle: seg.title, label: i.label, detail: i.detail, departmentId: i.departmentId }));
  }
  return { total: segments.length, readySegments, blockers, ready: segments.length > 0 && blockers.length === 0 };
}
