/**
 * Production cards: one card travels with each item (news, brief, report, bulletin, programme)
 * between stations. It says what has to be done, who owns each step, when it is due and when it
 * airs, carries the approved script and the links to pictures and interviews, and keeps a record
 * of what each colleague did, so the next person sees what is complete and what is missing.
 *
 * The rules below are shared by the browser (to explain a refusal before sending) and the server
 * (which enforces them), so both always agree.
 */
import { stationName, stationScope, stationsOf, type Station } from './stations';
import { departmentName } from './departments';

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
  /** With no assignee: the department asked to pick it up (inside the station when one is given). */
  departmentId?: string;
  /** What has to be checked before the step is handed on (from the workflow template). */
  checklist?: CardChecklistItem[];
  dueAt?: string;
  status: StepStatus;
  complexity: 1 | 2 | 3;
  /** Planned effort in minutes. */
  estimateMinutes?: number;
  /** Actual effort in minutes: the sum of every work session logged on the step (rework adds, never replaces). */
  spentMinutes?: number;
  /** Work sessions, one entry per «تم الإنجاز» or time added; append-only, stamped by the server. */
  timeLog?: CardTimeEntry[];
  /** Handoff note: what is complete and what is missing. */
  note?: string;
  blockedReason?: string;
  /** While blocked: the colleague who can unblock it (e.g. whoever owes the footage). */
  waitingOnId?: string;
  waitingOnName?: string;
  /** Set when a reviewer or the card owner sends the step back for rework; cleared once it is done again. */
  returnedReason?: string;
  returnedById?: string;
  returnedByName?: string;
  returnedAt?: string;
  startedAt?: string;
  doneAt?: string;
  doneById?: string;
  doneByName?: string;
}

export interface CardChecklistItem {
  text: string;
  done?: boolean;
}

