import React, { useEffect, useMemo, useState } from 'react';
import { stationFilterMatcher, stationGroupsOf } from '../shared/managerToday';
import { AlertTriangle, ClipboardList, LayoutTemplate, Plus, Radio } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { FilterTabs } from '../components/common/FilterTabs';
import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { CardDetail } from '../components/cards/CardDetail';
import { CardFormPage } from '../components/cards/CardFormPage';
import { TemplatesPanel } from '../components/cards/TemplatesPanel';
import { TemplateFormPage } from '../components/cards/TemplateFormPage';
import { AssignFromTemplatePage } from '../components/cards/AssignFromTemplatePage';
import { AssignmentReports } from '../components/cards/AssignmentReports';
import { templateFromCard, type WorkflowTemplate } from '../shared/workflowTemplates';
import { promptDialog } from '../services/dialogs';
import { notify } from '../services/notify';
import { CARD_STATE_STYLE, STEP_STATUS_STYLE, stationDay, timeOnly, when } from '../components/cards/cardUi';
import { matchesQuery } from '../shared/search';
import {
  CARD_KINDS,
  CARD_STATE_NAMES,
  canClaimStep,
  cardHoldReason,
  cardKindName,
  cardProgress,
  cardState,
  cardStates,
  currentStep,
  isCardLate,
  isStepOpen,
  isStepOwnLate,
  stepAssigneeLabel,
  stepStatusName,
  stepTypeName,
  stepTypesOf,
  type CardState,
  type CardStep,
  type ProductionCard,
} from '../shared/productionCards';
import { stationName, stationsOf } from '../shared/stations';

interface ProductionCardsViewProps {
  currentUser: User;
  users: User[];
  /** Card opened from a notification or a shared link. */
  focusId?: string | null;
  onFocus: (id: string | null) => void;
  onOpenNews: (newsId: string) => void;
  onOpenEpisode: (episodeId: string) => void;
}

type Tab = 'MINE' | 'TODAY' | 'ALL' | 'TEMPLATES' | 'REPORTS';
const OPEN_STATES: CardState[] = ['BLOCKED', 'LATE', 'IN_PROGRESS', 'NEW', 'READY'];

const SELECT = 'min-h-11 min-w-0 px-3 border border-slate-300 rounded-lg text-sm bg-white';

/**
 * Assignments («التكليفات», stored as production cards) shared between stations: my steps, the
 * board for today, every assignment, the workflow templates they are created from, and reports.
 */
