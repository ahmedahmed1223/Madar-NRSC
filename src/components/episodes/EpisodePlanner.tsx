import React, { useMemo, useState } from 'react';
import { Save, ArrowDown, ArrowUp, ChevronDown, ChevronUp, Edit2, Film, Layers, Lightbulb, Mic, Newspaper, Plus, Sparkles, Trash2, Tv, Users, Clock, Volume2 } from 'lucide-react';
import type { Episode, Guest, NewsItem, RundownSegment, RundownSegmentType, User } from '../../types';
import { apiService, formatSecondsToTime } from '../../services/api';
import { newId } from '../../shared/ids';
import { recalculateRundown } from '../../shared/rundown';
import { segmentReadiness, requestStatusName } from '../../shared/production';
import {
  arrangeByTopics,
  bookingStatusName,
  bookingStatusOf,
  EpisodeBrief,
  EpisodeTopic,
  groupByTopic,
  guestKey,
  insertIntoTopic,
  reportSourceOf,
  segmentGuests,
  segmentQuestions,
  sumSeconds,
  TALK_SEGMENT_TYPES,
} from '../../shared/episodePlan';
import { FormPage } from '../common/FormPage';
import { SegmentModal } from '../rundown/SegmentModal';
import { DropEvent, moveInArray, SortableItem, SortableList, SortableScope } from '../dnd/Sortable';
import { notify } from '../../services/notify';
import { RbacService } from '../../services/rbacService';
import { templateFromEpisode } from '../../shared/episodePlan';

interface EpisodePlannerProps {
  episode: Episode;
  allGuests: Guest[];
  allNews: NewsItem[];
  currentUser: User;
  canEditEpisode: boolean;
  canEditRundown: boolean;
  onSaveEpisode: (data: Partial<Episode>) => void;
  onUpdateRundown: (segments: RundownSegment[]) => void;
  onOpenNews?: (id: string) => void;
}

const TYPE_META: Record<string, { label: string; icon: any; tone: string }> = {
  INTRO: { label: 'مقدمة', icon: Sparkles, tone: 'text-amber-700 bg-amber-50' },
  REPORT: { label: 'تقرير مصور', icon: Film, tone: 'text-blue-700 bg-blue-50' },
  NEWS_ITEM: { label: 'خبر', icon: Tv, tone: 'text-indigo-700 bg-indigo-50' },
  LIVE_INTERVIEW: { label: 'مقابلة', icon: Mic, tone: 'text-purple-700 bg-purple-50' },
  DISCUSSION: { label: 'نقاش', icon: Users, tone: 'text-emerald-700 bg-emerald-50' },
  BREAK: { label: 'فاصل', icon: Clock, tone: 'text-slate-600 bg-slate-100' },
  OUTRO: { label: 'ختام', icon: Volume2, tone: 'text-rose-700 bg-rose-50' },
};

const QUICK_ADD: { type: RundownSegmentType; label: string }[] = [
  { type: 'REPORT', label: 'تقرير' },
  { type: 'LIVE_INTERVIEW', label: 'مقابلة' },
  { type: 'DISCUSSION', label: 'نقاش' },
  { type: 'NEWS_ITEM', label: 'خبر' },
  { type: 'BREAK', label: 'فاصل' },
];

const BOOKING_TONE: Record<string, string> = {
  CANDIDATE: 'bg-slate-100 text-slate-600 border-slate-200',
  CONTACTED: 'bg-amber-50 text-amber-800 border-amber-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DECLINED: 'bg-rose-50 text-rose-700 border-rose-200',
  ARRIVED: 'bg-blue-50 text-blue-700 border-blue-200',
};