export interface CardTimeEntry {
  id: string;
  minutes: number;
  at?: string;
  byId?: string;
  byName?: string;
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
  /** A NOTE marked as a decision by the card owner or a supervisor: everyone on the card hears it. */
  decision?: boolean;
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
  /** Workflow template the assignment was created from (for reports by template). */
  templateId?: string;
  templateName?: string;
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

/**
 * Whether the step itself is to blame for being late: a step that has not started because an
 * earlier step is blocked or late is waiting, and the delay is reported on that earlier step.
 */
export function isStepOwnLate(card: ProductionCard, step: CardStep, now = Date.now()): boolean {
  if (!isStepLate(step, now)) return false;
  if (step.status !== 'TODO') return true;
  const index = (card.steps || []).findIndex((s) => s.id === step.id);
  const earlier = (card.steps || []).slice(0, Math.max(0, index)).filter(isStepOpen);
  return !earlier.some((s) => s.status === 'BLOCKED' || isStepLate(s, now));
}

/** Earlier required steps still open when this one is finished (finishing then needs a confirmation). */
export const openStepsBefore = (card: ProductionCard, stepId: string): CardStep[] => {
  const index = (card.steps || []).findIndex((s) => s.id === stepId);
  return index <= 0 ? [] : card.steps.slice(0, index).filter(isStepOpen);
};

/** Who holds the step, in words: the person, «متاحة لمحطة X» for a station-wide step, or «غير مسندة». */
export function stepAssigneeLabel(step: CardStep, stations?: Station[]): string {
  if (step.assigneeName) return step.assigneeName;
  const department = step.departmentId ? `قسم ${departmentName(step.departmentId)}` : '';
  if (step.stationId) return `متاحة ل${department ? `${department} في ` : ''}${stations ? `محطة ${stationName(stations, step.stationId)}` : 'المحطة'}`;
  if (department) return `متاحة ل${department}`;
  return 'غير مسندة';
}

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

/**
 * Where the card stands right now. A blocked card is reported as blocked even when it is also late;
 * cardStates() gives both so lists, counters and badges show the delay too.
 */
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

/** Every state that applies: a blocked card past its deadline is both BLOCKED and LATE. */
export function cardStates(card: ProductionCard, now = Date.now()): CardState[] {
  const state = cardState(card, now);
  return state === 'BLOCKED' && isCardLate(card, now) ? ['BLOCKED', 'LATE'] : [state];
}

/** Open, not ready, and a step or the card itself is past its deadline. */
export function isCardLate(card: ProductionCard, now = Date.now()): boolean {
  if (card.status !== 'OPEN') return false;
  const steps = required(card);
  if (steps.length > 0 && steps.every((s) => s.status === 'DONE')) return false;
  if (steps.some((s) => isStepLate(s, now))) return true;
  return !!card.dueAt && new Date(card.dueAt).getTime() < now;
}

/** Why the card is stuck or late, in words for the chief editor's board. Pass the stations to name station-wide steps. */
export function cardHoldReason(card: ProductionCard, types: StepType[], now = Date.now(), stations?: Station[]): string {
  const blocked = (card.steps || []).filter((s) => s.status === 'BLOCKED');
  if (blocked.length) return blocked.map((s) => `${stepTypeName(types, s.type)}: ${s.blockedReason || 'بدون سبب مكتوب'}`).join(' • ');
  const late = (card.steps || []).filter((s) => isStepOwnLate(card, s, now));
  if (late.length) return late.map((s) => `${stepTypeName(types, s.type)} لم تُسلَّم (${stepAssigneeLabel(s, stations)})`).join(' • ');
  const waiting = currentStep(card);
  if (isCardLate(card, now) && waiting) return `بانتظار ${stepTypeName(types, waiting.type)} (${stepAssigneeLabel(waiting, stations)})`;
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
  /** A general manager's stations and station groups (see stationScope). */
  managedStationIds?: string[];
  managedGroupIds?: string[];
  /** Role code and department decide which kinds of step a colleague may pick up (see stepFitsActor). */
  role?: string;
  departmentId?: string;
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

/**
 * Who does each built-in kind of step, by department and by role. A colleague picks up («يستلم»)
 * only steps that fit their work; supervisors pick up anything. Step types an administrator added
 * later are open to everyone, and so is every type for someone whose role and department are unknown.
 */
export const STEP_TYPE_FIT: Record<string, { departments: string[]; roles: string[] }> = {
  gather: { departments: ['field', 'newsroom', 'reports'], roles: ['REPORTER', 'JOURNALIST', 'REPORTS_EDITOR'] },
  verify: { departments: ['newsroom', 'monitoring', 'quality', 'reports'], roles: ['JOURNALIST', 'EDITOR', 'MONITOR', 'QUALITY', 'REPORTS_EDITOR'] },
  edit: { departments: ['newsroom', 'reports', 'production'], roles: ['JOURNALIST', 'EDITOR', 'REPORTS_EDITOR', 'PREPARER', 'PRODUCER'] },
  prep: { departments: ['production'], roles: ['PREPARER', 'PRODUCER'] },
  montage: { departments: ['montage'], roles: ['MONTAGE'] },
  graphics: { departments: ['graphics'], roles: [] },
  translate: { departments: ['newsroom', 'monitoring'], roles: ['JOURNALIST', 'MONITOR'] },
  monitor: { departments: ['monitoring'], roles: ['MONITOR'] },
  quality: { departments: ['quality'], roles: ['QUALITY'] },
  // Approval is a supervisor's decision.
  approve: { departments: [], roles: [] },
  publish: { departments: ['control', 'direction'], roles: ['DIRECTOR', 'EDITOR', 'PRODUCER'] },
};

/** Whether this kind of step is the colleague's kind of work (supervisors: always). */
export function stepFitsActor(type: string, actor: Pick<CardActor, 'canManage' | 'role' | 'departmentId'>): boolean {
  if (actor.canManage) return true;
  const fit = STEP_TYPE_FIT[type];
  if (!fit || (!actor.role && !actor.departmentId)) return true;
  return (!!actor.role && fit.roles.includes(actor.role)) || (!!actor.departmentId && fit.departments.includes(actor.departmentId));
}

/** Step types whose holder reviews what came before and may send it back for rework. */
export const REVIEW_STEP_TYPES = ['quality', 'approve'];

/** Whether the actor may send earlier steps of this card back: the owner, a supervisor, or whoever holds an open review step. */
export function canSendBack(card: ProductionCard, actor: CardActor, reviewStepId?: string): boolean {
  if (card.status !== 'OPEN') return false;
  if (actor.canManage || card.ownerId === actor.id) return true;
  return (card.steps || []).some((s) => s.assigneeId === actor.id && isStepOpen(s) && REVIEW_STEP_TYPES.includes(s.type) && (!reviewStepId || s.id === reviewStepId));
}

/** Done steps before the reviewer's step that can be sent back (all done steps for the owner or a supervisor). */
export function sendBackTargets(card: ProductionCard, fromStepId?: string): CardStep[] {
  const index = fromStepId ? (card.steps || []).findIndex((s) => s.id === fromStepId) : card.steps.length;
  return (card.steps || []).slice(0, index < 0 ? card.steps.length : index).filter((s) => s.status === 'DONE');
}

/**
 * Sends `targetId` back for rework with a reason: it reopens (in progress when someone holds it),
 * and done steps after it up to the reviewer's step wait again. Their history stays in the log.
 */
export function sendBackCard(card: ProductionCard, targetId: string, reason: string, fromStepId?: string): ProductionCard {
  const target = card.steps.findIndex((s) => s.id === targetId);
  const until = fromStepId ? card.steps.findIndex((s) => s.id === fromStepId) : card.steps.length;
  return {
    ...card,
    steps: card.steps.map((s, i) => {
      if (i === target) return { ...s, status: s.assigneeId ? 'IN_PROGRESS' : 'TODO', returnedReason: reason.trim() };
      if (i > target && (until < 0 || i < until) && s.status === 'DONE') return { ...s, status: 'TODO' };
      return s;
    }),
  };
}

/**
 * Whether a supervisor may close, cancel, reopen or delete this card: central management and the
 * main station govern every card; a branch governs cards its own station owns and those of the
 * branches it follows, never the main station's. The card owner always may.
 */
export function canGovernCard(card: Pick<ProductionCard, 'ownerId' | 'ownerStationId'>, actor: CardActor, stations: Station[]): boolean {
  if (!actor.canManage) return false;
  if (card.ownerId === actor.id) return true;
  // Central management: no station of their own and no stations given to follow.
  if (!actor.stationId && !actor.managedStationIds?.length && !actor.managedGroupIds?.length) return true;
  // A station that no longer exists governs nothing (it is not central management).
  const own = stations.find((s) => s.id === actor.stationId);
  if (own?.isMain) return true;
  if (!card.ownerStationId || (own && card.ownerStationId === own.id)) return true;
  const owner = stations.find((s) => s.id === card.ownerStationId);
  if (!owner || owner.isMain) return false;
  return stationScope(stations, actor).has(owner.id);
}

export const GOVERN_DENIED = 'إغلاق التكليف وإلغاؤه وحذفه لمحطته المالكة أو المحطة الرئيسية';

/** Time logged on a step: the sum of its work sessions on top of what was noted before sessions existed. */
export const timeLogMinutes = (entries?: CardTimeEntry[]) => (entries || []).reduce((sum, e) => sum + (Number.isFinite(e?.minutes) ? e.minutes : 0), 0);

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
export const MAX_CHECKLIST = 20;

/** Shape of a card, whoever writes it. */
export function cardError(card: ProductionCard): string | null {
  if (!card || typeof card !== 'object') return 'تكليف غير صالح';
  if (typeof card.title !== 'string' || !card.title.trim() || card.title.length > 200) return 'عنوان التكليف مطلوب وبحد أقصى 200 حرف';
  if (!CARD_KINDS.some((k) => k.id === card.kind)) return 'نوع المادة غير معروف';
  if (card.priority !== 'NORMAL' && card.priority !== 'URGENT') return 'أولوية التكليف غير معروفة';
  if (!CARD_STATUSES.some((s) => s.id === card.status)) return 'حالة التكليف غير معروفة';
  if (!optText(card.brief, 5000)) return 'وصف المطلوب بحد أقصى 5000 حرف';
  if (!optText(card.script, 60000)) return 'النص بحد أقصى 60000 حرف';
  for (const key of ['dueAt', 'airAt'] as const) if (card[key] && !isIso(card[key])) return 'موعد التسليم أو البث غير صالح';
  if (card.target !== undefined && card.target !== null) {
    const t = card.target;
    if (!t || !['news', 'episode', 'bulletin'].includes(t.kind) || typeof t.id !== 'string' || !ID.test(t.id) || typeof t.title !== 'string' || t.title.length > 300) return 'ربط التكليف بمادة غير صالح';
  }
  if (card.links !== undefined) {
    if (!Array.isArray(card.links) || card.links.length > 40) return 'الحد الأقصى 40 رابطاً';
    for (const link of card.links) {
      if (!link || typeof link.label !== 'string' || link.label.length > 160 || typeof link.url !== 'string' || link.url.length > 2000 || !/^https?:\/\/\S+$/i.test(link.url)) return 'كل رابط يحتاج عنواناً يبدأ بـ http أو https';
    }
  }
  if (card.mediaIds !== undefined && (!Array.isArray(card.mediaIds) || card.mediaIds.length > 100 || card.mediaIds.some((id) => typeof id !== 'string' || !ID.test(id)))) return 'مواد المكتبة المرفقة غير صالحة';
  if (!Array.isArray(card.steps) || card.steps.length > MAX_CARD_STEPS) return `الحد الأقصى ${MAX_CARD_STEPS} مهمة في التكليف`;
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
    if (!optText(step.returnedReason, 1000)) return 'سبب الإعادة بحد أقصى 1000 حرف';
    // Department ids only: administrators may add departments, so the list is not fixed here.
    if (step.departmentId !== undefined && step.departmentId !== null && (typeof step.departmentId !== 'string' || !TYPE_ID.test(step.departmentId))) return 'قسم المهمة غير معروف';
    if (step.checklist !== undefined && step.checklist !== null) {
      if (!Array.isArray(step.checklist) || step.checklist.length > MAX_CHECKLIST) return `الحد الأقصى ${MAX_CHECKLIST} بنداً في قائمة التحقق`;
      if (step.checklist.some((item) => !item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 200 || (item.done !== undefined && typeof item.done !== 'boolean'))) return 'بند قائمة التحقق مطلوب وبحد أقصى 200 حرف';
    }
    if (step.waitingOnId !== undefined && step.waitingOnId !== null && (typeof step.waitingOnId !== 'string' || !ID.test(step.waitingOnId))) return 'الزميل المطلوب منه الحل غير صالح';
    if (step.timeLog !== undefined && step.timeLog !== null) {
      if (!Array.isArray(step.timeLog) || step.timeLog.length > 200) return 'سجل الوقت ممتلئ';
      for (const entry of step.timeLog) {
        if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id) || !Number.isInteger(entry.minutes) || entry.minutes < 1 || entry.minutes > 1440) return 'وقت الجلسة بالدقائق بين 1 و1440';
      }
    }
  }
  if (card.log !== undefined) {
    if (!Array.isArray(card.log) || card.log.length > 500) return 'سجل التكليف ممتلئ';
    for (const entry of card.log) {
      if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id) || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 3000) return 'ملاحظة التوثيق مطلوبة وبحد أقصى 3000 حرف';
      if (entry.decision !== undefined && entry.decision !== null && typeof entry.decision !== 'boolean') return 'نوع الملاحظة غير صالح';
    }
  }
  return null;
}

