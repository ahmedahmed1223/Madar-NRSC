import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Plus, Radio } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { RbacService } from '../services/rbacService';
import { FilterTabs } from '../components/common/FilterTabs';
import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { CardDetail } from '../components/cards/CardDetail';
import { CardFormPage } from '../components/cards/CardFormPage';
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
  currentStep,
  isStepLate,
  isStepOpen,
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

type Tab = 'MINE' | 'TODAY' | 'ALL';
const OPEN_STATES: CardState[] = ['BLOCKED', 'LATE', 'IN_PROGRESS', 'NEW', 'READY'];

const SELECT = 'px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white';

/** Production cards shared between stations: my steps, the chief editor's board for today, and every card. */
export const ProductionCardsView: React.FC<ProductionCardsViewProps> = ({ currentUser, users, focusId, onFocus, onOpenNews, onOpenEpisode }) => {
  const canManage = RbacService.hasPermission(currentUser, 'cards.manage');
  const actor = apiService.cardActor();
  const [cards, setCards] = useState<ProductionCard[]>(() => apiService.getCards());
  const [settings, setSettings] = useState(() => apiService.getSettings());
  const stations = stationsOf(settings);
  const stepTypes = stepTypesOf(settings);
  const [tab, setTab] = useState<Tab>(canManage ? 'TODAY' : 'MINE');
  const [query, setQuery] = useState('');
  const [station, setStation] = useState('ALL');
  const [stateFilter, setStateFilter] = useState<'OPEN' | CardState>('OPEN');
  const [kind, setKind] = useState('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type !== 'data-changed') return;
        if (evt.collections.includes('productionCards')) setCards(apiService.getCards());
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
        else if (step.stationId && canClaimStep(step, actor)) rows.push({ card, step, claimable: true });
      }
    }
    const rank = (r: (typeof rows)[number]) => (r.step.status === 'BLOCKED' ? 0 : isStepLate(r.step, now) ? 1 : r.claimable ? 3 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || (a.step.dueAt || '9').localeCompare(b.step.dueAt || '9'));
    // actor is rebuilt on every render from the same user and permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCards, currentUser.id, currentUser.stationId, now]);

  const today = stationDay(now);
  const board = useMemo(() => {
    const airing = openCards.filter((c) => c.airAt && stationDay(c.airAt) === today).sort((a, b) => a.airAt!.localeCompare(b.airAt!));
    const needDecision = openCards.filter((c) => ['BLOCKED', 'LATE'].includes(cardState(c, now))).sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT') || (a.airAt || a.dueAt || '9').localeCompare(b.airAt || b.dueAt || '9'));
    const count = (s: CardState) => openCards.filter((c) => cardState(c, now) === s).length;
    return { airing, needDecision, ready: count('READY'), late: count('LATE'), blocked: count('BLOCKED'), working: count('IN_PROGRESS') + count('NEW') };
  }, [openCards, today, now]);

  const filtered = useMemo(
    () =>
      cards
        .filter((c) => (stateFilter === 'OPEN' ? c.status === 'OPEN' : cardState(c, now) === stateFilter))
        .filter((c) => kind === 'ALL' || c.kind === kind)
        .filter((c) => station === 'ALL' || c.ownerStationId === station || c.steps.some((s) => s.stationId === station))
        .filter((c) => matchesQuery(query, c.title, c.brief, c.ownerName, c.target?.title, c.steps.map((s) => s.assigneeName || '')))
        .sort((a, b) => OPEN_STATES.indexOf(cardState(a, now)) - OPEN_STATES.indexOf(cardState(b, now)) || (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [cards, stateFilter, kind, station, query, now]
  );
  const page = useIncremental(filtered, 40, `${stateFilter}|${kind}|${station}|${query}`);

  const openTarget = (card: ProductionCard) => {
    if (card.target?.kind === 'news') onOpenNews(card.target.id);
    if (card.target?.kind === 'episode') onOpenEpisode(card.target.id);
  };

  const cardRow = (card: ProductionCard, extra?: React.ReactNode) => {
    const state = cardState(card, now);
    const progress = cardProgress(card);
    const waiting = currentStep(card);
    return (
      <li key={card.id}>
        <button type="button" onClick={() => onFocus(card.id)} className={`w-full text-right bg-white border rounded-2xl p-3 sm:p-4 space-y-1.5 hover:border-blue-300 ${card.priority === 'URGENT' && card.status === 'OPEN' ? 'border-red-300' : 'border-slate-200'}`}>
          <span className="flex flex-wrap items-center gap-2 text-2xs">
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold">{cardKindName(card.kind)}</span>
            <span className={`px-2 py-0.5 rounded-md border font-bold ${CARD_STATE_STYLE[state]}`}>{CARD_STATE_NAMES[state]}</span>
            {card.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
            <span className="text-slate-600 tabular-nums">{progress.done}/{progress.total}</span>
            {card.airAt && <span className="text-slate-600 mr-auto">البث {when(card.airAt)}</span>}
          </span>
          <span className="block text-sm font-bold text-slate-900">{card.title}</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-600">
            {waiting && card.status === 'OPEN' && (
              <span>
                بانتظار: {stepTypeName(stepTypes, waiting.type)} — {waiting.assigneeName || (waiting.stationId ? `محطة ${stationName(stations, waiting.stationId)}` : 'غير مسندة')}
              </span>
            )}
            {card.dueAt && <span>التسليم {when(card.dueAt)}</span>}
            <span>القرار: {card.ownerName || '—'}</span>
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
        setMessage(text);
        // A new card appears at the top of «كل البطاقات».
        if (!editing) setTab('ALL');
      }}
    />
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
          />
        ) : (
          <div className="max-w-xl mx-auto text-center space-y-3 py-16">
            <p className="text-sm font-bold text-slate-800">هذه البطاقة غير موجودة أو حُذفت.</p>
            <button type="button" onClick={() => onFocus(null)} className="min-h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
              العودة إلى البطاقات
            </button>
          </div>
        )}
        {form}
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
            بطاقات الإنتاج
          </h1>
          <p className="text-xs text-slate-500 mt-1">بطاقة واحدة ترافق كل مادة بين المحطات: المطلوب، المسؤول عن كل مهمة، مواعيد التسليم والبث، وما اكتمل وما ينقص.</p>
        </div>
        {canManage && (
          <button
            type="button"
            data-tour="card-create"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold self-start"
          >
            <Plus className="w-4 h-4" />
            بطاقة جديدة
          </button>
        )}
      </div>

      {message && <p role="status" className="p-3 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">{message}</p>}

      <FilterTabs<Tab>
        label="بطاقات الإنتاج"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'MINE', label: 'مهامي', count: mySteps.filter((r) => !r.claimable).length, tone: 'blue' },
          { id: 'TODAY', label: 'متابعة اليوم', count: board.needDecision.length, tone: 'amber' },
          { id: 'ALL', label: 'كل البطاقات', count: openCards.length, tone: 'slate' },
        ]}
      />

      {tab === 'MINE' && (
        <section className="space-y-2" aria-label="مهامي">
          {mySteps.length === 0 && empty('لا مهام مفتوحة باسمك الآن. ما يُسند إليك في أي بطاقة يظهر هنا.')}
          <ul className="space-y-2">
            {mySteps.map(({ card, step, claimable }) => (
              <li key={`${card.id}:${step.id}`}>
                <button type="button" onClick={() => onFocus(card.id)} className={`w-full text-right bg-white border rounded-2xl p-3 sm:p-4 space-y-1.5 hover:border-blue-300 ${step.status === 'BLOCKED' ? 'border-rose-300' : card.priority === 'URGENT' ? 'border-red-300' : 'border-slate-200'}`}>
                  <span className="flex flex-wrap items-center gap-2 text-2xs">
                    <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 font-bold">{stepTypeName(stepTypes, step.type)}</span>
                    {claimable ? (
                      <span className="px-2 py-0.5 rounded-md border border-sky-200 bg-sky-50 text-sky-800 font-bold">متاحة لمحطتك — استلمها</span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-md border font-bold ${STEP_STATUS_STYLE[step.status]}`}>{stepStatusName(step.status)}</span>
                    )}
                    {isStepLate(step, now) && <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-bold">متأخرة</span>}
                    {card.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-bold">عاجل</span>}
                    {step.dueAt && <span className="text-slate-600 mr-auto">التسليم {when(step.dueAt)}</span>}
                  </span>
                  <span className="block text-sm font-bold text-slate-900">{card.title}</span>
                  {step.title && <span className="block text-xs text-slate-600">{step.title}</span>}
                  {currentStep(card)?.id !== step.id && <span className="block text-2xs text-slate-500">قبلها: {stepTypeName(stepTypes, currentStep(card)!.type)} ({currentStep(card)!.assigneeName || 'غير مسندة'})</span>}
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
                <dd className={`text-2xl font-bold tabular-nums ${stat.tone}`}>{stat.value}</dd>
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
                      السبب: {cardHoldReason(card, stepTypes, now) || 'تجاوزت موعد التسليم'}
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
            {board.airing.length === 0 ? empty('لا بطاقات بموعد بث اليوم.') : (
              <div role="region" tabIndex={0} aria-label="جدول ما يُبث اليوم (يمكن تمريره أفقياً)" className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[34rem] text-xs">
                  <thead>
                    <tr className="text-right text-slate-600 border-b border-slate-200">
                      <th scope="col" className="p-3 font-bold">البث</th>
                      <th scope="col" className="p-3 font-bold">المادة</th>
                      <th scope="col" className="p-3 font-bold">الحالة</th>
                      <th scope="col" className="p-3 font-bold">بانتظار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.airing.map((card) => {
                      const state = cardState(card, now);
                      const waiting = currentStep(card);
                      return (
                        <tr key={card.id} className="border-b border-slate-100 last:border-0">
                          <td className="p-3 font-bold tabular-nums whitespace-nowrap">{timeOnly(card.airAt)}</td>
                          <td className="p-3">
                            <button type="button" onClick={() => onFocus(card.id)} className="font-bold text-blue-700 hover:underline text-right">{card.title}</button>
                          </td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded-md border font-bold whitespace-nowrap ${CARD_STATE_STYLE[state]}`}>{CARD_STATE_NAMES[state]}</span></td>
                          <td className="p-3 text-slate-700">{waiting ? `${stepTypeName(stepTypes, waiting.type)} — ${waiting.assigneeName || 'غير مسندة'}` : '—'}</td>
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
        <section className="space-y-3" aria-label="كل البطاقات">
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" aria-label="بحث في البطاقات" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالعنوان أو الشخص…" className={`${SELECT} w-56 max-w-full`} />
            <select aria-label="الحالة" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as 'OPEN' | CardState)} className={SELECT}>
              <option value="OPEN">كل الجارية</option>
              {(Object.keys(CARD_STATE_NAMES) as CardState[]).map((s) => (
                <option key={s} value={s}>{CARD_STATE_NAMES[s]}</option>
              ))}
            </select>
            <select aria-label="المحطة" value={station} onChange={(e) => setStation(e.target.value)} className={SELECT}>
              <option value="ALL">كل المحطات</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select aria-label="نوع المادة" value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT}>
              <option value="ALL">كل الأنواع</option>
              {CARD_KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
          {filtered.length === 0 && empty(cards.length === 0 ? 'لا بطاقات بعد. تبدأ البطاقة من «بطاقة جديدة» وترافق المادة حتى البث.' : 'لا بطاقات تطابق التصفية.')}
          <ul className="space-y-2">{page.visible.map((card) => cardRow(card))}</ul>
          <ShowMore remaining={page.remaining} onMore={page.showMore} noun="بطاقة" />
        </section>
      )}

      {form}
    </div>
  );
};
