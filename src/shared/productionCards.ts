/**
 * Production cards: one card travels with each item (news, brief, report, bulletin, programme)
 * between stations. It says what has to be done, who owns each step, when it is due and when it
 * airs, carries the approved script and the links to pictures and interviews, and keeps a record
 * of what each colleague did, so the next person sees what is complete and what is missing.
 *
 * The rules below are shared by the browser (to explain a refusal before sending) and the server
 * (which enforces them), so both always agree.
 */
import { stationScope, stationsOf, type Station } from './stations';

export const CARD_KINDS = [
  { id: 'NEWS', name: 'خبر' },
  { id: 'BRIEF', name: 'موجز' },
  { id: 'REPORT', name: 'تقرير' },
  { id: 'BULLETIN', name: 'نشرة' },
  { id: 'PROGRAM', name: 'برنامج' },
  { id: 'INTERVIEW', name: 'مقابلة' },
  { id: 'OTHER', name: 'مادة أخرى' },
] as const;
export type CardKind = (typeof CARD_KINDS)[number]['id'];
export const cardKindName = (id?: string) => CARD_KINDS.find((k) => k.id === id)?.name || 'مادة';

/** A kind of step; the weight says how heavy this kind of work is when loads are compared. */
export interface StepType {
  id: string;
  name: string;
  /** 1 (light) to 10 (heavy). */
  weight: number;
}

/** Starting list; an administrator edits names and weights, adds and removes types in the settings. */
export const DEFAULT_STEP_TYPES: StepType[] = [
  { id: 'gather', name: 'جمع المادة ميدانياً', weight: 3 },
  { id: 'verify', name: 'التحقق', weight: 2 },
  { id: 'edit', name: 'التحرير', weight: 2 },
  { id: 'prep', name: 'الإعداد', weight: 2 },
  { id: 'montage', name: 'المونتاج', weight: 3 },
  { id: 'graphics', name: 'الجرافيك', weight: 2 },
  { id: 'translate', name: 'الترجمة', weight: 2 },
  { id: 'monitor', name: 'الرصد والمتابعة', weight: 2 },
  { id: 'quality', name: 'مراجعة الجودة', weight: 2 },
  { id: 'approve', name: 'الاعتماد', weight: 1 },
  { id: 'publish', name: 'النشر والإدراج في البث', weight: 1 },
];

export const MAX_STEP_TYPES = 40;
const TYPE_ID = /^[a-zA-Z0-9_-]{1,40}$/;

export function stepTypesOf(settings: { cardStepTypes?: StepType[] } | null | undefined): StepType[] {
  return Array.isArray(settings?.cardStepTypes) && settings!.cardStepTypes!.length ? settings!.cardStepTypes! : DEFAULT_STEP_TYPES;
}

export const stepTypeName = (types: StepType[], id?: string) => types.find((t) => t.id === id)?.name || 'مهمة';

export function stepTypesError(value: unknown): string | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_STEP_TYPES) return `أنواع المهام بين 1 و${MAX_STEP_TYPES}`;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const type of value) {
    if (!type || typeof type.id !== 'string' || !TYPE_ID.test(type.id)) return 'معرّف نوع المهمة غير صالح';
    if (typeof type.name !== 'string' || !type.name.trim() || type.name.length > 60) return 'اسم نوع المهمة مطلوب وبحد أقصى 60 حرفاً';
    if (!Number.isInteger(type.weight) || type.weight < 1 || type.weight > 10) return 'وزن نوع المهمة رقم صحيح بين 1 و10';
    const name = type.name.trim().toLocaleLowerCase();
    if (ids.has(type.id) || names.has(name)) return 'اسم نوع المهمة أو معرّفه مكرر';
    ids.add(type.id);
    names.add(name);
  }
  return null;
}

export const COMPLEXITIES = [
  { id: 1, name: 'بسيطة' },
  { id: 2, name: 'متوسطة' },
  { id: 3, name: 'معقدة' },
] as const;
export const complexityName = (n?: number) => COMPLEXITIES.find((c) => c.id === n)?.name || 'بسيطة';

