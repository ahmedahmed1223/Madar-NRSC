import { AR, countLabel } from '../shared/arabicPlural';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { confirmDialog } from '../services/dialogs';
import { GlossaryDatalist } from '../components/editor/WritingAids';
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, FilePlus2, Flag, MapPin, Plus, Search, Trash2, Users as UsersIcon } from 'lucide-react';
import type { Category, NewsDraftSeed, NewsItem, Story, User } from '../types';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { notify, tryAction } from '../services/notify';
import { useLiveData } from '../hooks/useLiveData';
import { confirmSaved } from '../services/confirmSave';
import { FormPage } from '../components/common/FormPage';
import { BookingForm } from '../components/planning/BookingForm';
import { arabicDate, localDateString } from '../shared/dates';
import { matchesQuery } from '../shared/search';
import { Booking, COVERAGE_DECISIONS, coverageOf, DiaryEntry, DIARY_KINDS, diaryKindName, shiftDay, sortDiary, weekDays } from '../shared/planning';

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const dayName = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
};
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' });

interface DiaryViewProps {
  currentUser: User;
  users: User[];
  categories: Category[];
  stories: Story[];
  newsList: NewsItem[];
  focusId?: string | null;
  onCreateNews: (seed: NewsDraftSeed) => void;
  onOpenNews: (id: string) => void;
}

