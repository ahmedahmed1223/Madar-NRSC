import React from 'react';
import { CalendarDays, Radio, AtSign, CheckSquare, ClipboardList, FileEdit, FileSearch, Inbox, Send, Tv, UserCheck } from 'lucide-react';
import type { EditorialTask, Episode, NewsItem, User } from '../../types';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { useLiveData } from '../../hooks/useLiveData';
import { departmentIdOf, departmentName } from '../../shared/departments';
import { isRequestClosed, requestStatusName, requestTypeOf, episodeReadiness } from '../../shared/production';
import { onDutyAt, shiftName } from '../../shared/roster';
import { commentLink } from '../../shared/comments';
import { isApprover } from '../../shared/bulletins';

interface MyWorkPanelProps {
  currentUser: User;
  newsList: NewsItem[];
  episodes: Episode[];
  tasks: EditorialTask[];
  onOpenNews: (id: string) => void;
  onOpenEpisode: (id: string) => void;
  onNavigate: (view: string) => void;
  onOpenBulletin?: (id: string) => void;
}

const DAY = 24 * 60 * 60 * 1000;
const OPEN_TASK = (t: EditorialTask) => !['DONE', 'COMPLETED', 'CANCELLED'].includes(t.status);
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
  <section data-testid={testId} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col min-w-0">
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
      <p className="text-[11px] text-slate-400 py-3 text-center">{empty}</p>
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
export const MyWorkPanel: React.FC<MyWorkPanelProps> = ({ currentUser, newsList, episodes, tasks, onOpenNews, onOpenEpisode, onNavigate, onOpenBulletin }) => {
  useLiveData(['requests', 'roster', 'comments', 'media', 'bulletins', 'bulletinStories', 'diary', 'bookings', 'resources']);
  const me = currentUser.id;
  const myDept = departmentIdOf(currentUser);
  const canReview = RbacService.hasPermission(currentUser, 'news.review');

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
    ? newsList
        .filter((n) => n.status === 'UNDER_REVIEW' && n.authorId !== me)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .map((n) => ({ id: n.id, title: n.title, meta: n.authorName || 'بانتظار المراجعة', tone: 'amber' as const, onClick: () => onOpenNews(n.id) }))
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
      onClick: () => onNavigate('requests'),
    }));
  const sent: Row[] = requests
    .filter((r) => r.requesterId === me && !isRequestClosed(r.status))
    .map((r) => ({ id: r.id, title: r.title, meta: `${departmentName(r.departmentId)} · ${requestStatusName(r.status)}`, onClick: () => onNavigate('requests') }));

  const now = Date.now();
  const myTasks: Row[] = tasks
    .filter((t) => (t.assigneeId || t.assignedToId) === me && OPEN_TASK(t))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .map((t) => {
      const overdue = t.dueDate && new Date(t.dueDate).getTime() < now;
      return {
        id: t.id,
        title: t.title,
        meta: t.dueDate ? (overdue ? 'متأخرة' : new Date(t.dueDate).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })) : undefined,
        tone: overdue ? ('red' as const) : ('slate' as const),
        onClick: () => onNavigate('tasks'),
      };
    });

  const ctx = { requests, media: apiService.getMedia() };
  // Today and the next two days, plus anything on air right now.
  const days = [0, 1, 2].map((d) => localDate(new Date(now + d * DAY)));
  const todayEpisodes: Row[] = episodes
    .filter((e) => e.status === 'ON_AIR' || (days.includes((e.broadcastDate || '').slice(0, 10)) && !['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(e.status)))
    .sort((a, b) => (a.broadcastDate || '').localeCompare(b.broadcastDate || ''))
    .map((e) => {
      const r = episodeReadiness(e, ctx);
      const mine = r.blockers.filter((b) => b.departmentId === myDept).length;
      return {
        id: e.id,
        title: `${(e.broadcastDate || '').slice(0, 10) === days[0] ? 'اليوم' : new Date(e.broadcastDate).toLocaleDateString('ar-EG', { weekday: 'long' })} · ${e.programName ? e.programName + ' — ' : ''}${e.title}`,
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
  const bulletinActor = { id: me, canApprove: RbacService.hasPermission(currentUser, 'bulletins.approve'), canEdit: RbacService.hasPermission(currentUser, 'bulletins.edit') };
  const today = localDate(new Date());
  const upcoming = apiService.getBulletins().filter((b) => b.date >= today && b.status !== 'DONE');
  const byId = new Map(upcoming.map((b) => [b.id, b]));
  const bulletinStories = apiService.getBulletinStories().filter((s) => byId.has(s.bulletinId) && !s.killed);
  const openBulletin = (id: string) => (onOpenBulletin ? onOpenBulletin(id) : onNavigate('bulletins'));
  const bulletinRows: Row[] = [
    ...bulletinStories
      .filter((s) => s.status === 'READY' && isApprover(byId.get(s.bulletinId), bulletinActor))
      .map((s) => ({ id: s.id, title: s.slug, meta: `اعتماد · ${byId.get(s.bulletinId)!.startTime}`, tone: 'amber' as const, onClick: () => openBulletin(s.bulletinId) })),
    ...bulletinStories
      .filter((s) => s.writerId === me && s.status === 'DRAFT' && s.returnNote)
      .map((s) => ({ id: s.id, title: s.slug, meta: 'أُعيدت إليك', tone: 'red' as const, onClick: () => openBulletin(s.bulletinId) })),
  ];

  // Coverage assignments from the planning diary (next three days) and my bookings.
  const in3 = localDate(new Date(now + 3 * DAY));
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
        onClick: () => onNavigate('diary'),
      })),
    ...apiService
      .getBookings()
      .filter((b) => b.status !== 'CANCELLED' && b.assigneeId === me && Date.parse(b.end) > now && Date.parse(b.start) < now + 2 * DAY)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => ({
        id: b.id,
        title: `${resName(b.resourceId)} — ${b.title}`,
        meta: new Date(b.start).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false }),
        tone: 'emerald' as const,
        onClick: () => onNavigate('bookings'),
      })),
  ];

  const myDuty = onDutyAt(apiService.getRoster().filter((e) => e.userId === me), now)[0];

  return (
    <div data-testid="my-work" className="space-y-3">
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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {RbacService.hasPermission(currentUser, 'news.create') && (
          <Card testId="my-news" icon={FileEdit} title="أخباري قيد العمل" rows={myNews} empty="لا توجد مسودات أو أخبار معادة إليك" more={() => onNavigate('news')} />
        )}
        {canReview && <Card testId="my-review" icon={FileSearch} title="بانتظار مراجعتي" rows={toReview} empty="لا أخبار تنتظر المراجعة" more={() => onNavigate('news')} />}
        <Card testId="my-dept-requests" icon={Inbox} title={`طلبات واردة لقسم ${departmentName(myDept)}`} rows={deptInbox} empty="لا طلبات مفتوحة لقسمك" more={() => onNavigate('requests')} />
        <Card testId="my-sent-requests" icon={Send} title="طلباتي المرسلة" rows={sent} empty="لا طلبات مفتوحة أرسلتها" more={() => onNavigate('requests')} />
        <Card testId="my-tasks" icon={CheckSquare} title="مهامي" rows={myTasks} empty="لا مهام مفتوحة مسندة إليك" more={() => onNavigate('tasks')} />
        <Card testId="my-episodes" icon={Tv} title="الحلقات القادمة وجاهزيتها" rows={todayEpisodes} empty="لا حلقات خلال اليومين القادمين" more={() => onNavigate('episodes')} />
        {(bulletinActor.canEdit || bulletinActor.canApprove || bulletinRows.length > 0) && (
          <Card testId="my-bulletins" icon={Radio} title="قصص النشرات" rows={bulletinRows} empty="لا قصص نشرات تنتظرك" more={() => onNavigate('bulletins')} />
        )}
 {planRows.length > 0 && <Card testId="my-plan" icon={CalendarDays} title="تغطياتي وحجوزاتي" rows={planRows} empty="" more={() => onNavigate('diary')} />}
        <Card testId="my-mentions" icon={AtSign} title="إشارات إليّ (7 أيام)" rows={mentions} empty="لم يُشر إليك أحد مؤخراً" />
      </div>
    </div>
  );
};