export const STEP_STATUSES = [
  { id: 'TODO', name: 'لم تبدأ' },
  { id: 'IN_PROGRESS', name: 'قيد التنفيذ' },
  { id: 'BLOCKED', name: 'متعطلة' },
  { id: 'DONE', name: 'مكتملة' },
  { id: 'SKIPPED', name: 'غير مطلوبة' },
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number]['id'];
export const stepStatusName = (s?: string) => STEP_STATUSES.find((x) => x.id === s)?.name || s || '';

export const CARD_STATUSES = [
  { id: 'OPEN', name: 'جارية' },
  { id: 'CLOSED', name: 'منجزة ومؤرشفة' },
  { id: 'CANCELLED', name: 'ملغاة' },
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number]['id'];

export interface CardStep {
  id: string;
  /** Id of a StepType (see the settings). */
  type: string;
  /** Optional detail, e.g. «شهادة مصوّرة من مخيم جباليا». */
  title?: string;
  assigneeId?: string;
  assigneeName?: string;
  /** Station doing the step: the assignee's station, or the station asked to pick it up. */
  stationId?: string;
  dueAt?: string;
  status: StepStatus;
  complexity: 1 | 2 | 3;
  /** Planned effort in minutes. */
  estimateMinutes?: number;
  /** Actual effort in minutes, noted by the person who did it. */
  spentMinutes?: number;
  /** Handoff note: what is complete and what is missing. */
  note?: string;
  blockedReason?: string;
  startedAt?: string;
  doneAt?: string;
  doneById?: string;
  doneByName?: string;
}

export interface CardLink {
  label: string;
  url: string;
}

export interface CardLogEntry {
  id: string;
  at?: string;
  byId?: string;
  byName?: string;
  stationId?: string;
  /** NOTE: written by a colleague. STEP: recorded by the server when a step changes hands or state. */
  kind: 'NOTE' | 'STEP';
  stepId?: string;
  text: string;
}

export interface CardTarget {
  kind: 'news' | 'episode' | 'bulletin';
  id: string;
  title: string;
}

