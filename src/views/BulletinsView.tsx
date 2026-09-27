import React, { useState } from 'react';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, LayoutTemplate, Plus, Radio, Trash2, Edit2, ArrowUp, ArrowDown, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { useLiveData } from '../hooks/useLiveData';
import { FormPage } from '../components/common/FormPage';
import { localDateString } from '../shared/dates';
import { departmentIdOf } from '../shared/departments';
import {
  Bulletin,
  BULLETIN_KINDS,
  BulletinFormat,
  BulletinKind,
  bulletinKindName,
  bulletinTiming,
  mmss,
  STORY_TYPES,
  StoryType,
} from '../shared/bulletins';

interface Props {
  currentUser: User;
  onOpenBulletin: (id: string) => void;
}

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d + days));
};

const dayLabel = (date: string) => {
  const today = localDateString();
  if (date === today) return 'اليوم';
  if (date === addDays(today, 1)) return 'غداً';
  if (date === addDays(today, -1)) return 'أمس';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
};

interface NewForm {
  title: string;
  kind: BulletinKind;
  date: string;
  startTime: string;
  minutes: string;
  editorId: string;
  anchors: string;
  studioName: string;
  start: 'BLANK' | 'FORMAT';
  formatId: string;
}

type FormatDraft = Omit<BulletinFormat, 'plannedSeconds' | 'anchors'> & { minutes: string; anchorsText: string };

const STATUS_TONE: Record<string, string> = {
  PLANNING: 'bg-slate-100 text-slate-600',
  ON_AIR: 'bg-red-600 text-white',
  DONE: 'bg-emerald-50 text-emerald-700',
};

