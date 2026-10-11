import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Settings2, CalendarDays, Radio, AtSign, CheckSquare, ClipboardList, FileEdit, FileSearch, Inbox, Send, Tv, UserCheck } from 'lucide-react';
import { useWorkSections } from '../../hooks/useWorkSections';
import { orderWorkSections, stationWorkDay } from '../../shared/myWork';
import { addDaysIso } from '../../shared/dates';
import type { WorkSectionKey } from '../../shared/workContext';
import type { EditorialTask, Episode, NewsItem, User } from '../../types';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { useLiveData } from '../../hooks/useLiveData';
import { departmentIdOf, departmentName } from '../../shared/departments';
import { isRequestClosed, requestStatusName, requestTypeOf, episodeReadiness } from '../../shared/production';
import { onDutyAt, shiftName } from '../../shared/roster';
import { commentLink } from '../../shared/comments';
import { isApprover } from '../../shared/bulletins';
import { selectReviewDeadlines, reviewDeadlineLabel } from '../../shared/reviewDeadlines';
import { IncomingHandovers } from '../roster/ShiftHandovers';

interface MyWorkPanelProps {
  currentUser: User;
  newsList: NewsItem[];
  episodes: Episode[];
  tasks: EditorialTask[];
  onOpenNews: (id: string) => void;
  onOpenEpisode: (id: string) => void;
  onNavigate: (view: string) => void;
  onOpenBulletin?: (id: string) => void;
  referenceTime?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const OPEN_TASK = (t: EditorialTask) => !['DONE', 'COMPLETED', 'CANCELLED'].includes(t.status);

interface Row {
  id: string;
  title: string;
  meta?: string;
  tone?: 'red' | 'amber' | 'slate' | 'emerald';
  onClick: () => void;
}

const TONES: Record<NonNullable<Row['tone']>, string> = {
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  slate: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-50 text-emerald-700',
};

const Card: React.FC<{ icon: any; title: string; rows: Row[]; empty: string; more?: () => void; testId: string }> = ({ icon: Icon, title, rows, empty, more, testId }) => (
  <section data-testid={testId} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col min-w-0">
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-blue-600" />
        {title}
        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 rounded-full px-1.5">{rows.length}</span>
      </h3>
      {more && (
        <button type="button" onClick={more} className="text-[11px] font-bold text-blue-600 hover:underline">
          عرض الكل
        </button>
      )}
    </div>
    {rows.length === 0 ? (
      <p className="text-[11px] text-slate-500 py-3 text-center">{empty}</p>
    ) : (
      <ul className="space-y-1.5">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={r.onClick}
              className="w-full text-right flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200"
            >
              <span className="text-xs font-semibold text-slate-800 truncate">{r.title}</span>
              {r.meta && <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0 max-w-[45%] truncate ${TONES[r.tone || 'slate']}`}>{r.meta}</span>}
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/** Personal work queue: what needs me now, by role and department. */
export const MyWorkPanel: React.FC<MyWorkPanelProps> = (props) => <MyWorkPanelContent key={props.currentUser.id} {...props} />;

const MyWorkPanelContent: React.FC<MyWorkPanelProps> = ({ currentUser, newsList, episodes, tasks, onOpenNews, onOpenEpisode, onNavigate, onOpenBulletin, referenceTime }) => {
  useLiveData(['requests', 'roster', 'comments', 'media', 'bulletins', 'bulletinStories', 'diary', 'bookings', 'resources', 'settings'], 60_000);
  const [preferences, savePreferences] = useWorkSections(currentUser.id);
  const [customizing, setCustomizing] = useState(false);
  const me = currentUser.id;
  const myDept = departmentIdOf(currentUser);
  const canReview = RbacService.hasPermission(currentUser, 'news.review');
  const now = referenceTime ?? Date.now();

  const myNews: Row[] = newsList
    .filter((n) => n.authorId === me && ['DRAFT', 'IN_PROGRESS', 'NEEDS_REVISION', 'REJECTED'].includes(n.status))
    .sort((a, b) => Number(b.status === 'NEEDS_REVISION') - Number(a.status === 'NEEDS_REVISION') || b.updatedAt.localeCompare(a.updatedAt))
    .map((n) => ({
      id: n.id,
      title: n.title || 'خبر بلا عنوان',
      meta: n.status === 'NEEDS_REVISION' ? 'مُعاد للتعديل' : n.status === 'REJECTED' ? 'مرفوض' : 'مسودة',
      tone: n.status === 'NEEDS_REVISION' ? 'red' : n.status === 'REJECTED' ? 'slate' : 'amber',
      onClick: () => onOpenNews(n.id),
    }));

  const toReview: Row[] = canReview
    ? selectReviewDeadlines(newsList.filter(n => n.authorId !== me), apiService.getBulletins(), apiService.getBulletinStories(), episodes, apiService.getSettings().defaultTimezone, now)
        .map((row) => { const n = newsList.find(n => n.id === row.newsId)!; return { id: n.id, title: n.title, meta: `${reviewDeadlineLabel(row, now)}${row.destination ? ` · ${row.destination.title}` : ''}`, tone: row.overdue ? 'red' as const : 'amber' as const, onClick: () => onOpenNews(n.id) }; })
    : [];

  const requests = apiService.getRequests();
  const deptInbox: Row[] = requests
    .filter((r) => r.departmentId === myDept && !isRequestClosed(r.status))
    .sort((a, b) => Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT') || a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      id: r.id,
      title: `${requestTypeOf(r.type)?.name || 'طلب'}: ${r.title}`,
      meta: r.priority === 'URGENT' ? 'عاجل' : requestStatusName(r.status),
      tone: r.priority === 'URGENT' ? 'red' : 'amber',
      onClick: () => onNavigate(`/requests/${encodeURIComponent(r.id)}`),
    }));
  const sent: Row[] = requests
    .filter((r) => r.requesterId === me && !isRequestClosed(r.status))
    .map((r) => ({ id: r.id, title: r.title, meta: `${departmentName(r.departmentId)} · ${requestStatusName(r.status)}`, onClick: () => onNavigate(`/requests/${encodeURIComponent(r.id)}`) }));

  const myTasks: Row[] = tasks
    .filter((t) => (t.assigneeId || t.assignedToId) === me && OPEN_TASK(t))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .map((t) => {
      const overdue = t.dueDate && new Date(t.dueDate).getTime() < now;
      return {
        id: t.id,
        title: t.title,
        meta: t.dueDate ? (overdue ? 'متأخرة' : new Date(t.dueDate).toLocaleDateString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short' })) : undefined,
        tone: overdue ? ('red' as const) : ('slate' as const),
          onClick: () => {
            if (t.relatedEntityType === 'BULLETIN') openBulletin(t.relatedEntityId || '');
            else if (t.relatedEntityType === 'BULLETIN_STORY') {
              const story = apiService.getBulletins().flatMap(b => apiService.getBulletinStories(b.id)).find(s => s.id === t.relatedEntityId);
              if (story) { try { sessionStorage.setItem('madar-open-bulletin-story', story.id); } catch { /* Keep navigation available. */ } openBulletin(story.bulletinId); } else onNavigate(`/tasks/${encodeURIComponent(t.id)}`);
            } else onNavigate(`/tasks/${encodeURIComponent(t.id)}`);
          },
      };
    });

  const ctx = { requests, media: apiService.getMedia() };
  // Today and the next two days, plus anything on air right now.
  const stationDay = stationWorkDay(new Date(now), apiService.getSettings().defaultTimezone);
  const days = [0, 1, 2].map(d => addDaysIso(stationDay, d));
  const todayEpisodes: Row[] = episodes
    .filter((e) => e.status === 'ON_AIR' || (days.includes((e.broadcastDate || '').slice(0, 10)) && !['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status)))
    .sort((a, b) => (a.broadcastDate || '').localeCompare(b.broadcastDate || ''))
    .map((e) => {
      const r = episodeReadiness(e, ctx);
      const mine = r.blockers.filter((b) => b.departmentId === myDept).length;
      return {
        id: e.id,
        title: `${(e.broadcastDate || '').slice(0, 10) === days[0] ? 'اليوم' : new Date(e.broadcastDate).toLocaleDateString(appLocale(), { ...zoneOptions(), weekday: 'long' })} · ${e.programName ? e.programName + ' — ' : ''}${e.title}`,
        meta: r.ready ? 'جاهزة' : mine ? `${mine} نواقص على قسمك` : `${r.readySegments}/${r.total} جاهزة`,
        tone: r.ready ? ('emerald' as const) : mine ? ('red' as const) : ('amber' as const),
        onClick: () => onOpenEpisode(e.id),
      };
    });

  const mentions: Row[] = apiService
    .getComments()
    .filter((c) => c.mentions?.includes(me) && now - new Date(c.createdAt).getTime() < 7 * DAY)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({
      id: c.id,
      title: `${c.authorName}: ${c.text}`,
      meta: c.target.title,
      onClick: () => {
        const [, view, id] = commentLink(c.target).split('/');
        if (view === 'news') onOpenNews(id);
        else if (view === 'episodes') onOpenEpisode(id);
        else onNavigate(view);
      },
    }));

  // Bulletin stories: waiting for my approval, and my own stories sent back or still in draft.
  const bulletinActor = { id: me, canApprove: RbacService.hasPermission(currentUser, 'bulletins.approve'), canEdit: RbacService.hasPermission(currentUser, 'bulletins.edit'), role: currentUser.role };
  const today = stationDay;
  const upcoming = apiService.getBulletins().filter((b) => b.date >= today && b.status !== 'DONE');
  const byId = new Map(upcoming.map((b) => [b.id, b]));
  const bulletinStories = apiService.getBulletinStories().filter((s) => byId.has(s.bulletinId) && !s.killed);
  const openBulletin = (id: string) => (onOpenBulletin ? onOpenBulletin(id) : onNavigate('bulletins'));
  const openBulletinStory = (story: { id: string; bulletinId: string }) => {
    try { sessionStorage.setItem('madar-open-bulletin-story', story.id); } catch { /* The bulletin remains accessible without local storage. */ }
    openBulletin(story.bulletinId);
  };
  const bulletinRows: Row[] = [
    ...bulletinStories
      .filter((s) => s.status === 'READY' && isApprover(byId.get(s.bulletinId), bulletinActor, s))
      .map((s) => ({ id: s.id, title: s.slug, meta: `اعتماد · ${byId.get(s.bulletinId)!.startTime}`, tone: 'amber' as const, onClick: () => openBulletinStory(s) })),
    ...bulletinStories
      .filter((s) => s.writerId === me && s.status === 'DRAFT' && s.returnNote)
      .map((s) => ({ id: s.id, title: s.slug, meta: 'أُعيدت إليك', tone: 'red' as const, onClick: () => openBulletinStory(s) })),
  ];

  // Coverage assignments from the planning diary (next three days) and my bookings.
  const in3 = addDaysIso(today, 3);
  const resName = (id: string) => apiService.getResources().find((r) => r.id === id)?.name || 'مورد';
  const planRows: Row[] = [
    ...apiService
      .getDiary()
      .filter((e) => e.date >= today && e.date <= in3 && e.coverage !== 'SKIP' && e.assigneeIds.includes(me))
      .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')))
      .map((e) => ({
        id: e.id,
        title: e.title,
        meta: `${e.date === today ? 'اليوم' : e.date}${e.startTime ? ` ${e.startTime}` : ''}`,
        tone: (e.priority === 'HIGH' ? 'red' : e.date === today ? 'amber' : 'slate') as Row['tone'],
        onClick: () => onNavigate(`/diary/${encodeURIComponent(e.id)}`),
      })),
    ...apiService
      .getBookings()
      .filter((b) => b.status !== 'CANCELLED' && b.assigneeId === me && Date.parse(b.end) > now && Date.parse(b.start) < now + 2 * DAY)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => ({
        id: b.id,
        title: `${resName(b.resourceId)} — ${b.title}`,
        meta: new Date(b.start).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' }),
        tone: 'emerald' as const,
        onClick: () => onNavigate(`/bookings/${encodeURIComponent(b.id)}`),
      })),
  ];

  const myDuty = onDutyAt(apiService.getRoster().filter((e) => e.userId === me), now)[0];

  const sections: { key: WorkSectionKey; title: string; icon: any; rows: Row[]; empty: string; more?: () => void; enabled: boolean; mandatory?: boolean }[] = [
    { key: 'my-news', title: 'أخباري قيد العمل', icon: FileEdit, rows: myNews, empty: 'لا توجد مسودات أو أخبار معادة إليك', more: () => onNavigate('news'), enabled: RbacService.hasPermission(currentUser, 'news.create') },
    { key: 'my-review', title: 'بانتظار مراجعتي', icon: FileSearch, rows: toReview, empty: 'لا أخبار تنتظر المراجعة', more: () => onNavigate('news'), enabled: canReview },
    { key: 'my-tasks', title: 'مهامي', icon: CheckSquare, rows: myTasks, empty: 'لا مهام مفتوحة مسندة إليك', more: () => onNavigate('tasks'), enabled: true },
    { key: 'my-dept-requests', title: `طلبات واردة لقسم ${departmentName(myDept)}`, icon: Inbox, rows: deptInbox, empty: 'لا طلبات مفتوحة لقسمك', more: () => onNavigate('requests'), enabled: true, mandatory: deptInbox.some(r => r.tone === 'red') },
    { key: 'my-episodes', title: 'الحلقات القادمة وجاهزيتها', icon: Tv, rows: todayEpisodes, empty: 'لا حلقات خلال اليومين القادمين', more: () => onNavigate('episodes'), enabled: true, mandatory: todayEpisodes.some(r => r.tone === 'red' || r.tone === 'amber') },
    { key: 'my-bulletins', title: 'قصص النشرات', icon: Radio, rows: bulletinRows, empty: 'لا قصص نشرات تنتظرك', more: () => onNavigate('bulletins'), enabled: bulletinActor.canEdit || bulletinActor.canApprove || bulletinRows.length > 0 },
    { key: 'my-sent-requests', title: 'طلباتي المرسلة', icon: Send, rows: sent, empty: 'لا طلبات مفتوحة أرسلتها', more: () => onNavigate('requests'), enabled: true },
    { key: 'my-plan', title: 'تغطياتي وحجوزاتي', icon: CalendarDays, rows: planRows, empty: 'لا تغطيات أو حجوزات مسندة إليك', more: () => onNavigate('diary'), enabled: planRows.length > 0 },
    { key: 'my-mentions', title: 'إشارات إليّ (7 أيام)', icon: AtSign, rows: mentions, empty: 'لم يُشر إليك أحد مؤخراً', enabled: true },
  ];
  const ordered = orderWorkSections(sections.filter(section => section.enabled).map(section => section.key), preferences).map(key => sections.find(section => section.key === key)!);
  const move = (key: WorkSectionKey, direction: -1 | 1) => {
    const order = [...preferences.order];
    const index = order.indexOf(key);
    const visibleIndex = ordered.findIndex(section => section.key === key);
    const neighbor = ordered[visibleIndex + direction];
    if (!neighbor) return;
    const target = order.indexOf(neighbor.key);
    [order[index], order[target]] = [order[target], order[index]];
    savePreferences({ ...preferences, order });
  };

  return (
    <div data-testid="my-work" className="space-y-3">
      <IncomingHandovers currentUser={currentUser} onNavigate={onNavigate} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-blue-600" />
          عملي
          <span className="text-[11px] font-semibold text-slate-500">— قسم {departmentName(myDept)}</span>
        </h2>
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${myDuty ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          {myDuty ? `مناوب الآن — ${shiftName(myDuty.shift)}${myDuty.isLead ? ' (رئيس المناوبة)' : ''}` : 'لست ضمن المناوبة الحالية'}
        </span>
      </div>
      <button type="button" aria-label="تخصيص عملي" aria-expanded={customizing} aria-controls="work-section-controls" onClick={() => setCustomizing(value => !value)} className="min-h-11 inline-flex items-center gap-2 px-3 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg"><Settings2 className="w-4 h-4" />تخصيص عملي</button>
      {customizing && <div id="work-section-controls" className="border-y border-slate-200 py-2">
        {ordered.map(section => <div key={section.key} className="flex flex-wrap items-center justify-between gap-2 py-1">
          <label className="inline-flex items-center gap-2 min-h-11 text-xs text-slate-700"><input type="checkbox" aria-label={`عرض ${section.title}`} checked={section.mandatory || !preferences.hidden.includes(section.key)} disabled={section.mandatory} aria-describedby={section.mandatory ? `work-warning-${section.key}` : undefined} onChange={event => savePreferences({ ...preferences, hidden: event.target.checked ? preferences.hidden.filter(key => key !== section.key) : [...preferences.hidden, section.key] })} />{section.title}</label>
          {section.mandatory && <span id={`work-warning-${section.key}`} className="text-xs text-amber-800">يتضمن تنبيهات تشغيلية ولا يمكن إخفاؤه الآن</span>}
          <div className="inline-flex gap-1">
            <button type="button" aria-label={`تقديم ${section.title}`} title={`تقديم ${section.title}`} disabled={ordered[0]?.key === section.key} onClick={() => move(section.key, -1)} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-300 disabled:opacity-40"><ArrowUp className="w-4 h-4" /></button>
            <button type="button" aria-label={`تأخير ${section.title}`} title={`تأخير ${section.title}`} disabled={ordered[ordered.length - 1]?.key === section.key} onClick={() => move(section.key, 1)} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-slate-300 disabled:opacity-40"><ArrowDown className="w-4 h-4" /></button>
          </div>
        </div>)}
      </div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {ordered.filter(section => section.mandatory || !preferences.hidden.includes(section.key)).map(section => <Card key={section.key} testId={section.key} icon={section.icon} title={section.title} rows={section.rows} empty={section.empty} more={section.more} />)}
      </div>
    </div>
  );
};