export interface ProductionCard {
  id: string;
  title: string;
  kind: CardKind;
  /** What has to be done. */
  brief?: string;
  priority: 'NORMAL' | 'URGENT';
  status: CardStatus;
  /** Who decides when the card is stuck. */
  ownerId?: string;
  ownerName?: string;
  ownerStationId?: string;
  /** Delivery deadline for the finished item. */
  dueAt?: string;
  /** When it airs. */
  airAt?: string;
  script?: string;
  scriptApproved?: boolean;
  scriptApprovedById?: string;
  scriptApprovedByName?: string;
  scriptApprovedAt?: string;
  links?: CardLink[];
  mediaIds?: string[];
  /** The newsroom record this card produces. */
  target?: CardTarget;
  steps: CardStep[];
  log?: CardLogEntry[];
  createdById?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  deletedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Reading a card
// ---------------------------------------------------------------------------

export const isStepOpen = (step: CardStep) => step.status !== 'DONE' && step.status !== 'SKIPPED';
const required = (card: ProductionCard) => (card.steps || []).filter((s) => s.status !== 'SKIPPED');

/** The step the card is waiting on: the first one not finished. */
export const currentStep = (card: ProductionCard): CardStep | undefined => (card.steps || []).find(isStepOpen);

export const isStepLate = (step: CardStep, now = Date.now()) => isStepOpen(step) && !!step.dueAt && new Date(step.dueAt).getTime() < now;

export function cardProgress(card: ProductionCard): { done: number; total: number } {
  const steps = required(card);
  return { done: steps.filter((s) => s.status === 'DONE').length, total: steps.length };
}

export type CardState = 'CLOSED' | 'CANCELLED' | 'BLOCKED' | 'LATE' | 'READY' | 'IN_PROGRESS' | 'NEW';

export const CARD_STATE_NAMES: Record<CardState, string> = {
  CLOSED: 'منجزة',
  CANCELLED: 'ملغاة',
  BLOCKED: 'متعطلة',
  LATE: 'متأخرة',
  READY: 'جاهزة',
  IN_PROGRESS: 'قيد العمل',
  NEW: 'لم تبدأ',
};

/** Where the card stands right now. A blocked card is reported as blocked even when it is also late. */
export function cardState(card: ProductionCard, now = Date.now()): CardState {
  if (card.status === 'CLOSED') return 'CLOSED';
  if (card.status === 'CANCELLED') return 'CANCELLED';
  const steps = required(card);
  if (steps.some((s) => s.status === 'BLOCKED')) return 'BLOCKED';
  const ready = steps.length > 0 && steps.every((s) => s.status === 'DONE');
  if (ready) return 'READY';
  if (isCardLate(card, now)) return 'LATE';
  return steps.some((s) => s.status !== 'TODO') ? 'IN_PROGRESS' : 'NEW';
}

/** Open, not ready, and a step or the card itself is past its deadline. */
export function isCardLate(card: ProductionCard, now = Date.now()): boolean {
  if (card.status !== 'OPEN') return false;
  const steps = required(card);
  if (steps.length > 0 && steps.every((s) => s.status === 'DONE')) return false;
  if (steps.some((s) => isStepLate(s, now))) return true;
  return !!card.dueAt && new Date(card.dueAt).getTime() < now;
}

/** Why the card is stuck or late, in words for the chief editor's board. */
export function cardHoldReason(card: ProductionCard, types: StepType[], now = Date.now()): string {
  const blocked = (card.steps || []).filter((s) => s.status === 'BLOCKED');
  if (blocked.length) return blocked.map((s) => `${stepTypeName(types, s.type)}: ${s.blockedReason || 'بدون سبب مكتوب'}`).join(' • ');
  const late = (card.steps || []).filter((s) => isStepLate(s, now));
  if (late.length) return late.map((s) => `${stepTypeName(types, s.type)} لم تُسلَّم (${s.assigneeName || 'غير مسندة'})`).join(' • ');
  const waiting = currentStep(card);
  if (isCardLate(card, now) && waiting) return `بانتظار ${stepTypeName(types, waiting.type)} (${waiting.assigneeName || 'غير مسندة'})`;
  return '';
}

export const stepPoints = (step: CardStep, types: StepType[]) => (types.find((t) => t.id === step.type)?.weight ?? 1) * (step.complexity || 1);

/** Each station's part in a shared card. The card itself counts once in total production. */
export function cardContributions(card: ProductionCard, types: StepType[]): { stationId: string; steps: number; done: number; points: number }[] {
  const byStation = new Map<string, { stationId: string; steps: number; done: number; points: number }>();
  for (const step of required(card)) {
    const key = step.stationId || '';
    const row = byStation.get(key) || { stationId: key, steps: 0, done: 0, points: 0 };
    row.steps += 1;
    if (step.status === 'DONE') {
      row.done += 1;
      row.points += stepPoints(step, types);
    }
    byStation.set(key, row);
  }
  return [...byStation.values()];
}

// ---------------------------------------------------------------------------
// Who may change what
// ---------------------------------------------------------------------------

export interface CardActor {
  id: string;
  stationId?: string;
  /** cards.manage: creates cards, distributes steps, approves scripts, closes cards. */
  canManage: boolean;
  /** cards.work: carries out steps and documents work. */
  canWork: boolean;
}

export interface CardContext {
  stations: Station[];
  stepTypes: StepType[];
  /** Active users by id with their station. */
  users: Map<string, { stationId?: string }>;
}

/** Builds the context the rules need from the shared settings and the user list. */
export function cardContextOf(settings: { stations?: Station[]; cardStepTypes?: StepType[] } | null | undefined, users: { id: string; stationId?: string; isActive?: boolean; deletedAt?: string | null }[]): CardContext {
  return {
    stations: stationsOf(settings),
    stepTypes: stepTypesOf(settings),
    users: new Map(users.filter((u) => u.isActive !== false && !u.deletedAt).map((u) => [u.id, { stationId: u.stationId }])),
  };
}

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
/** Compares values whatever the order of their keys; absent, null and undefined are the same. */
const stable = (value: unknown): string => {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const isIso = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(new Date(v).getTime());
const optText = (v: unknown, max: number) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const optMinutes = (v: unknown) => v === undefined || v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100000);

export const MAX_CARD_STEPS = 30;

/** Shape of a card, whoever writes it. */
export function cardError(card: ProductionCard): string | null {
  if (!card || typeof card !== 'object') return 'بطاقة غير صالحة';
  if (typeof card.title !== 'string' || !card.title.trim() || card.title.length > 200) return 'عنوان البطاقة مطلوب وبحد أقصى 200 حرف';
  if (!CARD_KINDS.some((k) => k.id === card.kind)) return 'نوع المادة غير معروف';
  if (card.priority !== 'NORMAL' && card.priority !== 'URGENT') return 'أولوية البطاقة غير معروفة';
  if (!CARD_STATUSES.some((s) => s.id === card.status)) return 'حالة البطاقة غير معروفة';
  if (!optText(card.brief, 5000)) return 'وصف المطلوب بحد أقصى 5000 حرف';
  if (!optText(card.script, 60000)) return 'النص بحد أقصى 60000 حرف';
  for (const key of ['dueAt', 'airAt'] as const) if (card[key] && !isIso(card[key])) return 'موعد التسليم أو البث غير صالح';
  if (card.target !== undefined && card.target !== null) {
    const t = card.target;
    if (!t || !['news', 'episode', 'bulletin'].includes(t.kind) || typeof t.id !== 'string' || !ID.test(t.id) || typeof t.title !== 'string' || t.title.length > 300) return 'ربط البطاقة بمادة غير صالح';
  }
  if (card.links !== undefined) {
    if (!Array.isArray(card.links) || card.links.length > 40) return 'الحد الأقصى 40 رابطاً';
    for (const link of card.links) {
      if (!link || typeof link.label !== 'string' || link.label.length > 160 || typeof link.url !== 'string' || link.url.length > 2000 || !/^https?:\/\/\S+$/i.test(link.url)) return 'كل رابط يحتاج عنواناً يبدأ بـ http أو https';
    }
  }
  if (card.mediaIds !== undefined && (!Array.isArray(card.mediaIds) || card.mediaIds.length > 100 || card.mediaIds.some((id) => typeof id !== 'string' || !ID.test(id)))) return 'مواد المكتبة المرفقة غير صالحة';
  if (!Array.isArray(card.steps) || card.steps.length > MAX_CARD_STEPS) return `الحد الأقصى ${MAX_CARD_STEPS} مهمة في البطاقة`;
  const stepIds = new Set<string>();
  for (const step of card.steps) {
    if (!step || typeof step.id !== 'string' || !ID.test(step.id) || stepIds.has(step.id)) return 'معرّف المهمة غير صالح أو مكرر';
    stepIds.add(step.id);
    if (typeof step.type !== 'string' || !TYPE_ID.test(step.type)) return 'نوع المهمة غير صالح';
    if (!STEP_STATUSES.some((s) => s.id === step.status)) return 'حالة المهمة غير معروفة';
    if (![1, 2, 3].includes(step.complexity)) return 'درجة التعقيد غير معروفة';
    if (!optText(step.title, 200) || !optText(step.note, 3000) || !optText(step.blockedReason, 1000)) return 'نص المهمة أطول من المسموح';
    if (!optMinutes(step.estimateMinutes) || !optMinutes(step.spentMinutes)) return 'الوقت بالدقائق رقم صحيح موجب';
    if (step.dueAt && !isIso(step.dueAt)) return 'موعد تسليم المهمة غير صالح';
    if (step.status === 'BLOCKED' && !(step.blockedReason || '').trim()) return 'اكتب سبب التعطل';
  }
  if (card.log !== undefined) {
    if (!Array.isArray(card.log) || card.log.length > 500) return 'سجل البطاقة ممتلئ';
    for (const entry of card.log) {
      if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id) || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 3000) return 'ملاحظة التوثيق مطلوبة وبحد أقصى 3000 حرف';
    }
  }
  return null;
}

