import { Radio, Siren, Users } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { coverageFieldReporters, coverageTimeline, upcomingBulletinGuests, upcomingCoverageGuests, type CoverageSegment } from '../../shared/coverageWarRoom';
import type { Bulletin, BulletinStory } from '../../shared/bulletins';
import { FIELD_SIGNAL_PROVIDERS, FIELD_SIGNAL_STATUSES, bookingStatusName, connectionName } from '../../shared/episodePlan';
import { isBreakingLive } from '../../shared/newsWorkflow';
import { isRequestClosed, requestStatusName, type DeptRequest } from '../../shared/production';
import type { TeamComment } from '../../shared/comments';
import type { OnAirState } from '../../shared/onair';
import type { Guest, MediaFile, NewsItem, Story } from '../../types';
import type { ProductionCard } from '../../shared/productionCards';

interface Props {
  coverage: Story;
  news: NewsItem[];
  media: MediaFile[];
  requests: DeptRequest[];
  segments: CoverageSegment[];
  sessions: OnAirState[];
  comments: TeamComment[];
  cards: ProductionCard[];
  bulletins: Bulletin[];
  bulletinStories: BulletinStory[];
  guestDirectory: Guest[];
  zone?: string;
}

const linkStyle = 'font-semibold text-blue-700 hover:underline focus-visible:outline focus-visible:outline-blue-600 break-words';
const showLink = (episodeId: string) => `/episodes/${encodeURIComponent(episodeId)}`;

function RoomPanel({ title, children }: PropsWithChildren<{ title: string }>) {
  return <section aria-label={title} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="mb-3 text-sm font-bold text-slate-800">{title}</h3>
    {children}
  </section>;
}

export function CoverageWarRoom({ coverage, news, media, requests, segments, sessions, comments, cards, bulletins, bulletinStories, guestDirectory, zone }: Props) {
  const now = Date.now();
  const episodes = [...new Map(segments.map(({ episode }) => [episode.id, episode])).values()];
  const guests = [
    ...upcomingCoverageGuests(episodes, now, zone).map(guest => ({ id: guest.id, name: guest.name, at: guest.at, title: guest.episodeTitle,
      url: showLink(guest.episodeId), connection: connectionName(guest.connectionType), status: bookingStatusName(guest.status) })),
    ...upcomingBulletinGuests(bulletins, bulletinStories, guestDirectory, now, zone).map(guest => ({ id: `bulletin:${guest.id}`, name: guest.name, at: guest.at, title: guest.title,
      url: `/bulletins/${encodeURIComponent(guest.bulletinId)}`, connection: guest.phone ? connectionName('PHONE') : 'ربط عن بُعد', status: bookingStatusName('CONFIRMED') })),
  ].sort((a, b) => a.at - b.at);
  const reports = coverageFieldReporters(segments, sessions, requests);
  const timeline = coverageTimeline(coverage, news, requests, media, comments, { segments, sessions, cards });
  const urgentNews = news.filter(item => isBreakingLive(item, now) || (['URGENT', 'CRITICAL'].includes(item.priority) && !['ARCHIVED', 'REJECTED'].includes(item.status)));
  const urgentRequests = requests.filter(item => item.priority === 'URGENT' && !isRequestClosed(item.status));
  const urgentCards = cards.filter(item => item.priority === 'URGENT' && item.status === 'OPEN');
  const dateTime = (date: number | string) => new Date(date).toLocaleString(appLocale(), { ...zoneOptions(), ...(zone ? { timeZone: zone } : {}), dateStyle: 'short', timeStyle: 'short' });

  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
    <RoomPanel title="الخط الزمني المشترك">
      {timeline.length ? <ol aria-label="آخر أحداث التغطية" className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto pe-2 text-xs">
        {timeline.map(event => <li key={event.id} className="space-y-1 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <b className="text-slate-700">{event.label}</b>
            <time dateTime={event.at} className="text-slate-600">{dateTime(event.at)}</time>
          </div>
          {event.link ? <a href={event.link} className={linkStyle}>{event.detail}</a> : <p className="break-words text-slate-700">{event.detail}</p>}
        </li>)}
      </ol> : <p className="text-xs text-slate-600">لا توجد أحداث مسجلة.</p>}
    </RoomPanel>
    <div className="grid gap-4">
      <RoomPanel title="المواد العاجلة المرتبطة">
        {urgentNews.length || urgentRequests.length || urgentCards.length ? <ul className="space-y-2 text-xs">
          {urgentNews.map(item => <li key={item.id} className="flex items-start gap-2"><Siren aria-hidden="true" className="size-4 shrink-0 text-rose-700" />
            <a href={`/news/${encodeURIComponent(item.id)}`} className={linkStyle}>{item.title}</a>
          </li>)}
          {urgentRequests.map(item => <li key={item.id} className="flex items-start gap-2"><Siren aria-hidden="true" className="size-4 shrink-0 text-rose-700" />
            <a href={`/requests/${encodeURIComponent(item.id)}`} className={linkStyle}>{item.title}</a><span className="text-slate-600">{requestStatusName(item.status)}</span>
          </li>)}
          {urgentCards.map(item => <li key={item.id} className="flex items-start gap-2"><Siren aria-hidden="true" className="size-4 shrink-0 text-rose-700" />
            <a href={`/cards/${encodeURIComponent(item.id)}`} className={linkStyle}>{item.title}</a><span className="text-slate-600">تكليف إنتاجي</span>
          </li>)}
        </ul> : <p className="text-xs text-slate-600">لا توجد مواد عاجلة مرتبطة.</p>}
      </RoomPanel>
      <RoomPanel title="الضيوف المؤكدون خلال 3 ساعات">
        {guests.length ? <ul className="divide-y divide-slate-100 text-xs">
          {guests.map(guest => <li key={guest.id} className="flex gap-2 py-2">
            <Users aria-hidden="true" className="size-4 shrink-0 text-blue-700" />
            <div className="min-w-0 space-y-0.5 text-slate-700">
              <strong>{guest.name}</strong> · <a href={guest.url} className={linkStyle}>{guest.title}</a>
              <p>{dateTime(guest.at)} · {guest.connection} · {guest.status}</p>
            </div>
          </li>)}
        </ul> : <p className="text-xs text-slate-600">لا ضيوف مؤكدون في الحلقات والنشرات المرتبطة خلال هذه المدة.</p>}
      </RoomPanel>
      <RoomPanel title="المراسلون والربط الميداني">
        {reports.length ? <ul className="divide-y divide-slate-100 text-xs">
          {reports.map(report => <li key={report.id} className="flex gap-2 py-2">
            <Radio aria-hidden="true" className={`size-4 shrink-0 ${report.onAir ? 'text-rose-700' : 'text-blue-700'}`} />
            <div className="min-w-0 space-y-0.5 text-slate-700">
              <strong>{report.name || 'بانتظار تعيين مراسل'}</strong> · <a href={showLink(report.episodeId)} className={linkStyle}>{report.title}</a>
              {report.location && <p>{report.location}</p>}
              <p>{report.signalProvider && `${FIELD_SIGNAL_PROVIDERS[report.signalProvider]} · `}{report.signalStatus ? `${FIELD_SIGNAL_STATUSES[report.signalStatus]} (يدوي)` : 'لم يُفحص الاتصال'}</p>
              {report.onAir && <b className="text-rose-700">الفقرة على الهواء</b>}
            </div>
          </li>)}
        </ul> : <p className="text-xs text-slate-600">لا توجد فقرات ميدانية مرتبطة.</p>}
      </RoomPanel>
    </div>
  </div>;
}