export const BulletinsView: React.FC<Props> = ({ currentUser, onOpenBulletin }) => {
  useLiveData(['bulletins', 'bulletinStories', 'bulletinFormats', 'onAir']);
  const canManage = RbacService.hasPermission(currentUser, 'bulletins.manage');
  const [tab, setTab] = useState<'DAY' | 'FORMATS'>('DAY');
  const [date, setDate] = useState(localDateString());
  const [form, setForm] = useState<NewForm | null>(null);
  const [formatDraft, setFormatDraft] = useState<FormatDraft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMessage({ ok, text });
    window.setTimeout(() => setMessage(null), 5000);
  };

  const formats = apiService.getBulletinFormats();
  const bulletins = apiService
    .getBulletins()
    .filter((b) => b.date === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const missing = apiService.missingScheduledBulletins(date);
  const users = apiService.getUsers().filter((u) => u.isActive !== false);
  const editors = users.filter((u) => RbacService.hasPermission(u, 'bulletins.edit') || RbacService.hasPermission(u, 'bulletins.approve'));
  const presenters = users.filter((u) => departmentIdOf(u) === 'presenters');

  const openNew = () =>
    setForm({
      title: '',
      kind: 'MAIN',
      date,
      startTime: '20:00',
      minutes: '30',
      editorId: currentUser.id,
      anchors: presenters[0]?.fullName || '',
      studioName: '',
      start: formats.length ? 'FORMAT' : 'BLANK',
      formatId: formats[0]?.id || '',
    });

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const base: Partial<Bulletin> = {
      title: form.title.trim() || `${bulletinKindName(form.kind)} ${form.startTime}`,
      kind: form.kind,
      date: form.date,
      startTime: form.startTime,
      plannedSeconds: Math.round(Number(form.minutes) * 60),
      editorId: form.editorId || undefined,
      anchors: form.anchors.split(/[،,]/).map((x) => x.trim()).filter(Boolean),
      studioName: form.studioName.trim() || undefined,
    };
    try {
      const b = form.start === 'FORMAT' && form.formatId ? apiService.createBulletinFromFormat(form.formatId, form.date, { overrides: base }) : apiService.saveBulletin(base);
      setForm(null);
      onOpenBulletin(b.id);
    } catch (err: any) {
      flash(false, err?.message || 'تعذر إنشاء النشرة');
    }
  };

  const createScheduled = (f: BulletinFormat) => {
    try {
      apiService.createBulletinFromFormat(f.id, date, { scheduled: true });
      flash(true, `أُنشئت «${f.name}» (${f.startTime})`);
    } catch (err: any) {
      flash(false, err?.message || 'تعذر إنشاء النشرة');
    }
  };

  const pickFormatForForm = (id: string) => {
    const f = formats.find((x) => x.id === id);
    if (!f || !form) return;
    setForm({
      ...form,
      formatId: id,
      kind: f.kind,
      startTime: f.startTime,
      minutes: String(Math.round(f.plannedSeconds / 60)),
      editorId: f.editorId || form.editorId,
      anchors: (f.anchors || []).join('، ') || form.anchors,
      studioName: f.studioName || form.studioName,
      title: form.title || f.name,
    });
  };

  // --- Formats ---------------------------------------------------------------
  const editFormat = (f?: BulletinFormat) =>
    setFormatDraft(
      f
        ? { ...f, minutes: String(Math.round(f.plannedSeconds / 60)), anchorsText: (f.anchors || []).join('، ') }
        : { id: '', name: '', kind: 'MAIN', startTime: '20:00', minutes: '30', days: [], autoCreate: false, anchorsText: '', stories: [{ slug: 'العناوين', type: 'HEADLINES' }] }
    );

  const saveFormat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formatDraft) return;
    const { minutes, anchorsText, ...rest } = formatDraft;
    try {
      apiService.saveBulletinFormat({
        ...rest,
        id: rest.id || undefined,
        plannedSeconds: Math.round(Number(minutes) * 60),
        anchors: anchorsText.split(/[،,]/).map((x) => x.trim()).filter(Boolean),
        stories: rest.stories.filter((s) => s.slug.trim()),
      });
      setFormatDraft(null);
      flash(true, 'حُفظ القالب');
    } catch (err: any) {
      flash(false, err?.message || 'تعذر حفظ القالب');
    }
  };

  const setDraftStory = (i: number, patch: Partial<FormatDraft['stories'][number]>) =>
    formatDraft && setFormatDraft({ ...formatDraft, stories: formatDraft.stories.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveDraftStory = (i: number, dir: -1 | 1) => {
    if (!formatDraft) return;
    const j = i + dir;
    if (j < 0 || j >= formatDraft.stories.length) return;
    const next = [...formatDraft.stories];
    [next[i], next[j]] = [next[j], next[i]];
    setFormatDraft({ ...formatDraft, stories: next });
  };

  const onAirIds = new Set(apiService.getOnAirStates().filter((s) => s.status === 'LIVE').map((s) => s.episodeId));

  return (
    <div className="space-y-5" data-testid="bulletins-view">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
            <Radio className="w-6 h-6 text-red-600" /> النشرات الإخبارية
          </h1>
          <p className="text-xs text-slate-500 mt-1">رانداون النشرة، قصصها وتوقيتها واعتمادها قبل الهواء.</p>
        </div>
        {canManage && tab === 'DAY' && (
          <button type="button" onClick={openNew} className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold">
            <Plus className="w-4 h-4" /> نشرة جديدة
          </button>
        )}
        {canManage && tab === 'FORMATS' && (
          <button type="button" onClick={() => editFormat()} className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold">
            <Plus className="w-4 h-4" /> قالب جديد
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-2 text-xs font-bold" role="tablist">
        {[
          { id: 'DAY' as const, label: 'نشرات اليوم', icon: CalendarDays },
          { id: 'FORMATS' as const, label: `القوالب والجدولة (${formats.length})`, icon: LayoutTemplate },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl ${tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {message && (
        <p role="status" className={`text-xs font-bold rounded-xl p-2.5 border ${message.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
          {message.text}
        </p>
      )}

      {tab === 'DAY' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="اليوم السابق" className="p-2 rounded-lg border border-slate-200 bg-white">
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-slate-800 min-w-[8rem] text-center">{dayLabel(date)}</span>
            <button type="button" onClick={() => setDate(addDays(date, 1))} aria-label="اليوم التالي" className="p-2 rounded-lg border border-slate-200 bg-white">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input type="date" aria-label="التاريخ" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white" />
            {date !== localDateString() && (
              <button type="button" onClick={() => setDate(localDateString())} className="text-xs font-bold text-blue-700 hover:underline">
                العودة لليوم
              </button>
            )}
          </div>

          {canManage && missing.length > 0 && (
            <section aria-label="نشرات مجدولة" className="p-3 rounded-2xl border border-amber-200 bg-amber-50/60 space-y-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4" /> نشرات مجدولة لهذا اليوم لم تُنشأ بعد ({missing.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {missing.map((f) => (
                  <button key={f.id} type="button" onClick={() => createScheduled(f)} className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-bold text-amber-900 hover:bg-amber-100">
                    + {f.name} ({f.startTime})
                  </button>
                ))}
              </div>
            </section>
          )}

          {bulletins.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
              لا نشرات في {dayLabel(date)}.{canManage ? ' أنشئ نشرة جديدة أو من قالب.' : ''}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {bulletins.map((b) => {
                const stories = apiService.getBulletinStories(b.id);
                const timing = bulletinTiming(b, stories);
                const live = stories.filter((s) => !s.floated && !s.killed);
                const approved = live.filter((s) => s.status === 'APPROVED').length;
                const ready = live.filter((s) => s.status === 'READY').length;
                const isLive = onAirIds.has(b.id);
                const status = isLive ? 'ON_AIR' : b.status;
                const off = Math.abs(timing.overUnder) > 30;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onOpenBulletin(b.id)}
                    aria-label={`فتح ${b.title}`}
                    className="text-right bg-white p-4 rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-black font-mono text-slate-800" dir="ltr">
                            {b.startTime}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{bulletinKindName(b.kind)}</span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-800 mt-1 truncate">{b.title}</h3>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_TONE[status]}`}>
                        {status === 'ON_AIR' ? 'على الهواء' : status === 'DONE' ? 'أُذيعت' : 'قيد الإعداد'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 space-y-0.5">
                      <p>المحرر: <strong className="text-slate-700">{b.editorName || '—'}</strong></p>
                      <p>التقديم: <strong className="text-slate-700">{b.anchors.join('، ') || '—'}</strong></p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-bold text-slate-700">{live.length} قصة</span>
                      <span className="text-emerald-700 font-bold">{approved} معتمدة</span>
                      {ready > 0 && <span className="text-amber-700 font-bold">{ready} بانتظار الاعتماد</span>}
                      <span className={`font-mono font-bold mr-auto ${off ? (timing.overUnder > 0 ? 'text-rose-700' : 'text-amber-700') : 'text-emerald-700'}`} dir="ltr">
                        {timing.overUnder > 0 ? '+' : ''}
                        {mmss(timing.overUnder)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
                      <div className="h-full bg-emerald-500" style={{ width: `${live.length ? (approved / live.length) * 100 : 0}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'FORMATS' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            القالب يحدد بنية النشرة (القصص الثابتة ومددها). حدد أيام البث ليظهر كنشرة مجدولة يُنشئها الديسك بضغطة، أو فعّل «الإنشاء التلقائي» ليُنشئها النظام كل يوم.
          </p>
          {formats.length === 0 && <div className="bg-white p-10 text-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">لا قوالب بعد.</div>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {formats.map((f) => (
              <article key={f.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{f.name}</h3>
                    <p className="text-[11px] text-slate-500">
                      {bulletinKindName(f.kind)} · <span dir="ltr">{f.startTime}</span> · {Math.round(f.plannedSeconds / 60)} دقيقة · {f.stories.length} قصة
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => editFormat(f)} aria-label={`تعديل ${f.name}`} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => window.confirm(`حذف القالب «${f.name}»؟ لن تتأثر النشرات التي أُنشئت منه.`) && apiService.deleteBulletinFormat(f.id)}
                        aria-label={`حذف ${f.name}`}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {f.days.length === 0 ? (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">قالب فقط (غير مجدول)</span>
                  ) : (
                    DAY_NAMES.map((d, i) => (
                      <span key={d} className={`text-[10px] px-1.5 py-0.5 rounded ${f.days.includes(i) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {d}
                      </span>
                    ))
                  )}
                  {f.autoCreate && <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">إنشاء تلقائي</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* New bulletin */}
      <FormPage isOpen={!!form} onClose={() => setForm(null)} title="نشرة جديدة" subtitle="حدد الموعد والمحرر المسؤول والمذيعين" maxWidth="2xl">
        {form && (
          <form onSubmit={submitNew} className="space-y-4">
            <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2">
              <legend className="px-1 text-xs font-bold text-slate-700">البداية</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {[
                  { id: 'FORMAT' as const, name: 'من قالب', hint: formats.length ? 'القصص الثابتة والمدد جاهزة' : 'لا قوالب بعد', disabled: !formats.length },
                  { id: 'BLANK' as const, name: 'نشرة فارغة', hint: 'تبني القصص بنفسك', disabled: false },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={form.start === o.id}
                    disabled={o.disabled}
                    onClick={() => {
                      setForm({ ...form, start: o.id });
                      if (o.id === 'FORMAT' && form.formatId) pickFormatForForm(form.formatId);
                    }}
                    className={`p-2.5 rounded-xl border text-right disabled:opacity-50 ${form.start === o.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}
                  >
                    <span className="block text-xs font-bold">{o.name}</span>
                    <span className={`block text-[10px] ${form.start === o.id ? 'text-blue-100' : 'text-slate-500'}`}>{o.hint}</span>
                  </button>
                ))}
              </div>
              {form.start === 'FORMAT' && (
                <select aria-label="القالب" value={form.formatId} onChange={(e) => pickFormatForForm(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white">
                  {formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.stories.length} قصة)
                    </option>
                  ))}
                </select>
              )}
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                عنوان النشرة
                <input id="bulletin-title" data-autofocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثال: نشرة الثامنة" className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                النوع
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BulletinKind })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
                  {BULLETIN_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                التاريخ
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                موعد البث
                <input id="bulletin-time" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المدة (دقائق)
                <input type="number" min={1} max={360} required value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                محرر النشرة المسؤول (يعتمد القصص)
                <select id="bulletin-editor" value={form.editorId} onChange={(e) => setForm({ ...form, editorId: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
                  <option value="">— بدون —</option>
                  {editors.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المذيعون (افصل بفاصلة)
                <input list="bulletin-presenters" value={form.anchors} onChange={(e) => setForm({ ...form, anchors: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
                <datalist id="bulletin-presenters">
                  {presenters.map((u) => (
                    <option key={u.id} value={u.fullName} />
                  ))}
                </datalist>
              </label>
            </div>
            <label className="block text-xs font-bold text-slate-700">
              الاستوديو
              <input value={form.studioName} onChange={(e) => setForm({ ...form, studioName: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
            </label>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setForm(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
                إلغاء
              </button>
              <button type="submit" className="px-5 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl">
                إنشاء وفتح الرانداون
              </button>
            </div>
          </form>
        )}
      </FormPage>

      {/* Format editor */}
      <FormPage isOpen={!!formatDraft} onClose={() => setFormatDraft(null)} title={formatDraft?.id ? 'تعديل القالب' : 'قالب نشرة جديد'} maxWidth="3xl">
        {formatDraft && (
          <form onSubmit={saveFormat} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="sm:col-span-2 block text-xs font-bold text-slate-700">
                اسم القالب *
                <input data-autofocus required value={formatDraft.name} onChange={(e) => setFormatDraft({ ...formatDraft, name: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                الموعد
                <input type="time" required value={formatDraft.startTime} onChange={(e) => setFormatDraft({ ...formatDraft, startTime: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المدة (دقائق)
                <input type="number" min={1} required value={formatDraft.minutes} onChange={(e) => setFormatDraft({ ...formatDraft, minutes: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                النوع
                <select value={formatDraft.kind} onChange={(e) => setFormatDraft({ ...formatDraft, kind: e.target.value as BulletinKind })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
                  {BULLETIN_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المحرر الافتراضي
                <select value={formatDraft.editorId || ''} onChange={(e) => setFormatDraft({ ...formatDraft, editorId: e.target.value || undefined })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
                  <option value="">— بدون —</option>
                  {editors.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                المذيعون
                <input list="bulletin-presenters" value={formatDraft.anchorsText} onChange={(e) => setFormatDraft({ ...formatDraft, anchorsText: e.target.value })} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </label>
            </div>
            <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2">
              <legend className="px-1 text-xs font-bold text-slate-700">الجدولة (اختيارية)</legend>
              <div className="flex flex-wrap gap-1.5">
                {DAY_NAMES.map((d, i) => {
                  const on = formatDraft.days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFormatDraft({ ...formatDraft, days: on ? formatDraft.days.filter((x) => x !== i) : [...formatDraft.days, i].sort() })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={formatDraft.autoCreate} disabled={!formatDraft.days.length} onChange={(e) => setFormatDraft({ ...formatDraft, autoCreate: e.target.checked })} />
                إنشاء النشرة تلقائياً في أيامها (وإلا تظهر للديسك لإنشائها بضغطة)
              </label>
            </fieldset>
            <fieldset className="p-3 rounded-xl border border-slate-200 space-y-2">
              <legend className="px-1 text-xs font-bold text-slate-700">القصص الثابتة ({formatDraft.stories.length})</legend>
              {formatDraft.stories.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-400 w-5">{i + 1}</span>
                  <input aria-label={`عنوان القصة ${i + 1}`} value={s.slug} onChange={(e) => setDraftStory(i, { slug: e.target.value })} className="flex-1 min-w-[8rem] px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs" />
                  <select aria-label={`نوع القصة ${i + 1}`} value={s.type} onChange={(e) => setDraftStory(i, { type: e.target.value as StoryType })} className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white">
                    {STORY_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </select>
                  {STORY_TYPES.find((t) => t.id === s.type)?.manual && (
                    <input
                      aria-label={`مدة القصة ${i + 1} بالثواني`}
                      type="number"
                      min={0}
                      placeholder="ث"
                      value={s.manualSeconds ?? ''}
                      onChange={(e) => setDraftStory(i, { manualSeconds: e.target.value ? Number(e.target.value) : undefined })}
                      className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-xs"
                    />
                  )}
                  <button type="button" onClick={() => moveDraftStory(i, -1)} aria-label="تقديم" className="p-1 text-slate-400">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveDraftStory(i, 1)} aria-label="تأخير" className="p-1 text-slate-400">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => setFormatDraft({ ...formatDraft, stories: formatDraft.stories.filter((_, j) => j !== i) })} aria-label="حذف" className="p-1 text-rose-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setFormatDraft({ ...formatDraft, stories: [...formatDraft.stories, { slug: '', type: 'READER' }] })} className="text-xs font-bold text-blue-700 hover:underline">
                + قصة
              </button>
            </fieldset>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setFormatDraft(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
                إلغاء
              </button>
              <button type="submit" className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl">
                حفظ القالب
              </button>
            </div>
          </form>
        )}
      </FormPage>
    </div>
  );
};