const CARD_LOCKED = ['title', 'kind', 'brief', 'priority', 'status', 'ownerId', 'dueAt', 'airAt', 'target'] as const;
const STEP_LOCKED = ['type', 'title', 'dueAt', 'complexity', 'estimateMinutes', 'stationId'] as const;

/** Whether the actor may take an unassigned step: it is open to everyone or addressed to their station. */
export const canClaimStep = (step: CardStep, actor: CardActor) => !step.assigneeId && actor.canWork && (!step.stationId || step.stationId === actor.stationId);

/** Returns an Arabic error when the actor may not make this change, otherwise null. */
export function cardChangeError(before: ProductionCard | null, after: ProductionCard, actor: CardActor, ctx: CardContext): string | null {
  const shape = cardError(after);
  if (shape) return shape;

  // People and stations are checked only where this write names them: a colleague who has since
  // left, or a station removed later, must not freeze the cards they were on.
  if (after.ownerId && after.ownerId !== before?.ownerId && !ctx.users.has(after.ownerId)) return 'صاحب القرار غير موجود أو موقوف';
  for (const step of after.steps) {
    const prev = before?.steps.find((s) => s.id === step.id);
    if (step.assigneeId && step.assigneeId !== prev?.assigneeId && !ctx.users.has(step.assigneeId)) return 'المكلف غير موجود أو موقوف';
    if (step.stationId && step.stationId !== prev?.stationId && !ctx.stations.some((s) => s.id === step.stationId)) return 'محطة المهمة غير موجودة';
  }

  // Earlier log entries are a record: nobody rewrites them.
  const oldLog = before?.log || [];
  const newLog = after.log || [];
  if (newLog.length < oldLog.length || oldLog.some((entry, i) => newLog[i]?.id !== entry.id || newLog[i]?.text !== entry.text)) return 'سجل التوثيق للإضافة فقط ولا يُعدَّل';

  if (actor.canManage) {
    if (!before && after.status !== 'OPEN') return 'البطاقة الجديدة تبدأ جارية';
    // Supervisors distribute work inside the stations they follow.
    const scope = stationScope(ctx.stations, actor.stationId);
    for (const step of after.steps) {
      const prev = before?.steps.find((s) => s.id === step.id);
      if (!step.assigneeId || step.assigneeId === prev?.assigneeId) continue;
      const station = ctx.users.get(step.assigneeId)?.stationId;
      if (station && !scope.has(station)) return 'لا يمكنك تكليف زميل من محطة غير مرتبطة بمحطتك';
    }
    return null;
  }

  if (!actor.canWork) return 'صلاحياتك لا تسمح بالعمل على بطاقات الإنتاج';
  if (!before) return 'إنشاء بطاقات الإنتاج وتوزيع مهامها لمسؤولي التكليف';
  if (before.status !== 'OPEN') return 'البطاقة مغلقة؛ يعيد فتحها مسؤول التكليف';
  if (CARD_LOCKED.some((key) => !same(before[key], after[key]))) return 'تعديل بيانات البطاقة ومواعيدها لمسؤولي التكليف';
  if (!same(before.scriptApproved ?? false, after.scriptApproved ?? false) && after.scriptApproved) return 'اعتماد النص لمسؤولي التكليف';
  if (before.steps.length !== after.steps.length || before.steps.some((s, i) => after.steps[i]?.id !== s.id)) return 'إضافة المهام وحذفها وترتيبها لمسؤولي التكليف';

  const mine = (step: CardStep) => step.assigneeId === actor.id;
  for (let i = 0; i < before.steps.length; i += 1) {
    const prev = before.steps[i];
    const next = after.steps[i];
    if (same(prev, next)) continue;
    if (STEP_LOCKED.some((key) => !same(prev[key], next[key]))) return 'تعديل تفاصيل المهمة لمسؤولي التكليف';
    if (!same(prev.assigneeId, next.assigneeId)) {
      const claiming = next.assigneeId === actor.id && canClaimStep(prev, actor);
      const releasing = mine(prev) && !next.assigneeId && prev.status !== 'DONE';
      if (!claiming && !releasing) return 'لا يمكنك تغيير المكلف بهذه المهمة';
    } else if (!mine(prev)) {
      return 'تحدّث المهمة من أُسندت إليه';
    }
  }
  const worksOnCard = after.steps.some(mine);
  if ((!same(before.script, after.script) || !same(before.links, after.links) || !same(before.mediaIds, after.mediaIds)) && !worksOnCard) return 'يعدّل النص والروابط من له مهمة في البطاقة';
  return null;
}