const BRIEF_FIELDS: { key: keyof EpisodeBrief; label: string; placeholder: string; rows: number }[] = [
  { key: 'idea', label: 'فكرة الحلقة', placeholder: 'ما القصة التي تطرحها الحلقة ولماذا الآن؟', rows: 2 },
  { key: 'angle', label: 'الزاوية', placeholder: 'من أي زاوية نتناول الموضوع؟ ما الجديد لدينا؟', rows: 2 },
  { key: 'message', label: 'الرسالة الأساسية', placeholder: 'ما الذي يجب أن يخرج به المشاهد؟', rows: 2 },
  { key: 'audience', label: 'الجمهور المستهدف', placeholder: 'مثال: المهتمون بالشأن الاقتصادي', rows: 1 },
  { key: 'sources', label: 'مصادر البحث', placeholder: 'روابط، دراسات، أرقام، جهات يمكن التواصل معها', rows: 2 },
];

const mmToSec = (m: string) => Math.round(Number(m || 0) * 60);

export const EpisodePlanner: React.FC<EpisodePlannerProps> = ({
  episode,
  allGuests,
  allNews,
  currentUser,
  canEditEpisode,
  canEditRundown,
  onSaveEpisode,
  onUpdateRundown,
  onOpenNews,
}) => {
  const topics = episode.topics || [];
  const rundown = episode.rundown || [];
  const groups = useMemo(() => groupByTopic(episode), [episode]);
  const ctx = { requests: apiService.getRequests(), media: apiService.getMedia() as any[] };

  // Brief
  const [briefOpen, setBriefOpen] = useState(!episode.brief?.idea);
  const [brief, setBrief] = useState<EpisodeBrief>(episode.brief || {});
  const briefDirty = JSON.stringify(brief) !== JSON.stringify(episode.brief || {});

  // Topic form
  const [topicForm, setTopicForm] = useState<(EpisodeTopic & { minutes: string }) | null>(null);
  const [newsFilter, setNewsFilter] = useState('');

  // Segment form
  const [segmentForm, setSegmentForm] = useState<{ segment: RundownSegment | null; topicId?: string; type?: RundownSegmentType } | null>(null);
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});

  const saveTopics = (next: EpisodeTopic[], nextRundown?: RundownSegment[]) =>
    onSaveEpisode({ id: episode.id, topics: next, ...(nextRundown ? { rundown: recalculateRundown(nextRundown) } : {}) });

  const submitTopic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicForm || !topicForm.title.trim()) return;
    const { minutes, ...t } = topicForm;
    const topic: EpisodeTopic = { ...t, title: t.title.trim(), targetSeconds: minutes ? mmToSec(minutes) : undefined };
    const exists = topics.some((x) => x.id === topic.id);
    saveTopics(exists ? topics.map((x) => (x.id === topic.id ? topic : x)) : [...topics, topic]);
    setTopicForm(null);
  };

  /**
   * Drag to arrange: topics among topics (their segments follow in the rundown), and segments
   * within a topic or into another topic. Every move can be undone from the toast.
   */
  const onPlanDrop = (e: DropEvent) => {
    const prevTopics = topics;
    const prevRundown = rundown;
    const undo = { label: 'تراجع', run: () => saveTopics(prevTopics, prevRundown) };
    if (e.to === 'topics') {
      const from = topics.findIndex((t) => t.id === e.id);
      if (from === -1) return;
      const next = moveInArray(topics, from, e.index);
      saveTopics(next, arrangeByTopics(rundown, next));
      notify({ type: 'success', message: `نُقل المحور «${topics[from].title}» إلى الموضع ${e.index + 1}`, action: undo });
      return;
    }
    const moved = rundown.find((x) => x.id === e.id);
    if (!moved) return;
    const known = new Set(topics.map((t) => t.id));
    const toTopic = e.to === 'seg:loose' ? undefined : e.to.slice(4);
    const inGroup = (x: RundownSegment) => (toTopic ? x.topicId === toTopic : !x.topicId || !known.has(x.topicId));
    const rest = rundown.filter((x) => x.id !== e.id);
    const group = rest.filter(inGroup);
    const next = { ...moved, topicId: toTopic };
    let at: number;
    if (group[e.index]) at = rest.findIndex((x) => x.id === group[e.index].id);
    else if (group[e.index - 1]) at = rest.findIndex((x) => x.id === group[e.index - 1].id) + 1;
    else {
      // An empty topic: place it before the first segment of any later topic.
      const later = new Set(topics.slice(topics.findIndex((t) => t.id === toTopic) + 1).map((t) => t.id));
      const firstLater = rest.findIndex((x) => x.topicId && later.has(x.topicId));
      at = firstLater === -1 ? insertIntoTopic(rest, next).indexOf(next) : firstLater;
    }
    onUpdateRundown([...rest.slice(0, at), next, ...rest.slice(at)]);
    const where = toTopic ? `المحور «${topics.find((t) => t.id === toTopic)?.title}»` : 'خارج المحاور';
    notify({
      type: 'success',
      message: moved.topicId === toTopic ? `نُقلت «${moved.title}» إلى الموضع ${e.index + 1}` : `نُقلت «${moved.title}» إلى ${where}`,
      action: { label: 'تراجع', run: () => onUpdateRundown(prevRundown) },
    });
  };

  const removeTopic = (topic: EpisodeTopic) => {
    const count = rundown.filter((s) => s.topicId === topic.id).length;
    if (!window.confirm(count ? `حذف المحور «${topic.title}»؟ ستبقى فقراته (${count}) في الرانداون بدون محور.` : `حذف المحور «${topic.title}»؟`)) return;
    saveTopics(
      topics.filter((t) => t.id !== topic.id),
      rundown.map((s) => (s.topicId === topic.id ? { ...s, topicId: undefined } : s))
    );
  };

  const saveSegment = (data: Partial<RundownSegment>) => {
    const existing = rundown.find((s) => s.id === data.id);
    if (existing) {
      onUpdateRundown(rundown.map((s) => (s.id === data.id ? ({ ...s, ...data } as RundownSegment) : s)));
    } else {
      const seg = {
        ...(data as RundownSegment),
        id: data.id || newId('seg'),
        episodeId: episode.id,
        orderIndex: rundown.length + 1,
        startTimeOffset: '00:00:00',
        endTimeOffset: '00:00:00',
        scriptText: data.scriptText || '',
        isCompleted: false,
      } as RundownSegment;
      onUpdateRundown(insertIntoTopic(rundown, seg));
    }
  };

  // Summary figures
  const totalSeconds = sumSeconds(rundown);
  const plannedSeconds = (episode.durationMinutes || 0) * 60;
  const guestsInShow = new Map<string, any>();
  rundown.forEach((s) => segmentGuests(s).forEach((g) => guestsInShow.set(g.guestId, g)));
  const bookedGuests = [...guestsInShow.keys()].filter((id) => {
    const g = (episode.guests || []).find((x) => guestKey(x) === id);
    return g && ['CONFIRMED', 'ARRIVED'].includes(bookingStatusOf(g));
  }).length;
  const reports = rundown.filter((s) => s.segmentType === 'REPORT');
  const reportsReady = reports.filter((s) => segmentReadiness(s, episode, ctx).find((i) => i.key === 'video')?.state === 'ready').length;
  const talk = rundown.filter((s) => TALK_SEGMENT_TYPES.has(s.segmentType) && segmentGuests(s).length);
  const talkWithQuestions = talk.filter((s) => segmentQuestions(episode, s).length > 0).length;

  const bookingOf = (guestId: string) => {
    const g = (episode.guests || []).find((x) => guestKey(x) === guestId);
    return g ? bookingStatusOf(g) : 'CANDIDATE';
  };

  const reportLine = (seg: RundownSegment) => {
    const src = reportSourceOf(seg.report?.source);
    const req = ctx.requests.find((r) => r.link?.segmentId === seg.id && (r.type === 'FIELD' || r.type === 'ARCHIVE') && r.status !== 'CANCELLED');
    const video = segmentReadiness(seg, episode, ctx).find((i) => i.key === 'video');
    const parts: string[] = [];
    if (src) parts.push(src.name + (seg.report?.reporterName ? `: ${seg.report.reporterName}` : ''));
    else parts.push('بلا أمر تكليف');
    if (req) parts.push(`الطلب ${requestStatusName(req.status)}${req.assigneeName ? ` (${req.assigneeName})` : ''}`);
    if (video) parts.push(video.detail);
    return { text: parts.join(' · '), ready: video?.state === 'ready' };
  };

  const segmentRow = (seg: RundownSegment) => {
    const meta = TYPE_META[seg.segmentType] || TYPE_META.NEWS_ITEM;
    const Icon = meta.icon;
    const items = segmentReadiness(seg, episode, ctx);
    const ready = items.every((i) => i.state === 'ready');
    const guests = segmentGuests(seg);
    const qCount = segmentQuestions(episode, seg).length;
    const report = seg.segmentType === 'REPORT' ? reportLine(seg) : null;
    return (
      <SortableItem
        as="li"
        key={seg.id}
        id={seg.id}
        type="segment"
        container={`seg:${seg.topicId && topics.some((t) => t.id === seg.topicId) ? seg.topicId : 'loose'}`}
        label={seg.title}
        disabled={!canEditRundown}
        className="p-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-colors"
      >
        {({ handle }) => (
        <div className="flex items-start gap-2.5">
          {handle}
          <span className={`p-1.5 rounded-lg shrink-0 ${meta.tone}`} title={meta.label}>
            <Icon className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500">{meta.label}</span>
              <span className="text-sm font-bold text-slate-800">{seg.title}</span>
              <span className="text-[11px] font-mono text-slate-500" dir="ltr">
                {formatSecondsToTime(seg.durationSeconds || 0).slice(3)}
              </span>
              {seg.segmentType !== 'BREAK' && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                  title={items.map((i) => `${i.label}: ${i.detail}`).join('\n')}
                >
                  {ready ? 'جاهزة' : `${items.filter((i) => i.state !== 'ready').length} نواقص`}
                </span>
              )}
            </div>
            {guests.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {guests.map((g) => {
                  const st = bookingOf(g.guestId);
                  return (
                    <span key={g.guestId} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${BOOKING_TONE[st]}`}>
                      {g.guestName} · {g.role === 'MAIN' ? 'رئيسي' : g.role === 'CALLER' ? 'مداخلة' : 'معقّب'} · {bookingStatusName(st)}
                    </span>
                  );
                })}
                {TALK_SEGMENT_TYPES.has(seg.segmentType) && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${qCount ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-700'}`}>
                    {qCount ? `${qCount} سؤال` : 'بلا أسئلة'}
                  </span>
                )}
              </div>
            )}
            {report && <p className={`text-[11px] ${report.ready ? 'text-emerald-700' : 'text-slate-600'}`}>{report.text}</p>}
            {seg.newsTitle && (
              <button type="button" onClick={() => seg.newsId && onOpenNews?.(seg.newsId)} className="text-[11px] text-indigo-700 hover:underline flex items-center gap-1">
                <Newspaper className="w-3 h-3" /> {seg.newsTitle}
              </button>
            )}
          </div>
          {canEditRundown && (
            <button type="button" onClick={() => setSegmentForm({ segment: seg })} aria-label={`تعديل ${seg.title}`} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg shrink-0">
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </div>
        )}
      </SortableItem>
    );
  };

  const program = apiService.getPrograms().find((p) => p.id === episode.programId);
  const canSaveTemplate = !!program && RbacService.hasPermission(currentUser, 'programs.manage') && rundown.length > 0;
  const [notice, setNotice] = useState<string | null>(null);
  const saveTemplate = () => {
    if (!program) return;
    const template = templateFromEpisode(episode);
    if (program.template && !window.confirm(`استبدال قالب «${program.name}» الحالي (${program.template.segments.length} فقرة) ببنية هذه الحلقة؟`)) return;
    try {
      apiService.saveProgram({ id: program.id, template: { ...template, updatedAt: new Date().toISOString(), updatedByName: currentUser.fullName } });
      setNotice(`حُفظت البنية (${template.topics.length} محور، ${template.segments.length} فقرة) قالباً لبرنامج «${program.name}»؛ ستُعرض كخيار عند إنشاء الحلقات الجديدة.`);
    } catch (err: any) {
      setNotice(err?.message || 'تعذر حفظ القالب');
    }
    setTimeout(() => setNotice(null), 6000);
  };

  const newsOptions = allNews
    .filter((n) => !n.deletedAt && (!newsFilter.trim() || n.title.includes(newsFilter.trim())))
    .slice(0, 30);

  return (
    <div className="space-y-4" data-testid="episode-planner">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canSaveTemplate && (
          <button type="button" onClick={saveTemplate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Save className="w-4 h-4" /> حفظ البنية كقالب للبرنامج
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
          {notice}
        </p>
      )}
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          { label: 'المدة المخططة', value: `${formatSecondsToTime(totalSeconds).slice(0, 5)} / ${formatSecondsToTime(plannedSeconds).slice(0, 5)}`, warn: plannedSeconds > 0 && Math.abs(totalSeconds - plannedSeconds) > 60 },
          { label: 'المحاور', value: String(topics.length), warn: topics.length === 0 },
          { label: 'الضيوف المؤكدون', value: `${bookedGuests} / ${guestsInShow.size}`, warn: bookedGuests < guestsInShow.size },
          { label: 'حوارات لها أسئلة', value: `${talkWithQuestions} / ${talk.length}`, warn: talkWithQuestions < talk.length },
          { label: 'التقارير الجاهزة', value: `${reportsReady} / ${reports.length}`, warn: reportsReady < reports.length },
        ].map((c) => (
          <div key={c.label} className={`p-3 rounded-xl border ${c.warn ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-200'}`}>
            <div className="text-[11px] font-bold text-slate-500">{c.label}</div>
            <div className="text-lg font-black text-slate-800 font-mono" dir="ltr" style={{ textAlign: 'right' }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Brief */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4" aria-label="ملخص الحلقة">
        <button type="button" onClick={() => setBriefOpen((v) => !v)} aria-expanded={briefOpen} className="w-full flex items-center justify-between gap-2 text-right">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" /> ملخص الحلقة (الفكرة والزاوية والرسالة)
          </h3>
          {briefOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        {!briefOpen && episode.brief?.idea && <p className="text-xs text-slate-600 mt-2 line-clamp-2">{episode.brief.idea}</p>}
        {briefOpen && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {BRIEF_FIELDS.map((f) => (
              <div key={f.key} className={f.key === 'idea' || f.key === 'sources' ? 'md:col-span-2' : ''}>
                <label htmlFor={`brief-${f.key}`} className="block text-xs font-bold text-slate-700 mb-1">
                  {f.label}
                </label>
                <textarea
                  id={`brief-${f.key}`}
                  rows={f.rows}
                  readOnly={!canEditEpisode}
                  value={brief[f.key] || ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setBrief({ ...brief, [f.key]: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs leading-relaxed"
                />
              </div>
            ))}
            {canEditEpisode && (
              <div className="md:col-span-2 flex justify-end">
                <button
                  type="button"
                  disabled={!briefDirty}
                  onClick={() => onSaveEpisode({ id: episode.id, brief })}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  حفظ الملخص
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Topics */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" /> محاور الحلقة وفقراتها
        </h3>
        {canEditEpisode && (
          <button
            type="button"
            onClick={() => setTopicForm({ id: newId('topic'), title: '', minutes: '' })}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold"
          >
            <Plus className="w-4 h-4" /> محور جديد
          </button>
        )}
      </div>

      {groups.length === 0 && (
        <div className="bg-white p-10 text-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
          ابدأ بإضافة محاور الحلقة (مثلاً: «المشهد الميداني»، «التداعيات الاقتصادية»)، ثم أضف لكل محور تقاريره وحواراته وضيوفه.
        </div>
      )}

      <SortableScope onDrop={onPlanDrop} disabled={!canEditRundown}>
      <SortableList id="topics" accept="topic" className="space-y-4">
      {groups.map(({ topic, segments }) => {
        const idx = topic ? topics.findIndex((t) => t.id === topic.id) : -1;
        const actual = sumSeconds(segments);
        const target = topic?.targetSeconds || 0;
        const over = target > 0 && actual > target;
        const linked = (topic?.newsIds || []).map((id) => allNews.find((n) => n.id === id)).filter(Boolean) as NewsItem[];
        return (
          <SortableItem
            as="section"
            key={topic?.id || 'loose'}
            id={topic?.id || 'loose'}
            type="topic"
            container="topics"
            label={topic ? topic.title : 'خارج المحاور'}
            disabled={!topic || !canEditEpisode}
            aria-label={topic ? `المحور ${idx + 1}: ${topic.title}` : 'فقرات خارج المحاور'}
            className={`rounded-2xl border p-4 space-y-3 ${topic ? 'bg-indigo-50/30 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}
          >
            {({ handle }) => (
            <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex items-start gap-1.5">
                {topic && canEditEpisode && handle}
                <div className="min-w-0">
                <h4 className="text-sm font-black text-slate-800">
                  {topic ? `المحور ${idx + 1}: ${topic.title}` : 'خارج المحاور (المقدمة، الفواصل، الختام)'}
                </h4>
                {topic?.angle && <p className="text-xs text-slate-600 mt-0.5">الزاوية: {topic.angle}</p>}
                <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
                  <span className={`font-mono font-bold ${over ? 'text-rose-700' : 'text-slate-600'}`} dir="ltr">
                    {formatSecondsToTime(actual).slice(3)}
                    {target ? ` / ${formatSecondsToTime(target).slice(3)}` : ''}
                  </span>
                  {over && <span className="text-rose-700 font-bold">يتجاوز المدة المستهدفة</span>}
                  <span className="text-slate-500">{segments.length} فقرة</span>
                </div>
                {target > 0 && (
                  <div className="w-48 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden" aria-hidden>
                    <div className={`h-full ${over ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, (actual / target) * 100)}%` }} />
                  </div>
                )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {canEditRundown &&
                  QUICK_ADD.map((q) => (
                    <button
                      key={q.type}
                      type="button"
                      onClick={() => setSegmentForm({ segment: null, topicId: topic?.id, type: q.type })}
                      className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700"
                    >
                      + {q.label}
                    </button>
                  ))}
                {topic && canEditEpisode && (
                  <>
                    <button
                      type="button"
                      onClick={() => setTopicForm({ ...topic, minutes: topic.targetSeconds ? String(Math.round(topic.targetSeconds / 6) / 10) : '' })}
                      aria-label={`تعديل المحور ${topic.title}`}
                      className="p-1.5 text-blue-600 hover:bg-white rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => removeTopic(topic)} aria-label={`حذف المحور ${topic.title}`} className="p-1.5 text-rose-500 hover:bg-white rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {topic && (topic.notes || linked.length > 0) && (
              <div className="text-xs">
                <button type="button" onClick={() => setOpenNotes({ ...openNotes, [topic.id]: !openNotes[topic.id] })} className="font-bold text-indigo-700 hover:underline">
                  {openNotes[topic.id] ? 'إخفاء' : 'عرض'} ملاحظات البحث والأخبار المرتبطة ({linked.length})
                </button>
                {openNotes[topic.id] && (
                  <div className="mt-2 p-3 rounded-xl bg-white border border-indigo-100 space-y-2">
                    {topic.notes && <p className="whitespace-pre-line text-slate-700 leading-relaxed">{topic.notes}</p>}
                    {linked.map((n) => (
                      <button key={n.id} type="button" onClick={() => onOpenNews?.(n.id)} className="block text-right text-indigo-700 hover:underline">
                        • {n.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <SortableList as="ul" id={`seg:${topic?.id || 'loose'}`} accept="segment" className="space-y-1.5 min-h-[2.5rem] rounded-xl">
              {segments.length === 0 ? (
                <li className="text-[11px] text-slate-500 p-2 border border-dashed border-slate-300 rounded-xl">
                  لا فقرات بعد — أضف تقريراً أو مقابلة أو نقاشاً، أو اسحب فقرة إلى هنا.
                </li>
              ) : (
                segments.map(segmentRow)
              )}
            </SortableList>
            </>
            )}
          </SortableItem>
        );
      })}
      </SortableList>
      </SortableScope>

      {/* Topic form */}
      <FormPage isOpen={!!topicForm} onClose={() => setTopicForm(null)} title={topicForm && topics.some((t) => t.id === topicForm.id) ? 'تعديل المحور' : 'محور جديد'} maxWidth="lg">
        {topicForm && (
          <form onSubmit={submitTopic} className="space-y-3">
            <div>
              <label htmlFor="topic-title" className="block text-xs font-bold text-slate-700 mb-1">عنوان المحور *</label>
              <input id="topic-title" data-autofocus required value={topicForm.title} onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="topic-angle" className="block text-xs font-bold text-slate-700 mb-1">الزاوية</label>
                <input id="topic-angle" value={topicForm.angle || ''} onChange={(e) => setTopicForm({ ...topicForm, angle: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </div>
              <div>
                <label htmlFor="topic-minutes" className="block text-xs font-bold text-slate-700 mb-1">المدة المستهدفة (دقائق)</label>
                <input id="topic-minutes" type="number" min={0} step={0.5} value={topicForm.minutes} onChange={(e) => setTopicForm({ ...topicForm, minutes: e.target.value })} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs" />
              </div>
            </div>
            <div>
              <label htmlFor="topic-notes" className="block text-xs font-bold text-slate-700 mb-1">ملاحظات البحث ونقاط الحديث</label>
              <textarea id="topic-notes" rows={4} value={topicForm.notes || ''} onChange={(e) => setTopicForm({ ...topicForm, notes: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs leading-relaxed" />
            </div>
            <fieldset className="p-3 border border-slate-200 rounded-xl space-y-2">
              <legend className="px-1 text-xs font-bold text-slate-700">أخبار مرتبطة من غرفة الأخبار ({(topicForm.newsIds || []).length})</legend>
              <input aria-label="بحث في الأخبار" placeholder="ابحث بعنوان الخبر…" value={newsFilter} onChange={(e) => setNewsFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs" />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {newsOptions.map((n) => {
                  const on = (topicForm.newsIds || []).includes(n.id);
                  return (
                    <label key={n.id} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setTopicForm({ ...topicForm, newsIds: on ? (topicForm.newsIds || []).filter((x) => x !== n.id) : [...(topicForm.newsIds || []), n.id] })
                        }
                      />
                      <span className="truncate">{n.title}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setTopicForm(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl">
                حفظ المحور
              </button>
            </div>
          </form>
        )}
      </FormPage>

      <SegmentModal
        isOpen={!!segmentForm}
        onClose={() => setSegmentForm(null)}
        onSave={saveSegment}
        segment={segmentForm?.segment || null}
        guests={allGuests}
        newsList={allNews}
        defaultPresenter={episode.presenterName}
        episodeId={episode.id}
        topics={topics}
        defaultTopicId={segmentForm?.topicId}
        defaultType={segmentForm?.type}
      />
    </div>
  );
};
