import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  cardFromTemplate,
  defaultPick,
  duplicateTemplate,
  openStepLoad,
  ruleCandidates,
  templateChangeError,
  templateError,
  templateFromCard,
  type Candidate,
  type WorkflowTemplate,
} from '../../src/shared/workflowTemplates';
import { cardChangeError, DEFAULT_STEP_TYPES, type ProductionCard } from '../../src/shared/productionCards';

const people: Candidate[] = [
  { id: 'samer', name: 'سامر', stationId: 'gaza', role: 'MONTAGE', departmentId: 'montage', load: 3 },
  { id: 'omar', name: 'عمر', stationId: 'beirut', role: 'MEDIA', departmentId: 'montage', load: 0 },
  { id: 'heba', name: 'هبة', stationId: 'istanbul', role: 'QUALITY', departmentId: 'quality', load: 1 },
  { id: 'sara', name: 'سارة', stationId: 'gaza', role: 'JOURNALIST', departmentId: 'newsroom', load: 2 },
  { id: 'tariq', name: 'طارق', stationId: 'gaza', role: 'JOURNALIST', departmentId: 'newsroom', load: 5 },
];

const template: WorkflowTemplate = {
  id: 'wft-1',
  name: 'تقرير',
  kind: 'REPORT',
  priority: 'NORMAL',
  steps: [
    { id: 'a', type: 'edit', rule: { kind: 'DEPARTMENT', departmentId: 'newsroom' }, dueOffsetMinutes: 120, complexity: 2, checklist: ['الأسماء'] },
    { id: 'b', type: 'montage', rule: { kind: 'ROLE', role: 'MONTAGE' }, dueOffsetMinutes: 60, complexity: 2 },
    { id: 'c', type: 'quality', rule: { kind: 'PERSON', userId: 'heba' }, dueOffsetMinutes: 0, complexity: 1 },
    { id: 'd', type: 'publish', rule: { kind: 'STATION', stationId: 'istanbul' }, complexity: 1 },
    { id: 'e', type: 'approve', rule: { kind: 'ASK' }, complexity: 1 },
  ],
};

