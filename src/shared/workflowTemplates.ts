/**
 * Workflow templates («قوالب سير العمل»): a saved chain of steps a manager reuses to create
 * assignments («التكليفات»), e.g. «نشرة أخبار» or «تقرير ميداني». Each step says what kind of work
 * it is and who does it — a named colleague, anyone with a role, a department, a station, or
 * whoever the manager picks when creating — and when it is due relative to the deadline.
 *
 * Creating an assignment resolves every rule to a person (or leaves the step open to a station or
 * department for someone there to pick up) and produces an ordinary production card. The rules here
 * are shared by the browser (to preview) and the server (to validate templates).
 */
import { newId } from './ids';
import {
  CARD_KINDS,
  MAX_CARD_STEPS,
  MAX_CHECKLIST,
  stepFitsActor,
  type CardKind,
  type CardStep,
  type ProductionCard,
} from './productionCards';

export type AssigneeRule =
  | { kind: 'PERSON'; userId: string }
  | { kind: 'ROLE'; role: string }
  | { kind: 'DEPARTMENT'; departmentId: string }
  | { kind: 'STATION'; stationId: string }
  | { kind: 'ASK' };

export const RULE_KINDS: { id: AssigneeRule['kind']; name: string }[] = [
  { id: 'ASK', name: 'يحدده المكلِّف عند الإنشاء' },
  { id: 'PERSON', name: 'زميل محدد' },
  { id: 'ROLE', name: 'حسب الدور' },
  { id: 'DEPARTMENT', name: 'حسب القسم' },
  { id: 'STATION', name: 'محطة (يستلمها أحد زملائها)' },
];

export interface TemplateStep {
  id: string;
  /** Id of a StepType from the settings. */
  type: string;
  title?: string;
  rule: AssigneeRule;
  /** Due this many minutes before the assignment's deadline (0: at the deadline); absent: no step deadline. */
  dueOffsetMinutes?: number;
  complexity: 1 | 2 | 3;
  estimateMinutes?: number;
  checklist?: string[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  kind: CardKind;
  description?: string;
  priority: 'NORMAL' | 'URGENT';
  steps: TemplateStep[];
  /** Hidden from «إنشاء من قالب» but kept for reports and for assignments made from it. */
  archived?: boolean;
  /** One of the starter templates shipped with the platform. */
  builtIn?: boolean;
  createdById?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
const TYPE_ID = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_OFFSET = 30 * 24 * 60;
const optText = (v: unknown, max: number) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);

function ruleError(rule: AssigneeRule | undefined): string | null {
  if (!rule || typeof rule !== 'object') return 'حدّد من ينفّذ كل مهمة';
  switch (rule.kind) {
    case 'ASK':
      return null;
    case 'PERSON':
      return typeof rule.userId === 'string' && ID.test(rule.userId) ? null : 'اختر الزميل المنفّذ';
    case 'ROLE':
      return typeof rule.role === 'string' && ID.test(rule.role) ? null : 'اختر الدور المنفّذ';
    case 'DEPARTMENT':
      return typeof rule.departmentId === 'string' && TYPE_ID.test(rule.departmentId) ? null : 'اختر القسم المنفّذ';
    case 'STATION':
      return typeof rule.stationId === 'string' && TYPE_ID.test(rule.stationId) ? null : 'اختر المحطة المنفّذة';
    default:
      return 'طريقة تحديد المنفّذ غير معروفة';
  }
}

/** Shape of a template, whoever writes it. */
export function templateError(t: WorkflowTemplate): string | null {
  if (!t || typeof t !== 'object') return 'قالب غير صالح';
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 120) return 'اسم القالب مطلوب وبحد أقصى 120 حرفاً';
  if (!CARD_KINDS.some((k) => k.id === t.kind)) return 'نوع المادة غير معروف';
  if (t.priority !== 'NORMAL' && t.priority !== 'URGENT') return 'أولوية القالب غير معروفة';
  if (!optText(t.description, 2000)) return 'وصف القالب بحد أقصى 2000 حرف';
  if (t.archived !== undefined && t.archived !== null && typeof t.archived !== 'boolean') return 'حالة الأرشفة غير صالحة';
  if (!Array.isArray(t.steps) || !t.steps.length || t.steps.length > MAX_CARD_STEPS) return `القالب بين مهمة واحدة و${MAX_CARD_STEPS} مهمة`;
  const ids = new Set<string>();
  for (const step of t.steps) {
    if (!step || typeof step.id !== 'string' || !ID.test(step.id) || ids.has(step.id)) return 'معرّف المهمة غير صالح أو مكرر';
    ids.add(step.id);
    if (typeof step.type !== 'string' || !TYPE_ID.test(step.type)) return 'نوع المهمة غير صالح';
    if (!optText(step.title, 200)) return 'تفصيل المهمة بحد أقصى 200 حرف';
    const rule = ruleError(step.rule);
    if (rule) return rule;
    if (![1, 2, 3].includes(step.complexity)) return 'درجة التعقيد غير معروفة';
    if (step.dueOffsetMinutes !== undefined && step.dueOffsetMinutes !== null && (!Number.isInteger(step.dueOffsetMinutes) || Math.abs(step.dueOffsetMinutes) > MAX_OFFSET)) return 'موعد المهمة قبل التسليم بالدقائق (حتى 30 يوماً)';
    if (step.estimateMinutes !== undefined && step.estimateMinutes !== null && (!Number.isInteger(step.estimateMinutes) || step.estimateMinutes < 0 || step.estimateMinutes > 100000)) return 'الوقت المقدر بالدقائق رقم صحيح موجب';
    if (step.checklist !== undefined && step.checklist !== null) {
      if (!Array.isArray(step.checklist) || step.checklist.length > MAX_CHECKLIST) return `الحد الأقصى ${MAX_CHECKLIST} بنداً في قائمة التحقق`;
      if (step.checklist.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200)) return 'بند قائمة التحقق مطلوب وبحد أقصى 200 حرف';
    }
  }
  return null;
}