// ---------------------------------------------------------------------------
// Writes based on an older version (made offline, or while a colleague saved)
// ---------------------------------------------------------------------------

const MERGED_CARD_FIELDS = ['title', 'kind', 'brief', 'priority', 'ownerId', 'dueAt', 'airAt', 'target', 'script', 'scriptApproved', 'links', 'mediaIds'] as const;

/** Takes the sender's change to one value unless the stored value changed differently meanwhile. */
function mergeValue<T>(base: T, mine: T, current: T): { ok: boolean; value: T } {
  if (same(base, mine)) return { ok: true, value: current };
  if (same(base, current) || same(current, mine)) return { ok: true, value: mine };
  return { ok: false, value: current };
}

/**
 * Three-way merge of a card: `base` is the version the browser started from, `mine` what it
 * sent, `current` what is stored now. A reporter who finishes a step without a connection keeps
 * that work even though an editor changed another part of the card meanwhile.
 *
 * Returns the stored card with the sender's changes applied, or null when both sides changed the
 * same thing (or the card's steps were rearranged, or it was closed): the sender then gets the
 * latest version and decides. The result still goes through cardChangeError like any other write.
 */
export function mergeCardChanges(base: ProductionCard, mine: ProductionCard, current: ProductionCard): ProductionCard | null {
  if (base.status !== current.status || base.status !== mine.status || current.deletedAt || mine.deletedAt) return null;
  const order = (card: ProductionCard) => (card.steps || []).map((s) => s.id).join('|');
  if (order(base) !== order(mine)) return null;

  const merged: any = { ...current };
  for (const key of MERGED_CARD_FIELDS) {
    const result = mergeValue(base[key], mine[key], current[key]);
    if (!result.ok) return null;
    merged[key] = result.value;
  }

  const baseSteps = new Map(base.steps.map((s) => [s.id, s]));
  const mineSteps = new Map(mine.steps.map((s) => [s.id, s]));
  const currentIds = new Set(current.steps.map((s) => s.id));
  // A step the sender worked on was removed meanwhile.
  if (mine.steps.some((s) => !currentIds.has(s.id) && !same(baseSteps.get(s.id), s))) return null;
  const steps: CardStep[] = [];
  for (const step of current.steps) {
    const from = baseSteps.get(step.id) as any;
    const sent = mineSteps.get(step.id) as any;
    if (!from || !sent || same(from, sent)) {
      steps.push(step);
      continue;
    }
    const next: any = { ...step };
    for (const key of new Set([...Object.keys(from), ...Object.keys(sent), ...Object.keys(step)])) {
      const result = mergeValue(from[key], sent[key], (step as any)[key]);
      if (!result.ok) return null;
      next[key] = result.value;
    }
    steps.push(next);
  }
  merged.steps = steps;

  const known = new Set((current.log || []).map((e) => e.id));
  merged.log = [...(current.log || []), ...(mine.log || []).filter((e) => e && !known.has(e.id))];
  return merged;
}

// ---------------------------------------------------------------------------
// Convenience for building cards
// ---------------------------------------------------------------------------

/** Typical chains offered when a card is created; steps are then edited freely. */
export const CARD_STEP_PRESETS: { id: string; name: string; types: string[] }[] = [
  { id: 'field', name: 'تقرير ميداني', types: ['gather', 'verify', 'edit', 'montage', 'quality', 'approve', 'publish'] },
  { id: 'desk', name: 'خبر أو موجز', types: ['edit', 'approve', 'publish'] },
  { id: 'show', name: 'نشرة أو حلقة', types: ['prep', 'edit', 'montage', 'graphics', 'quality', 'approve', 'publish'] },
];