/** News planning diary: what is coming up, whether we cover it, and who goes. */
export const DiaryView: React.FC<DiaryViewProps> = ({ currentUser, users, categories, stories, newsList, focusId, onCreateNews, onOpenNews }) => {
  useLiveData(['diary', 'bookings', 'resources']);
  const canManage = RbacService.hasPermission(currentUser, 'diary.manage');
  const entries = apiService.getDiary();
  const focused = focusId ? entries.find((e) => e.id === focusId) : undefined;
  const [anchor, setAnchor] = useState(() => focused?.date || localDateString());
  const [mobileDay, setMobileDay] = useState<string | null>(focused?.date || null);
  const [query, setQuery] = useState('');
  const [coverage, setCoverage] = useState('ALL');
  const [onlyMine, setOnlyMine] = useState(false);
  const [editing, setEditing] = useState<Partial<DiaryEntry> | null>(focused || null);
  const [booking, setBooking] = useState<Partial<Booking> | null>(null);
  const today = localDateString();
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const currentDay = mobileDay === 'ALL' || (mobileDay && days.includes(mobileDay))
    ? mobileDay
    : days.includes(today) ? today : days[0];
  const hasFilters = Boolean(query.trim()) || coverage !== 'ALL' || onlyMine;
  const navigateWeek = (date: string) => { setAnchor(date); setMobileDay(hasFilters ? 'ALL' : null); };

  useEffect(() => {
    if (focused) {
      setAnchor(focused.date);
      setMobileDay(focused.date);
      setEditing(focused);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const visible = sortDiary(
    entries.filter(
      (e) =>
        days.includes(e.date) &&
        (coverage === 'ALL' || e.coverage === coverage) &&
        (!onlyMine || e.assigneeIds.includes(currentUser.id)) &&
        matchesQuery(query, e.title, e.location, e.notes, e.assigneeIds.map((id) => users.find((u) => u.id === id)?.fullName))
    )
  );
  const undecided = entries.filter((e) => e.date >= today && e.coverage === 'UNDECIDED').length;
  const userName = (id: string) => users.find((u) => u.id === id)?.fullName || 'زميل';

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-600" />
            أجندة التغطية
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            الأحداث المتوقعة وقرار تغطيتها ومن يغطيها؛ يصل المكلفين تنبيه، ويُكتب الخبر من الحدث مباشرة.
          </p>
          {undecided > 0 && (
            <button type="button" onClick={() => {
                const first = entries.filter((e) => e.date >= today && e.coverage === 'UNDECIDED').map((e) => e.date).sort()[0];
                if (first) {
                  setAnchor(first);
                  setMobileDay(first);
                }
                setCoverage('UNDECIDED');
              }} className="mt-1.5 min-h-9 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold hover:bg-amber-100">
              {countLabel(undecided, { one: 'حدث قادم', two: 'حدثان قادمان', few: 'أحداث قادمة', many: 'حدثاً قادماً' })} بلا قرار تغطية
            </button>
          )}
        </div>
        <div role="group" aria-label="أسبوع التغطية" className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:flex sm:flex-wrap items-center gap-2 lg:shrink-0">
          <button type="button" onClick={() => navigateWeek(shiftDay(anchor, -7))} className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="الأسبوع السابق">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="grid justify-items-center sm:flex sm:gap-1 text-xs font-bold text-slate-700" aria-live="polite">
            <time dateTime={days[0]}>{arabicDate(days[0])}</time>
            <span className="sr-only sm:not-sr-only">إلى</span>
            <time dateTime={days[6]}>{arabicDate(days[6])}</time>
          </span>
          <button type="button" onClick={() => navigateWeek(shiftDay(anchor, 7))} className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="الأسبوع التالي">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="col-span-full flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => navigateWeek(today)} className="min-h-11 sm:min-h-9 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold whitespace-nowrap">
              هذا الأسبوع
            </button>
            {canManage && (
              <button type="button" onClick={() => setEditing({ date: currentDay === 'ALL' ? (days.includes(today) ? today : days[0]) : currentDay })} className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs whitespace-nowrap">
                <Plus className="w-4 h-4" /> حدث جديد
              </button>
            )}
          </div>
        </div>
      </div>

      <div role="group" aria-label="تصفية أجندة التغطية" className="bg-white p-3 rounded-xl border border-slate-200 grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
        <div className="relative min-w-0 col-span-full lg:col-span-1">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setMobileDay('ALL'); }} placeholder="ابحث في أحداث الأسبوع..." aria-label="بحث في الأجندة" className="w-full min-h-11 pr-9 pl-3 border border-slate-300 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-blue-500" />
        </div>
        <select value={coverage} onChange={(e) => { setCoverage(e.target.value); setMobileDay('ALL'); }} aria-label="قرار التغطية" className="min-h-11 min-w-0 px-2 border border-slate-300 rounded-lg text-sm bg-white">
          <option value="ALL">كل القرارات</option>
          {COVERAGE_DECISIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 min-h-11 px-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={onlyMine} onChange={(e) => { setOnlyMine(e.target.checked); setMobileDay('ALL'); }} className="accent-blue-600" />
          تكليفاتي فقط
        </label>
      </div>

      <div className="grid gap-1 sm:hidden">
        <label htmlFor="diary-day" className="text-xs font-semibold text-slate-700">اليوم المعروض</label>
        <select id="diary-day" value={currentDay} onChange={(e) => setMobileDay(e.target.value)} className="min-h-11 min-w-0 px-3 rounded-lg border border-slate-300 bg-white text-sm">
          <option value="ALL">كل أيام الأسبوع</option>
          {days.map((day) => <option key={day} value={day}>{dayName(day)} {arabicDate(day)}{day === today ? ' (اليوم)' : ''}</option>)}
        </select>
      </div>

      {hasFilters && currentDay === 'ALL' && visible.length === 0 && (
        <p role="status" className="sm:hidden rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-700">
          لا أحداث في هذا الأسبوع تطابق الفلاتر.
        </p>
      )}
      <div role="group" aria-label="أحداث الأسبوع" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => {
          const list = visible.filter((e) => e.date === day);
          const hiddenOnPhone = currentDay === 'ALL' ? hasFilters && list.length === 0 : currentDay !== day;
          return (
            <section key={day} aria-label={`${dayName(day)} ${arabicDate(day)}`} className={`min-w-0 rounded-xl border p-2.5 space-y-2 md:min-h-[8rem] ${day === today ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'} ${hiddenOnPhone ? 'hidden sm:block' : ''}`}>
              <header className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-800">
                  {dayName(day)}
                  {day === today && <span className="ms-1 text-2xs text-blue-700">(اليوم)</span>}
                  <span className={`font-normal text-2xs text-slate-500 ${list.length ? 'block' : 'ms-1.5 md:ms-0 md:block'}`}>
                    {arabicDate(day)}
                    {list.length === 0 && <span className="md:hidden"> · لا أحداث</span>}
                  </span>
                </p>
                {canManage && (
                  <button type="button" onClick={() => setEditing({ date: day })} aria-label={`إضافة حدث ${arabicDate(day)}`} className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600">
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </header>
              {list.length === 0 && <p className="hidden md:block text-2xs text-slate-500">لا أحداث</p>}
              {list.map((e) => {
                const cov = coverageOf(e.coverage);
                const produced = newsList.filter((n) => n.diaryId === e.id && !n.deletedAt).length;
                return (
                  <button key={e.id} type="button" onClick={() => setEditing(e)} className={`w-full text-right p-2 rounded-xl border bg-white hover:shadow-sm space-y-1 ${focusId === e.id ? 'ring-2 ring-blue-500' : 'border-slate-200'}`}>
                    <p className="text-xs font-bold text-slate-900 leading-snug [overflow-wrap:anywhere]">
                      {e.priority === 'HIGH' && <Flag className="w-3 h-3 text-red-600 inline ms-0.5" aria-label="أولوية عالية" />} {e.title}
                    </p>
                    <p className="text-2xs text-slate-500">
                      {e.startTime ? <span dir="ltr" className="inline-block tabular-nums">{e.startTime}{e.endTime ? ` – ${e.endTime}` : ''}</span> : 'طوال اليوم'} · {diaryKindName(e.kind)}
                    </p>
                    {e.location && (
                      <p className="text-2xs text-slate-500 flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" /> {e.location}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`text-2xs font-bold px-1.5 py-0.5 rounded border ${cov.tone}`}>{cov.name}</span>
                      {e.assigneeIds.length > 0 && (
                        <span className="text-2xs text-slate-600 flex items-center gap-0.5" title={e.assigneeIds.map(userName).join('، ')}>
                          <UsersIcon className="w-3 h-3" /> {e.assigneeIds.length === 1 ? userName(e.assigneeIds[0]) : countLabel(e.assigneeIds.length, { one: 'مكلف واحد', two: 'مكلفان', few: 'مكلفين', many: 'مكلفاً' })}
                        </span>
                      )}
                      {produced > 0 && <span className="text-2xs text-emerald-700 font-bold">{countLabel(produced, AR.news)}</span>}
                    </div>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>

      {editing && (
        <DiaryEntryPage
          entry={editing}
          onClose={() => setEditing(null)}
          currentUser={currentUser}
          users={users}
          categories={categories}
          stories={stories}
          newsList={newsList}
          canManage={canManage}
          onCreateNews={onCreateNews}
          onOpenNews={onOpenNews}
          onBook={(b) => {
            setEditing(null);
            setBooking(b);
          }}
        />
      )}
      {booking && (
        <BookingForm
          isOpen
          onClose={() => setBooking(null)}
          currentUser={currentUser}
          users={users}
          booking={booking}
          onSaved={() => notify({ type: 'info', message: 'رُبط الحجز بالحدث' })}
        />
      )}
    </div>
  );
};

const DiaryEntryPage: React.FC<{
  entry: Partial<DiaryEntry>;
  onClose: () => void;
  currentUser: User;
  users: User[];
  categories: Category[];
  stories: Story[];
  newsList: NewsItem[];
  canManage: boolean;
  onCreateNews: (seed: NewsDraftSeed) => void;
  onOpenNews: (id: string) => void;
  onBook: (b: Partial<Booking>) => void;
}> = ({ entry, onClose, currentUser, users, categories, stories, newsList, canManage, onCreateNews, onOpenNews, onBook }) => {
  const [draft, setDraft] = useState<Partial<DiaryEntry>>({ kind: 'EVENT', coverage: 'UNDECIDED', priority: 'NORMAL', assigneeIds: [], ...entry });
  const isAssigned = !!entry.id && (entry.assigneeIds || []).includes(currentUser.id);
  const readOnly = !canManage;
  const set = (patch: Partial<DiaryEntry>) => setDraft((d) => ({ ...d, ...patch }));
  const produced = entry.id ? newsList.filter((n) => n.diaryId === entry.id && !n.deletedAt) : [];
  const bookings = entry.id ? apiService.getBookings().filter((b) => b.link?.kind === 'diary' && b.link.id === entry.id && b.status !== 'CANCELLED') : [];
  const resName = (id: string) => apiService.getResources().find((r) => r.id === id)?.name || 'مورد';
  const active = users.filter((u) => u.isActive !== false);

  const [saving, setSaving] = useState(false);
  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    const payload = {
      ...draft,
      title: (draft.title || '').trim(),
      location: draft.location?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      startTime: draft.startTime || undefined,
      endTime: draft.startTime ? draft.endTime || undefined : undefined,
    };
    let saved: DiaryEntry | null = null;
    if (!tryAction('حفظ الحدث', () => (saved = apiService.saveDiaryEntry(payload)))) return;
    setSaving(true);
    // Close only once the server has stored it; otherwise the form keeps what was typed.
    const ok = await confirmSaved('diary', saved!.id, entry.id ? 'حُفظ الحدث' : 'أُضيف الحدث إلى الأجندة');
    setSaving(false);
    if (ok) onClose();
  };

  const writeNews = () => {
    if (!entry.id) return;
    onCreateNews({
      diaryId: entry.id,
      title: entry.title || '',
      summary: '',
      content: '',
      storyId: entry.storyId,
      categoryId: entry.categoryId,
      locationName: entry.location,
      internalNotes: `من أجندة التغطية: ${entry.title} (${arabicDate(entry.date || '')}${entry.startTime ? ` ${entry.startTime}` : ''})${entry.notes ? `\n${entry.notes}` : ''}`,
    });
  };

  const startIso = () => {
    const [y, m, d] = (draft.date || localDateString()).split('-').map(Number);
    const [hh, mm] = (draft.startTime || '09:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm).toISOString();
  };

  const field = 'mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-600';

  return (
    <FormPage isOpen onClose={onClose} title={entry.id ? entry.title || 'حدث' : 'حدث جديد في الأجندة'} subtitle={entry.id ? `أضافه ${entry.createdByName || ''}` : 'حدث متوقع يحتاج قرار تغطية'}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-xs font-bold text-slate-700 sm:col-span-2">
            العنوان
            <input value={draft.title || ''} onChange={(e) => set({ title: e.target.value })} required maxLength={300} disabled={readOnly} className={field} />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            اليوم
            <input type="date" value={draft.date || ''} onChange={(e) => set({ date: e.target.value })} required disabled={readOnly} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-slate-700">
              من (اختياري)
              <input type="time" value={draft.startTime || ''} onChange={(e) => set({ startTime: e.target.value })} disabled={readOnly} className={field} />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              إلى
              <input type="time" value={draft.endTime || ''} onChange={(e) => set({ endTime: e.target.value })} disabled={readOnly || !draft.startTime} className={field} />
            </label>
          </div>
          <label className="block text-xs font-bold text-slate-700">
            النوع
            <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as DiaryEntry['kind'] })} disabled={readOnly} className={field}>
              {DIARY_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            المكان
            <input list="newsroom-glossary" value={draft.location || ''} onChange={(e) => set({ location: e.target.value })} maxLength={200} disabled={readOnly} className={field} />
            <GlossaryDatalist id="newsroom-glossary" />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            قرار التغطية
            <select value={draft.coverage} onChange={(e) => set({ coverage: e.target.value as DiaryEntry['coverage'] })} disabled={readOnly} className={field}>
              {COVERAGE_DECISIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pt-5">
            <input type="checkbox" checked={draft.priority === 'HIGH'} onChange={(e) => set({ priority: e.target.checked ? 'HIGH' : 'NORMAL' })} disabled={readOnly} className="accent-red-600 w-4 h-4" />
            أولوية عالية
          </label>
          <label className="block text-xs font-bold text-slate-700">
            القسم
            <select value={draft.categoryId || ''} onChange={(e) => set({ categoryId: e.target.value || undefined })} disabled={readOnly} className={field}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            ضمن تغطية
            <select value={draft.storyId || ''} onChange={(e) => set({ storyId: e.target.value || undefined })} disabled={readOnly} className={field}>
              <option value="">—</option>
              {stories
                .filter((s) => s.status === 'ACTIVE')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-slate-700">المكلفون بالتغطية</legend>
          <div className="flex flex-wrap gap-1.5">
            {(draft.assigneeIds || []).map((id) => (
              <span key={id} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-lg px-2 py-1">
                {users.find((u) => u.id === id)?.fullName || 'زميل'}
                {!readOnly && (
                  <button type="button" aria-label="إزالة" onClick={() => set({ assigneeIds: (draft.assigneeIds || []).filter((x) => x !== id) })}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {!(draft.assigneeIds || []).length && <span className="text-2xs text-slate-500">لا أحد بعد</span>}
          </div>
          {!readOnly && (
            <select
              value=""
              aria-label="إضافة مكلف"
              onChange={(e) => e.target.value && set({ assigneeIds: [...(draft.assigneeIds || []), e.target.value] })}
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">+ إضافة مكلف...</option>
              {active
                .filter((u) => !(draft.assigneeIds || []).includes(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} — {u.department}
                  </option>
                ))}
            </select>
          )}
        </fieldset>

        <label className="block text-xs font-bold text-slate-700">
          ملاحظات التخطيط {isAssigned && !canManage && <span className="font-normal text-slate-500">(يمكنك تحديثها)</span>}
          <textarea value={draft.notes || ''} onChange={(e) => set({ notes: e.target.value })} rows={4} maxLength={5000} disabled={readOnly && !isAssigned} className={field} />
        </label>

        {entry.id && (
          <section className="grid sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-slate-200 space-y-2">
              <p className="text-xs font-bold text-slate-700">الأخبار المكتوبة من الحدث</p>
              {produced.length === 0 && <p className="text-2xs text-slate-500">لا شيء بعد</p>}
              {produced.map((n) => (
                <button key={n.id} type="button" onClick={() => onOpenNews(n.id)} className="block text-right text-xs text-blue-700 hover:underline">
                  {n.title}
                </button>
              ))}
              {RbacService.hasPermission(currentUser, 'news.create') && (
                <button type="button" onClick={writeNews} className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white">
                  <FilePlus2 className="w-3.5 h-3.5" /> كتابة خبر من الحدث
                </button>
              )}
            </div>
            <div className="p-3 rounded-xl border border-slate-200 space-y-2">
              <p className="text-xs font-bold text-slate-700">المعدات والطواقم المحجوزة</p>
              {bookings.length === 0 && <p className="text-2xs text-slate-500">لا حجوزات</p>}
              {bookings.map((b) => (
                <p key={b.id} className="text-xs text-slate-700">
                  {resName(b.resourceId)} — {fmtTime(b.start)}–{fmtTime(b.end)}
                </p>
              ))}
              {(RbacService.hasPermission(currentUser, 'resources.book') || RbacService.hasPermission(currentUser, 'resources.manage')) && (
                <button
                  type="button"
                  onClick={() =>
                    onBook({
                      title: entry.title,
                      start: startIso(),
                      end: new Date(Date.parse(startIso()) + 3 * 3600_000).toISOString(),
                      assigneeId: entry.assigneeIds?.[0],
                      link: { kind: 'diary', id: entry.id!, title: entry.title || '' },
                    })
                  }
                  className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"
                >
                  <CalendarPlus className="w-3.5 h-3.5" /> حجز كاميرا / طاقم / وحدة بث
                </button>
              )}
            </div>
          </section>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {canManage && entry.id && (
              <button
                type="button"
                onClick={async () => {
                  if ((await confirmDialog('حذف الحدث من الأجندة؟')) && tryAction('حذف الحدث', () => apiService.deleteDiaryEntry(entry.id!), 'حُذف الحدث')) onClose();
                }}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> حذف
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold">
              {readOnly && !isAssigned ? 'إغلاق' : 'إلغاء'}
            </button>
            {(canManage || isAssigned) && (
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold">
                {saving ? 'جارٍ الحفظ…' : 'حفظ'}
              </button>
            )}
          </div>
        </div>
      </form>
    </FormPage>
  );
};

export default DiaryView;