/** Who may change templates: supervisors who create assignments. */
export function templateChangeError(before: WorkflowTemplate | null, after: WorkflowTemplate, canManage: boolean): string | null {
  if (!canManage) return 'قوالب سير العمل لمسؤولي التكليف';
  if (after?.deletedAt) return null;
  if (!before && after.builtIn) return 'القوالب الجاهزة تأتي مع المنصة';
  return templateError(after);
}

// ---------------------------------------------------------------------------
// Resolving a template into an assignment
// ---------------------------------------------------------------------------

/** A colleague who may be given a step, with how much open work they already hold. */
export interface Candidate {
  id: string;
  name: string;
  stationId?: string;
  role?: string;
  departmentId?: string;
  canManage?: boolean;
  /** Open steps assigned to them across open assignments. */
  load: number;
}

/** Open steps per colleague across open assignments: the load shown when picking someone. */
export function openStepLoad(cards: ProductionCard[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const card of cards) {
    if (card.deletedAt || card.status !== 'OPEN') continue;
    for (const s of card.steps || []) if (s.assigneeId && s.status !== 'DONE' && s.status !== 'SKIPPED') load.set(s.assigneeId, (load.get(s.assigneeId) || 0) + 1);
  }
  return load;
}

/**
 * The colleagues a rule points at, the assignment's station first and the least loaded first.
 * ASK offers everyone whose kind of work fits the step.
 */
export function ruleCandidates(step: TemplateStep, people: Candidate[], stationId?: string): Candidate[] {
  const rule = step.rule;
  const matches = people.filter((p) => {
    switch (rule.kind) {
      case 'PERSON':
        return p.id === rule.userId;
      case 'ROLE':
        return p.role === rule.role;
      case 'DEPARTMENT':
        return p.departmentId === rule.departmentId;
      case 'STATION':
        return p.stationId === rule.stationId && stepFitsActor(step.type, { canManage: false, role: p.role, departmentId: p.departmentId });
      default:
        return stepFitsActor(step.type, { canManage: false, role: p.role, departmentId: p.departmentId });
    }
  });
  const home = (p: Candidate) => (stationId && p.stationId === stationId ? 0 : 1);
  return matches.sort((a, b) => home(a) - home(b) || a.load - b.load || a.name.localeCompare(b.name, 'ar'));
}