const CARD_LOCKED = ['title', 'kind', 'brief', 'priority', 'status', 'ownerId', 'dueAt', 'airAt', 'target', 'templateId', 'templateName'] as const;
const STEP_LOCKED = ['type', 'title', 'dueAt', 'complexity', 'estimateMinutes', 'stationId', 'departmentId'] as const;

/**
 * Whether the actor may take an unassigned step: it is open to everyone or addressed to their
 * station, and it is their kind of work (supervisors take anything).
 */
export const canClaimStep = (step: CardStep, actor: CardActor) =>
  !step.assigneeId &&
  actor.canWork &&
  (!step.stationId || step.stationId === actor.stationId) &&
  (!step.departmentId || actor.canManage || !actor.departmentId || step.departmentId === actor.departmentId) &&
  stepFitsActor(step.type, actor);

/** Fields a reviewer or the owner changes on someone else's done step when sending it back. */
const RETURN_KEYS = new Set(['status', 'returnedReason', 'returnedById', 'returnedByName', 'returnedAt']);
const changedKeys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same((a as any)[k], (b as any)[k]));

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
    if (step.waitingOnId && step.waitingOnId !== prev?.waitingOnId && !ctx.users.has(step.waitingOnId)) return 'الزميل المطلوب منه الحل غير موجود أو موقوف';
    if (step.stationId && step.stationId !== prev?.stationId && !ctx.stations.some((s) => s.id === step.stationId)) return 'محطة المهمة غير موجودة';
    // Work sessions are a record too: time is added, never rewritten.
    const oldTime = prev?.timeLog || [];
    const newTime = step.timeLog || [];
    if (newTime.length < oldTime.length || oldTime.some((entry, i) => !same(entry, newTime[i]))) return 'سجل الوقت للإضافة فقط';
  }

  // Earlier log entries are a record: nobody rewrites them.
  const oldLog = before?.log || [];
  const newLog = after.log || [];
  if (newLog.length < oldLog.length || oldLog.some((entry, i) => newLog[i]?.id !== entry.id || newLog[i]?.text !== entry.text)) return 'سجل التوثيق للإضافة فقط ولا يُعدَّل';
  const isOwner = !!before && before.ownerId === actor.id;
  if (newLog.slice(oldLog.length).some((e) => e.decision) && !actor.canManage && !isOwner) return 'تسجيل القرار لصاحب التكليف أو مسؤولي التكليف';

  const scope = stationScope(ctx.stations, actor);
  const outOfScope = (userId: string) => {
    const station = ctx.users.get(userId)?.stationId;
    return !!station && !scope.has(station);
  };

  if (actor.canManage) {
    if (!before && after.status !== 'OPEN') return 'التكليف الجديد يبدأ جارياً';
    // A branch closes, cancels and reopens only the cards it governs.
    if (before && before.status !== after.status && !canGovernCard(before, actor, ctx.stations)) return GOVERN_DENIED;
    // Supervisors distribute work inside the stations they follow.
    for (const step of after.steps) {
      const prev = before?.steps.find((s) => s.id === step.id);
      if (!step.assigneeId || step.assigneeId === prev?.assigneeId) continue;
      if (outOfScope(step.assigneeId)) return 'لا يمكنك تكليف زميل من محطة غير مرتبطة بمحطتك';
    }
    return null;
  }

  if (!actor.canWork) return 'صلاحياتك لا تسمح بالعمل على التكليفات';
  if (!before) return 'إنشاء التكليفات وتوزيع مهامها لمسؤولي التكليف';
  if (before.status !== 'OPEN') return 'التكليف مغلق؛ يعيد فتحه مسؤول التكليف';
  if (CARD_LOCKED.some((key) => !same(before[key], after[key]))) return 'تعديل بيانات التكليف ومواعيده لمسؤولي التكليف';
  if (!same(before.scriptApproved ?? false, after.scriptApproved ?? false) && after.scriptApproved) return 'اعتماد النص لمسؤولي التكليف';
  if (before.steps.length !== after.steps.length || before.steps.some((s, i) => after.steps[i]?.id !== s.id)) return 'إضافة المهام وحذفها وترتيبها لمسؤولي التكليف';

  const mine = (step: CardStep) => step.assigneeId === actor.id;
  const returned: number[] = [];
  for (let i = 0; i < before.steps.length; i += 1) {
    const prev = before.steps[i];
    const next = after.steps[i];
    if (same(prev, next)) continue;
    if (STEP_LOCKED.some((key) => !same(prev[key], next[key]))) return 'تعديل تفاصيل المهمة لمسؤولي التكليف';
    // The assignee ticks the checklist; its items are the supervisor's.
    if (!same((prev.checklist || []).map((c) => c.text), (next.checklist || []).map((c) => c.text))) return 'بنود قائمة التحقق لمسؤولي التكليف';
    // Time is added as work sessions (the server sums them); a total typed by hand may only grow.
    const sessionAdded = (next.timeLog || []).length > (prev.timeLog || []).length;
    if (!sessionAdded && (next.spentMinutes ?? 0) < (prev.spentMinutes ?? 0)) return 'الوقت المسجّل يُضاف إلى ما سبق ولا يُنقص';
    if (!same(prev.assigneeId, next.assigneeId)) {
      const claiming = next.assigneeId === actor.id && canClaimStep(prev, actor);
      const releasing = mine(prev) && !next.assigneeId && prev.status !== 'DONE';
      // The card owner hands a step to another colleague without opening the full form.
      const reassigning = isOwner && prev.status !== 'DONE';
      if (!claiming && !releasing && !reassigning) return 'لا يمكنك تغيير المكلف بهذه المهمة';
      if (reassigning && !claiming && next.assigneeId && outOfScope(next.assigneeId)) return 'لا يمكنك تكليف زميل من محطة غير مرتبطة بمحطتك';
    } else if (!mine(prev)) {
      const sendingBack = prev.status === 'DONE' && (next.status === 'TODO' || next.status === 'IN_PROGRESS') && changedKeys(prev, next).every((k) => RETURN_KEYS.has(k));
      if (!sendingBack) return 'تحدّث المهمة من أُسندت إليه';
      returned.push(i);
    }
  }
  if (returned.length) {
    // Rework goes back with a reason, and only the owner or a reviewer further down the chain sends it.
    if (!(after.steps[Math.min(...returned)].returnedReason || '').trim()) return 'اكتب سبب الإعادة إلى الخطوة السابقة';
    const last = Math.max(...returned);
    const reviews = before.steps.some((s, i) => i > last && mine(s) && isStepOpen(s) && REVIEW_STEP_TYPES.includes(s.type));
    if (!isOwner && !reviews) return 'الإعادة إلى خطوة سابقة لصاحب التكليف أو لمن يراجع المادة (الجودة أو الاعتماد)';
  }
  const worksOnCard = isOwner || after.steps.some(mine);
  if ((!same(before.script, after.script) || !same(before.links, after.links) || !same(before.mediaIds, after.mediaIds)) && !worksOnCard) return 'يعدّل النص والروابط والمواد من له مهمة في التكليف';
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