describe('workflow templates', () => {
  it.each(['wft-bulletin', 'wft-episode', 'wft-field'])('adapts %s to a small or specialized team', (id) => {
    const builtIn = BUILT_IN_TEMPLATES.find((entry) => entry.id === id)!;
    const dueAt = '2026-11-20T18:00:00Z';
    const deskStep = builtIn.steps.find((step) => step.rule.kind === 'DEPARTMENT')!;
    if (deskStep.rule.kind !== 'DEPARTMENT') throw new Error('Expected a departmental step');
    const lead: Candidate = { id: 'lead', name: 'المسؤول', stationId: 'gaza', load: 0 };
    const specialist: Candidate = { ...lead, id: 'specialist', departmentId: deskStep.rule.departmentId };
    const small = cardFromTemplate(builtIn, {
      title: builtIn.name, stationId: 'gaza', dueAt,
      picks: Object.fromEntries(builtIn.steps.map((step) => [step.id, lead.id])),
    }, [lead]);
    const specialized = cardFromTemplate(builtIn, {
      title: builtIn.name, stationId: 'gaza', dueAt,
    }, [lead, specialist]);
    expect(small.steps.every((step) => step.assigneeId === lead.id)).toBe(true);
    expect(specialized.steps[builtIn.steps.indexOf(deskStep)].assigneeId).toBe(specialist.id);
    expect(small.steps.map((step) => step.dueAt)).toEqual(specialized.steps.map((step) => step.dueAt));
    expect(small.steps.every((step) => step.dueAt && Date.parse(step.dueAt) <= Date.parse(dueAt))).toBe(true);
  });

  it('validates templates and keeps them with supervisors', () => {
    expect(templateError(template)).toBeNull();
    expect(templateError({ ...template, name: ' ' })).toContain('اسم القالب');
    expect(templateError({ ...template, steps: [] })).toContain('مهمة');
    expect(templateError({ ...template, steps: [{ ...template.steps[0], rule: { kind: 'ROLE', role: '' } }] })).toContain('الدور');
    expect(templateError({ ...template, steps: [{ ...template.steps[0], dueOffsetMinutes: 1.5 }] })).toContain('بالدقائق');
    expect(templateChangeError(null, template, false)).toContain('مسؤولي التكليف');
    expect(templateChangeError(null, { ...template, builtIn: true }, true)).toContain('الجاهزة');
    for (const t of BUILT_IN_TEMPLATES) expect(templateError(t)).toBeNull();
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toEqual(['نشرة أخبار', 'تقرير ميداني', 'مقابلة', 'حلقة برنامج', 'رصد وتغطية عاجلة']);
  });

  it('lists the colleagues a rule points at, the station first and the least loaded first', () => {
    expect(ruleCandidates(template.steps[0], people, 'gaza').map((p) => p.id)).toEqual(['sara', 'tariq']);
    expect(ruleCandidates(template.steps[1], people, 'gaza').map((p) => p.id)).toEqual(['samer']);
    expect(ruleCandidates(template.steps[2], people).map((p) => p.id)).toEqual(['heba']);
    // «يحدده المكلِّف» offers whoever does that kind of work.
    expect(ruleCandidates({ ...template.steps[4], type: 'montage' }, people, 'beirut').map((p) => p.id)).toEqual(['omar', 'samer']);
  });

  it('resolves defaults: a named person, a lone match, or open to the station or department', () => {
    expect(defaultPick(template.steps[0], people, 'gaza')).toBe('d:newsroom');
    expect(defaultPick(template.steps[1], people, 'gaza')).toBe('samer');
    expect(defaultPick(template.steps[2], people, 'gaza')).toBe('heba');
    expect(defaultPick(template.steps[3], people, 'gaza')).toBe('s:istanbul');
    expect(defaultPick(template.steps[4], people, 'gaza')).toBe('');
    expect(defaultPick(template.steps[1], people, 'istanbul')).toBe('s:istanbul');
  });

  it('creates an assignment a supervisor may save, with deadlines counted back from the delivery time', () => {
    let n = 0;
    const card = cardFromTemplate(template, { title: ' تقرير الكهرباء ', dueAt: '2026-11-19T18:00:00.000Z', ownerId: 'chief', stationId: 'gaza', picks: { a: 'tariq', e: 'chief' } }, people, { newStepId: () => `s${++n}`, cardId: 'crd-x' });
    expect(card).toMatchObject({ id: 'crd-x', title: 'تقرير الكهرباء', kind: 'REPORT', status: 'OPEN', templateId: 'wft-1', templateName: 'تقرير' });
    expect(card.steps.map((s) => [s.id, s.type, s.assigneeId, s.stationId, s.dueAt])).toEqual([
      ['s1', 'edit', 'tariq', undefined, '2026-11-19T16:00:00.000Z'],
      ['s2', 'montage', 'samer', undefined, '2026-11-19T17:00:00.000Z'],
      ['s3', 'quality', 'heba', undefined, '2026-11-19T18:00:00.000Z'],
      ['s4', 'publish', undefined, 'istanbul', undefined],
      ['s5', 'approve', 'chief', undefined, undefined],
    ]);
    expect(card.steps[0].checklist).toEqual([{ text: 'الأسماء' }]);
    const ctx = { stations: [{ id: 'gaza', name: 'غزة' }, { id: 'istanbul', name: 'إسطنبول' }], stepTypes: DEFAULT_STEP_TYPES, users: new Map(['chief', ...people.map((p) => p.id)].map((id) => [id, {}])) };
    expect(cardChangeError(null, card, { id: 'chief', canManage: true, canWork: true }, ctx)).toBeNull();
    // A department left open inside the station.
    const open = cardFromTemplate(template, { title: 'x', stationId: 'gaza' }, people);
    expect(open.steps[0]).toMatchObject({ departmentId: 'newsroom', stationId: 'gaza' });
    expect(open.steps[0].assigneeId).toBeUndefined();
  });

  it('keeps an explicitly unassigned step empty and applies defaults only to untouched steps', () => {
    const card = cardFromTemplate(template, { title: 'تكليف', stationId: 'gaza', picks: { a: '', c: '' } }, people);
    for (const index of [0, 2]) {
      expect(card.steps[index].assigneeId).toBeUndefined();
      expect(card.steps[index].departmentId).toBeUndefined();
      expect(card.steps[index].stationId).toBeUndefined();
    }
    expect(card.steps[1].assigneeId).toBe('samer');
  });

  it('saves an assignment as a template and copies templates', () => {
    const card: ProductionCard = {
      id: 'c1', title: 'موجز', kind: 'BRIEF', priority: 'URGENT', status: 'OPEN', dueAt: '2026-11-19T12:00:00Z',
      steps: [
        { id: 'x', type: 'edit', status: 'DONE', complexity: 1, assigneeId: 'sara', dueAt: '2026-11-19T11:30:00Z', checklist: [{ text: 'العنوان', done: true }] },
        { id: 'y', type: 'montage', status: 'TODO', complexity: 2, stationId: 'gaza' },
        { id: 'z', type: 'approve', status: 'TODO', complexity: 1 },
      ],
    };
    const t = templateFromCard(card, 'موجز الظهيرة', { id: 'wft-2' });
    expect(t).toMatchObject({ id: 'wft-2', name: 'موجز الظهيرة', kind: 'BRIEF', priority: 'URGENT' });
    expect(t.steps.map((s) => [s.type, s.rule, s.dueOffsetMinutes, s.checklist])).toEqual([
      ['edit', { kind: 'PERSON', userId: 'sara' }, 30, ['العنوان']],
      ['montage', { kind: 'STATION', stationId: 'gaza' }, undefined, undefined],
      ['approve', { kind: 'ASK' }, undefined, undefined],
    ]);
    expect(templateError(t)).toBeNull();
    const copy = duplicateTemplate({ ...t, builtIn: true, archived: true }, { id: 'wft-3' });
    expect(copy).toMatchObject({ id: 'wft-3', name: 'موجز الظهيرة (نسخة)' });
    expect(copy.builtIn).toBeUndefined();
    expect(copy.archived).toBeUndefined();
    expect(copy.steps.map((s) => s.id)).not.toEqual(t.steps.map((s) => s.id));
  });

  it('counts each colleague\'s open steps across open assignments', () => {
    const cards: ProductionCard[] = [
      { id: '1', title: 'a', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [{ id: 'a', type: 'edit', status: 'TODO', complexity: 1, assigneeId: 'sara' }, { id: 'b', type: 'edit', status: 'DONE', complexity: 1, assigneeId: 'sara' }] },
      { id: '2', title: 'b', kind: 'NEWS', priority: 'NORMAL', status: 'CLOSED', steps: [{ id: 'a', type: 'edit', status: 'TODO', complexity: 1, assigneeId: 'sara' }] },
      { id: '3', title: 'c', kind: 'NEWS', priority: 'NORMAL', status: 'OPEN', steps: [{ id: 'a', type: 'edit', status: 'BLOCKED', blockedReason: 'x', complexity: 1, assigneeId: 'sara' }] },
    ];
    expect(openStepLoad(cards).get('sara')).toBe(2);
  });
});