/** What the manager fills in when creating an assignment from a template. */
export interface AssignmentInput {
  title: string;
  brief?: string;
  /** Delivery deadline; step deadlines are counted back from it (or from the air time). */
  dueAt?: string;
  airAt?: string;
  ownerId?: string;
  /** The station producing the assignment: role and department rules look there first. */
  stationId?: string;
  priority?: 'NORMAL' | 'URGENT';
  /** Per template step: a colleague's id, `s:<station>` or `d:<department>` to leave it open, or '' for the default. */
  picks?: Record<string, string>;
}

/** The default choice for a step: the named person, a lone match in the station, or the step stays open. */
export function defaultPick(step: TemplateStep, people: Candidate[], stationId?: string): string {
  const rule = step.rule;
  if (rule.kind === 'PERSON') return people.some((p) => p.id === rule.userId) ? rule.userId : '';
  if (rule.kind === 'STATION') return `s:${rule.stationId}`;
  if (rule.kind === 'ROLE' || rule.kind === 'DEPARTMENT') {
    const local = ruleCandidates(step, people, stationId).filter((p) => !stationId || p.stationId === stationId);
    if (local.length === 1) return local[0].id;
    if (rule.kind === 'DEPARTMENT') return `d:${rule.departmentId}`;
    return stationId ? `s:${stationId}` : '';
  }
  return '';
}

/** Turns a template and the manager's choices into a new assignment (a production card, not yet saved). */
export function cardFromTemplate(template: WorkflowTemplate, input: AssignmentInput, people: Candidate[], options: { newStepId?: () => string; cardId?: string } = {}): ProductionCard {
  const stepId = options.newStepId || (() => newId('stp'));
  const deadline = input.dueAt || input.airAt;
  const base = deadline ? new Date(deadline).getTime() : NaN;
  const steps: CardStep[] = template.steps.map((t) => {
    const pick = input.picks?.[t.id] || defaultPick(t, people, input.stationId);
    const step: CardStep = {
      id: stepId(),
      type: t.type,
      title: t.title?.trim() || undefined,
      status: 'TODO',
      complexity: t.complexity,
      estimateMinutes: t.estimateMinutes || undefined,
      checklist: t.checklist?.length ? t.checklist.map((text) => ({ text })) : undefined,
    };
    if (Number.isFinite(base) && typeof t.dueOffsetMinutes === 'number') step.dueAt = new Date(base - t.dueOffsetMinutes * 60_000).toISOString();
    if (pick.startsWith('s:')) step.stationId = pick.slice(2);
    else if (pick.startsWith('d:')) {
      step.departmentId = pick.slice(2);
      if (input.stationId) step.stationId = input.stationId;
    } else if (pick) step.assigneeId = pick;
    return step;
  });
  return {
    id: options.cardId || newId('crd'),
    title: input.title.trim(),
    kind: template.kind,
    brief: input.brief?.trim() || template.description?.trim() || undefined,
    priority: input.priority || template.priority,
    status: 'OPEN',
    ownerId: input.ownerId,
    dueAt: input.dueAt,
    airAt: input.airAt,
    steps,
    log: [],
    templateId: template.id,
    templateName: template.name,
  };
}

/** «حفظ كقالب»: the chain of an existing assignment, with deadlines made relative to its own. */
export function templateFromCard(card: ProductionCard, name: string, options: { id?: string; newStepId?: () => string } = {}): WorkflowTemplate {
  const stepId = options.newStepId || (() => newId('tst'));
  const deadline = card.dueAt || card.airAt;
  const base = deadline ? new Date(deadline).getTime() : NaN;
  return {
    id: options.id || newId('wft'),
    name: name.trim(),
    kind: card.kind,
    description: card.brief,
    priority: card.priority,
    steps: card.steps.map((s) => {
      const rule: AssigneeRule = s.assigneeId ? { kind: 'PERSON', userId: s.assigneeId } : s.departmentId ? { kind: 'DEPARTMENT', departmentId: s.departmentId } : s.stationId ? { kind: 'STATION', stationId: s.stationId } : { kind: 'ASK' };
      const offset = Number.isFinite(base) && s.dueAt ? Math.round((base - new Date(s.dueAt).getTime()) / 60_000) : undefined;
      return {
        id: stepId(),
        type: s.type,
        title: s.title,
        rule,
        dueOffsetMinutes: offset !== undefined && Math.abs(offset) <= MAX_OFFSET ? offset : undefined,
        complexity: s.complexity,
        estimateMinutes: s.estimateMinutes,
        checklist: s.checklist?.length ? s.checklist.map((c) => c.text) : undefined,
      };
    }),
  };
}