export const ProductionCardsView: React.FC<ProductionCardsViewProps> = ({ currentUser, users, focusId, onFocus, onOpenNews, onOpenEpisode }) => {
  const canManage = RbacService.hasPermission(currentUser, 'cards.manage');
  const actor = apiService.cardActor();
  const [cards, setCards] = useState<ProductionCard[]>(() => apiService.getCards());
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(() => apiService.getWorkflowTemplates());
  const [templateForm, setTemplateForm] = useState<{ open: boolean; template: WorkflowTemplate | null }>({ open: false, template: null });
  const [assignForm, setAssignForm] = useState<{ open: boolean; templateId: string | null }>({ open: false, templateId: null });
  const [settings, setSettings] = useState(() => apiService.getSettings());
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const [tab, setTab] = useState<Tab>(canManage ? 'TODAY' : 'MINE');
  const [query, setQuery] = useState('');
  const [station, setStation] = useState('ALL');
  const stationGroups = useMemo(() => stationGroupsOf(settings), [settings]);
  const inStation = useMemo(() => stationFilterMatcher(station, stationGroups), [station, stationGroups]);
  const [stateFilter, setStateFilter] = useState<'OPEN' | CardState>('OPEN');
  const [kind, setKind] = useState('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionCard | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type !== 'data-changed') return;
        if (evt.collections.includes('productionCards')) setCards(apiService.getCards());
        if (evt.collections.includes('workflowTemplates')) setTemplates(apiService.getWorkflowTemplates());
        if (evt.collections.includes('settings')) setSettings(apiService.getSettings());
      }),
    []
  );
  // Lateness is measured against the clock, so the board keeps itself current.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = () => setCards(apiService.getCards());
  // Opening a card is reading the notifications that point at it.
  useEffect(() => {
    if (focusId) apiService.markNotificationsReadFor(`/cards/${focusId}`);
  }, [focusId, cards]);
  const opened = focusId ? cards.find((c) => c.id === focusId) || null : null;
  const openCards = useMemo(() => cards.filter((c) => c.status === 'OPEN'), [cards]);

  const mySteps = useMemo(() => {
    const rows: { card: ProductionCard; step: CardStep; claimable: boolean }[] = [];
    for (const card of openCards) {
      for (const step of card.steps) {
        if (!isStepOpen(step)) continue;
        if (step.assigneeId === currentUser.id) rows.push({ card, step, claimable: false });
        // Only steps that are this colleague's kind of work are offered (the server applies the same rule).
        else if ((step.stationId || step.departmentId) && canClaimStep(step, actor)) rows.push({ card, step, claimable: true });
      }
    }
    // Work sent back for rework comes first, then blockers and delays, then the rest; offers last.
    const rank = (r: (typeof rows)[number]) => (r.step.returnedReason && !r.claimable ? 0 : r.step.status === 'BLOCKED' ? 1 : isStepOwnLate(r.card, r.step, now) ? 2 : r.claimable ? 4 : 3);
    return rows.sort((a, b) => rank(a) - rank(b) || (a.step.dueAt || '9').localeCompare(b.step.dueAt || '9'));
    // actor is rebuilt on every render from the same user and permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCards, currentUser.id, currentUser.stationId, now]);

  const today = stationDay(now);
  const board = useMemo(() => {
    const airing = openCards.filter((c) => c.airAt && stationDay(c.airAt) === today).sort((a, b) => a.airAt!.localeCompare(b.airAt!));
    const needDecision = openCards.filter((c) => cardState(c, now) === 'BLOCKED' || isCardLate(c, now)).sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT') || (a.airAt || a.dueAt || '9').localeCompare(b.airAt || b.dueAt || '9'));
    const count = (s: CardState) => openCards.filter((c) => cardState(c, now) === s).length;
    // A blocked card past its deadline counts in both «متعطلة» and «متأخرة».
    const late = openCards.filter((c) => isCardLate(c, now)).length;
    return { airing, needDecision, ready: count('READY'), late, blocked: count('BLOCKED'), working: count('IN_PROGRESS') + count('NEW') };
  }, [openCards, today, now]);

  const filtered = useMemo(
    () =>
      cards
        .filter((c) => (stateFilter === 'OPEN' ? c.status === 'OPEN' : cardStates(c, now).includes(stateFilter)))
        .filter((c) => kind === 'ALL' || c.kind === kind)
        .filter((c) => station === 'ALL' || inStation(c.ownerStationId) || c.steps.some((s) => inStation(s.stationId)))
        .filter((c) => matchesQuery(query, c.title, c.brief, c.ownerName, c.target?.title, c.templateName, c.steps.map((s) => s.assigneeName || '')))
        .sort((a, b) => OPEN_STATES.indexOf(cardState(a, now)) - OPEN_STATES.indexOf(cardState(b, now)) || (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [cards, stateFilter, kind, station, query, now, inStation]
  );
  const page = useIncremental(filtered, 40, `${stateFilter}|${kind}|${station}|${query}`);

  const openTarget = (card: ProductionCard) => {
    if (card.target?.kind === 'news') onOpenNews(card.target.id);
    if (card.target?.kind === 'episode') onOpenEpisode(card.target.id);
  };

  const cardRow = (card: ProductionCard, extra?: React.ReactNode) => {
    const states = cardStates(card, now);
    const progress = cardProgress(card);
    const waiting = currentStep(card);
    return (
      <li key={card.id}>
        <button type="button" onClick={() => onFocus(card.id)} className={`w-full text-right bg-white border rounded-2xl p-3 sm:p-4 space-y-1.5 hover:border-blue-300 ${card.priority === 'URGENT' && card.status === 'OPEN' ? 'border-red-300' : 'border-slate-200'}`}>
          <span className="flex flex-wrap items-center gap-2 text-2xs">
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold">{cardKindName(card.kind)}</span>
            {states.map((state) => (
              <span key={state} className={`px-2 py-0.5 rounded-md border font-bold ${CARD_STATE_STYLE[state]}`}>{CARD_STATE_NAMES[state]}</span>
            ))}
            {card.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
            {card.ownerStationId && <span className="px-2 py-0.5 rounded-md border border-slate-200 text-slate-700">محطة {stationName(stations, card.ownerStationId)}</span>}
            <span className="text-slate-600 tabular-nums" title={`أُنجز ${progress.done} من ${progress.total}`}>المهام {progress.done}/{progress.total}</span>
            {card.airAt && <span className="text-slate-600 mr-auto">البث {when(card.airAt)}</span>}
          </span>
          <span className="block text-sm font-bold text-slate-900">{card.title}</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-600">
            {waiting && card.status === 'OPEN' && (
              <span>
                بانتظار: {stepTypeName(stepTypes, waiting.type)} — {stepAssigneeLabel(waiting, stations)}
              </span>
            )}
            {card.dueAt && <span>التسليم {when(card.dueAt)}</span>}
            <span>القرار: {card.ownerName || '—'}</span>
            {card.templateName && <span>القالب: {card.templateName}</span>}
          </span>
          {extra}
        </button>
      </li>
    );
  };

  const form = (
    <CardFormPage
      isOpen={formOpen}
      onClose={() => setFormOpen(false)}
      card={editing}
      users={users}
      currentUser={currentUser}
      onSaved={(_card, text) => {
        refresh();
        notify({ type: 'success', message: text });
        // A new assignment appears at the top of «كل التكليفات».
        if (!editing) setTab('ALL');
      }}
    />
  );

  /** «حفظ كقالب»: the chain of this assignment becomes a template to reuse. */
  const saveAsTemplate = async (card: ProductionCard) => {
    const name = await promptDialog({ title: 'حفظ كقالب', label: 'اسم القالب', required: true, defaultValue: card.templateName || card.title });
    if (!name?.trim()) return;
    // Opens the template page on the draft so the manager reviews who does each step before saving.
    setTemplateForm({ open: true, template: templateFromCard(card, name) });
  };

  const templatePages = (
    <>
      <TemplateFormPage
        isOpen={templateForm.open}
        template={templateForm.template}
        onClose={() => setTemplateForm({ open: false, template: null })}
        onSaved={() => {
          setTemplates(apiService.getWorkflowTemplates());
          setTab('TEMPLATES');
        }}
      />
      <AssignFromTemplatePage
        isOpen={assignForm.open}
        templateId={assignForm.templateId}
        currentUser={currentUser}
        onClose={() => setAssignForm({ open: false, templateId: null })}
        onCreated={(card) => {
          refresh();
          onFocus(card.id);
        }}
      />
    </>
  );

  // A card has its own address (/cards/<id>): Back returns to the list, and links open it directly.
  if (focusId) {
    return (
      <>
        {opened ? (
          <CardDetail
            card={opened}
            onClose={() => onFocus(null)}
            onEdit={(card) => {
              setEditing(card);
              setFormOpen(true);
            }}
            onOpenTarget={openTarget}
            onSaveAsTemplate={canManage ? saveAsTemplate : undefined}
          />
        ) : (
          <div className="max-w-xl mx-auto text-center space-y-3 py-16">
            <p className="text-sm font-bold text-slate-800">هذا التكليف غير موجود أو حُذف.</p>
            <button type="button" onClick={() => onFocus(null)} className="min-h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
              العودة إلى التكليفات
            </button>
          </div>
        )}
        {form}
        {templatePages}
      </>
    );
  }

  const empty = (text: string) => <p className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed border-slate-300 rounded-2xl">{text}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-blue-600" />
            التكليفات
          </h1>
          <p className="text-xs text-slate-500 mt-1">تكليف واحد يرافق كل مادة بين المحطات والأقسام: المطلوب، المسؤول عن كل مهمة، مواعيد التسليم والبث، وما اكتمل وما ينقص.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2 self-start">
            <button
              type="button"
              data-tour="card-create"
              onClick={() => setAssignForm({ open: true, templateId: null })}
              className="inline-flex items-center gap-1.5 min-h-11 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
            >
              <LayoutTemplate className="w-4 h-4" />
              تكليف من قالب
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="inline-flex items-center gap-1.5 min-h-11 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              تكليف حر
            </button>
          </div>
        )}
      </div>

      <FilterTabs<Tab>
        label="التكليفات"
        active={tab}
        onChange={setTab}
        tabs={[
          // The count matches the rows shown: my steps and the ones offered to me.
          { id: 'MINE', label: 'مهامي', count: mySteps.length, tone: 'blue' },
          { id: 'TODAY', label: 'متابعة اليوم', count: board.needDecision.length, tone: 'amber' },
          { id: 'ALL', label: 'كل التكليفات', count: openCards.length, tone: 'slate' },
          { id: 'TEMPLATES', label: 'القوالب', count: templates.filter((t) => !t.archived).length, tone: 'violet', secondary: true },
          ...(canManage ? [{ id: 'REPORTS' as Tab, label: 'التقارير', tone: 'slate' as const, secondary: true }] : []),
        ]}
      />

      {tab === 'MINE' && (
        <section className="space-y-2" aria-label="مهامي">
          {mySteps.length === 0 && empty('لا مهام مفتوحة باسمك الآن. ما يُسند إليك في أي تكليف يظهر هنا.')}
          <ul className="space-y-2">
            {mySteps.map(({ card, step, claimable }) => (
              <li key={`${card.id}:${step.id}`}>
                <button type="button" onClick={() => onFocus(card.id)} className={`w-full text-right bg-white border rounded-2xl p-3 sm:p-4 space-y-1.5 hover:border-blue-300 ${step.returnedReason && !claimable ? 'border-violet-300' : step.status === 'BLOCKED' ? 'border-rose-300' : card.priority === 'URGENT' ? 'border-red-300' : 'border-slate-200'}`}>
                  <span className="flex flex-wrap items-center gap-2 text-2xs">
                    <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 font-bold">{stepTypeName(stepTypes, step.type)}</span>
                    {claimable ? (
                      <span className="px-2 py-0.5 rounded-md border border-sky-200 bg-sky-50 text-sky-800 font-bold">{step.departmentId && !step.stationId ? 'متاحة لقسمك — استلمها' : 'متاحة لمحطتك — استلمها'}</span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-md border font-bold ${STEP_STATUS_STYLE[step.status]}`}>{stepStatusName(step.status)}</span>
                    )}
                    {step.returnedReason && !claimable && <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-800 border border-violet-200 font-bold">معادة للتعديل</span>}
                    {isStepOwnLate(card, step, now) && <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-bold">متأخرة</span>}
                    {card.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
                    {step.dueAt && <span className="text-slate-600 mr-auto">التسليم {when(step.dueAt)}</span>}
                  </span>
                  <span className="block text-sm font-bold text-slate-900">{card.title}</span>
                  {step.title && <span className="block text-xs text-slate-600">{step.title}</span>}
                  {step.returnedReason && !claimable && <span className="block text-xs font-bold text-violet-800">أعادها {step.returnedByName || 'زميل'}: {step.returnedReason}</span>}
                  {currentStep(card)?.id !== step.id && <span className="block text-2xs text-slate-500">العمل الآن عند: {stepTypeName(stepTypes, currentStep(card)!.type)} ({stepAssigneeLabel(currentStep(card)!, stations)})</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'TODAY' && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: 'متعطلة', value: board.blocked, tone: 'text-rose-700' },
              { label: 'متأخرة', value: board.late, tone: 'text-amber-700' },
              { label: 'جاهزة', value: board.ready, tone: 'text-emerald-700' },
              { label: 'قيد العمل', value: board.working, tone: 'text-slate-900' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white border border-slate-200 rounded-2xl p-3">
                <dt className="text-2xs text-slate-600">{stat.label}</dt>
                <dd className={`text-2xl font-bold tabular-nums ${stat.value ? stat.tone : 'text-slate-900'}`}>{stat.value}</dd>
              </div>
            ))}
          </dl>

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              تحتاج قراراً
            </h2>
            {board.needDecision.length === 0 ? empty('لا شيء متعطل أو متأخر.') : (
              <ul className="space-y-2">
                {board.needDecision.map((card) =>
                  cardRow(
                    card,
                    <span className="block text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                      السبب: {cardHoldReason(card, stepTypes, now, stations) || 'تجاوزت موعد التسليم'}
                    </span>
                  )
                )}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Radio className="w-4 h-4 text-blue-600" />
              يُبث اليوم
            </h2>
            {board.airing.length === 0 ? empty('لا تكليفات بموعد بث اليوم.') : (
              <div role="region" aria-label="جدول ما يُبث اليوم" className="bg-white border border-slate-200 rounded-xl">
                <table role="table" className="max-sm:block w-full text-xs">
                  <thead role="rowgroup" className="max-sm:sr-only">
                    <tr role="row" className="text-right text-slate-600 border-b border-slate-200">
                      <th role="columnheader" scope="col" className="p-3 font-bold">البث</th>
                      <th role="columnheader" scope="col" className="p-3 font-bold">المادة</th>
                      <th role="columnheader" scope="col" className="p-3 font-bold">الحالة</th>
                      <th role="columnheader" scope="col" className="p-3 font-bold">بانتظار</th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup" className="max-sm:block">
                    {board.airing.map((card) => {
                      const states = cardStates(card, now);
                      const waiting = currentStep(card);
                      return (
                        <tr role="row" key={card.id} className="max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-3 max-sm:py-2 border-b border-slate-200 last:border-0">
                          <td role="cell" className="sm:p-3 font-bold tabular-nums whitespace-nowrap">{timeOnly(card.airAt)}</td>
                          <td role="cell" className="sm:p-3 min-w-0 [overflow-wrap:anywhere]">
                            <button type="button" onClick={() => onFocus(card.id)} className="min-h-11 sm:min-h-8 font-bold max-sm:text-sm text-blue-700 hover:underline text-right">{card.title}</button>
                          </td>
                          <td role="cell" className="max-sm:col-span-full sm:p-3">
                            <span className="flex flex-wrap gap-1">
                              {states.map((state) => (
                                <span key={state} className={`px-2 py-0.5 rounded-md border font-bold whitespace-nowrap ${CARD_STATE_STYLE[state]}`}>{CARD_STATE_NAMES[state]}</span>
                              ))}
                            </span>
                          </td>
                          <td role="cell" className="max-sm:col-span-full sm:p-3 text-slate-700 [overflow-wrap:anywhere]">
                            <span className="sm:hidden font-semibold" aria-hidden="true">بانتظار </span>
                            {waiting ? `${stepTypeName(stepTypes, waiting.type)} — ${stepAssigneeLabel(waiting, stations)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'ALL' && (
        <section className="space-y-3" aria-label="كل التكليفات">
          <div role="group" aria-label="تصفية التكليفات" className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
            <input type="search" aria-label="بحث في التكليفات" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالعنوان أو الشخص…" className={`${SELECT} col-span-full w-full sm:w-56`} />
            <select aria-label="الحالة" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as 'OPEN' | CardState)} className={SELECT}>
              <option value="OPEN">كل الجارية</option>
              {(Object.keys(CARD_STATE_NAMES) as CardState[]).map((s) => (
                <option key={s} value={s}>{CARD_STATE_NAMES[s]}</option>
              ))}
            </select>
            <select aria-label="المحطة" value={station} onChange={(e) => setStation(e.target.value)} className={SELECT}>
              <option value="ALL">كل المحطات</option>
              {stationGroups.length > 0 && (
                <optgroup label="مجموعات المحطات">
                  {stationGroups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
                </optgroup>
              )}
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select aria-label="نوع المادة" value={kind} onChange={(e) => setKind(e.target.value)} className={`${SELECT} col-span-full`}>
              <option value="ALL">كل الأنواع</option>
              {CARD_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
          {filtered.length === 0 && empty(cards.length === 0 ? 'لا تكليفات بعد. يبدأ التكليف من «تكليف من قالب» ويرافق المادة حتى البث.' : 'لا تكليفات تطابق التصفية.')}
          <ul className="space-y-2">{page.visible.map((card) => cardRow(card))}</ul>
          <ShowMore remaining={page.remaining} onMore={page.showMore} noun="تكليف" />
        </section>
      )}

      {tab === 'TEMPLATES' && (
        <TemplatesPanel
          templates={templates}
          cards={cards}
          canManage={canManage}
          onUse={(t) => setAssignForm({ open: true, templateId: t.id })}
          onEdit={(t) => setTemplateForm({ open: true, template: t })}
          onNew={() => setTemplateForm({ open: true, template: null })}
        />
      )}

      {tab === 'REPORTS' && canManage && <AssignmentReports cards={cards} now={now} />}

      {form}
      {templatePages}
    </div>
  );
};