/** A copy to edit separately («نسخ القالب»). */
export function duplicateTemplate(t: WorkflowTemplate, options: { id?: string; newStepId?: () => string } = {}): WorkflowTemplate {
  const stepId = options.newStepId || (() => newId('tst'));
  return {
    id: options.id || newId('wft'),
    name: `${t.name} (نسخة)`.slice(0, 120),
    kind: t.kind,
    description: t.description,
    priority: t.priority,
    steps: t.steps.map((s) => ({ ...s, id: stepId(), rule: { ...s.rule } as AssigneeRule, checklist: s.checklist ? [...s.checklist] : undefined })),
  };
}

// ---------------------------------------------------------------------------
// Starter templates
// ---------------------------------------------------------------------------

const ask: AssigneeRule = { kind: 'ASK' };
const dept = (departmentId: string): AssigneeRule => ({ kind: 'DEPARTMENT', departmentId });
const role = (r: string): AssigneeRule => ({ kind: 'ROLE', role: r });

/** Shipped with the platform for new installations; administrators edit, copy or archive them. */
export const BUILT_IN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'wft-bulletin',
    name: 'نشرة أخبار',
    kind: 'BULLETIN',
    description: 'إعداد نشرة كاملة: تحرير القصص، المونتاج، الجرافيك، المراجعة والاعتماد قبل الهواء.',
    priority: 'NORMAL',
    builtIn: true,
    steps: [
      { id: 'b1', type: 'prep', title: 'ترتيب النشرة وتوزيع القصص', rule: ask, dueOffsetMinutes: 240, complexity: 2, estimateMinutes: 45 },
      { id: 'b2', type: 'edit', title: 'تحرير القصص والعناوين', rule: dept('newsroom'), dueOffsetMinutes: 120, complexity: 2, estimateMinutes: 90, checklist: ['العناوين مكتوبة', 'الأسماء والأرقام متحقق منها'] },
      { id: 'b3', type: 'montage', title: 'مونتاج التقارير', rule: dept('montage'), dueOffsetMinutes: 60, complexity: 2, estimateMinutes: 90 },
      { id: 'b4', type: 'graphics', title: 'أسماء الضيوف والخرائط', rule: dept('graphics'), dueOffsetMinutes: 60, complexity: 1, estimateMinutes: 30 },
      { id: 'b5', type: 'quality', rule: role('QUALITY'), dueOffsetMinutes: 30, complexity: 1, estimateMinutes: 20, checklist: ['اللغة', 'الصورة والصوت'] },
      { id: 'b6', type: 'approve', rule: ask, dueOffsetMinutes: 15, complexity: 1 },
    ],
  },
  {
    id: 'wft-field',
    name: 'تقرير ميداني',
    kind: 'REPORT',
    description: 'تصوير ميداني ثم تحقق وتحرير ومونتاج ومراجعة.',
    priority: 'NORMAL',
    builtIn: true,
    steps: [
      { id: 'f1', type: 'gather', title: 'التصوير والمقابلات', rule: dept('field'), dueOffsetMinutes: 300, complexity: 3, estimateMinutes: 180, checklist: ['أسماء المتحدثين مكتوبة', 'اللقطات مرفقة بالتكليف'] },
      { id: 'f2', type: 'verify', rule: ask, dueOffsetMinutes: 240, complexity: 1, estimateMinutes: 30 },
      { id: 'f3', type: 'edit', title: 'كتابة النص', rule: dept('newsroom'), dueOffsetMinutes: 180, complexity: 2, estimateMinutes: 60 },
      { id: 'f4', type: 'montage', rule: dept('montage'), dueOffsetMinutes: 90, complexity: 2, estimateMinutes: 90 },
      { id: 'f5', type: 'quality', rule: role('QUALITY'), dueOffsetMinutes: 45, complexity: 1, estimateMinutes: 20 },
      { id: 'f6', type: 'approve', rule: ask, dueOffsetMinutes: 15, complexity: 1 },
    ],
  },
  {
    id: 'wft-interview',
    name: 'مقابلة',
    kind: 'INTERVIEW',
    description: 'إعداد الضيف والأسئلة، التسجيل، ثم المونتاج والمراجعة.',
    priority: 'NORMAL',
    builtIn: true,
    steps: [
      { id: 'i1', type: 'prep', title: 'الضيف والمحاور والأسئلة', rule: dept('production'), dueOffsetMinutes: 1440, complexity: 2, estimateMinutes: 90, checklist: ['تأكيد موعد الضيف', 'حجز الاستديو'] },
      { id: 'i2', type: 'gather', title: 'تسجيل المقابلة', rule: ask, dueOffsetMinutes: 240, complexity: 2, estimateMinutes: 60 },
      { id: 'i3', type: 'montage', rule: dept('montage'), dueOffsetMinutes: 90, complexity: 2, estimateMinutes: 60 },
      { id: 'i4', type: 'quality', rule: role('QUALITY'), dueOffsetMinutes: 30, complexity: 1, estimateMinutes: 20 },
    ],
  },
  {
    id: 'wft-episode',
    name: 'حلقة برنامج',
    kind: 'PROGRAM',
    description: 'إعداد الحلقة وفقراتها حتى الاعتماد والإدراج في البث.',
    priority: 'NORMAL',
    builtIn: true,
    steps: [
      { id: 'e1', type: 'prep', title: 'محاور الحلقة والضيوف', rule: dept('production'), dueOffsetMinutes: 2880, complexity: 3, estimateMinutes: 240 },
      { id: 'e2', type: 'edit', title: 'نص المقدمة والفقرات', rule: ask, dueOffsetMinutes: 1440, complexity: 2, estimateMinutes: 120 },
      { id: 'e3', type: 'montage', title: 'التقارير المسجلة', rule: dept('montage'), dueOffsetMinutes: 480, complexity: 3, estimateMinutes: 180 },
      { id: 'e4', type: 'graphics', rule: dept('graphics'), dueOffsetMinutes: 480, complexity: 2, estimateMinutes: 90 },
      { id: 'e5', type: 'quality', rule: role('QUALITY'), dueOffsetMinutes: 120, complexity: 1, estimateMinutes: 30 },
      { id: 'e6', type: 'approve', rule: ask, dueOffsetMinutes: 60, complexity: 1 },
      { id: 'e7', type: 'publish', rule: dept('control'), dueOffsetMinutes: 0, complexity: 1 },
    ],
  },
  {
    id: 'wft-breaking',
    name: 'رصد وتغطية عاجلة',
    kind: 'NEWS',
    description: 'رصد الحدث والتحقق منه ثم خبر عاجل يُعتمد ويُبث بسرعة.',
    priority: 'URGENT',
    builtIn: true,
    steps: [
      { id: 'r1', type: 'monitor', title: 'رصد المصادر والمنصات', rule: dept('monitoring'), dueOffsetMinutes: 45, complexity: 1, estimateMinutes: 20 },
      { id: 'r2', type: 'verify', rule: ask, dueOffsetMinutes: 30, complexity: 2, estimateMinutes: 15, checklist: ['مصدران مستقلان على الأقل'] },
      { id: 'r3', type: 'edit', title: 'صياغة الخبر العاجل', rule: dept('newsroom'), dueOffsetMinutes: 15, complexity: 1, estimateMinutes: 10 },
      { id: 'r4', type: 'approve', rule: ask, dueOffsetMinutes: 5, complexity: 1 },
      { id: 'r5', type: 'publish', rule: ask, dueOffsetMinutes: 0, complexity: 1 },
    ],
  },
];
