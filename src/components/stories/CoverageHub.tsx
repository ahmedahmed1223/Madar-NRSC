import { arabicDate, stationTimeZone } from '../../shared/dates';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React, { useState } from 'react';
import { ExternalLink, FileText, Film, ListVideo, Plus, ArrowLeftRight } from 'lucide-react';
import type { MediaFile, NewsItem, Story, User } from '../../types';
import { apiService } from '../../services/api';
import { useLiveData } from '../../hooks/useLiveData';
import { CommentThread } from '../comments/CommentThread';
import { mediaIcon } from '../media/MediaPicker';
import { NEWS_STATUS_LABELS } from '../../shared/newsWorkflow';
import { departmentName } from '../../shared/departments';
import { requestStatusName, requestTypeOf, videoStatusName } from '../../shared/production';
import { FilterTabs } from '../common/FilterTabs';
import { CoverageWarRoom } from './CoverageWarRoom';
import { videosOf } from '../../shared/newsVideos';

interface CoverageHubProps {
  story: Story;
  newsList: NewsItem[];
  currentUser: User;
  canCreateNews: boolean;
  /** May edit the coverage itself (news.create or news.edit_any, as the server's stories policy). */
  canManage: boolean;
  onOpenNews?: (id: string) => void;
  onCreateNews?: () => void;
  onOpenEpisode?: (id: string) => void;
  onEdit: () => void;
}

const STORY_STATUS_LABELS: Record<string, string> = { ACTIVE: 'نشطة', RESOLVED: 'مغلقة', ARCHIVED: 'مؤرشفة' };

/** Everything about one coverage in one place: stories, media, requests, episodes and discussion. */
export const CoverageHub: React.FC<CoverageHubProps> = ({ story, newsList, currentUser, canCreateNews, canManage, onOpenNews, onCreateNews, onOpenEpisode, onEdit }) => {
  useLiveData(['requests', 'media', 'episodes', 'comments', 'onAir', 'settings', 'productionCards', 'bulletins', 'bulletinStories', 'guests'], 30_000);
  const [tab, setTab] = useState<'file' | 'room'>('file');
  const items = newsList.filter((n) => !n.deletedAt && n.storyId === story.id);
  const newsIds = new Set(items.map((n) => n.id));
  const library = apiService.getMedia();
  const mediaIds = new Set(items.flatMap(n => [...(n.mediaIds || []), ...videosOf(n).map(video => video.mediaId)]));
  const media: MediaFile[] = library.filter(file => mediaIds.has(file.id));
  const segments = apiService
    .getEpisodes()
    .flatMap((e) => (e.rundown || []).filter((s) => s.newsId && newsIds.has(s.newsId)).map((s) => ({ episode: e, segment: s })));
  const segmentKeys = new Set(segments.map(({ episode, segment }) => `${episode.id}:${segment.id}`));
  const episodeIds = new Set(segments.map(({ episode }) => episode.id));
  const requests = apiService.getRequests().filter(({ link }) => link && ((link.newsId && newsIds.has(link.newsId)) || segmentKeys.has(`${link.episodeId}:${link.segmentId}`)));
  const bulletinStories = tab === 'room' ? apiService.getBulletinStories() : [];
  const bulletinIds = new Set(bulletinStories.flatMap(story => story.newsId && newsIds.has(story.newsId) ? [story.bulletinId] : []));
  const cards = tab === 'room' ? apiService.getCards().filter(({ target }) => target && ({ news: newsIds, episode: episodeIds, bulletin: bulletinIds }[target.kind]).has(target.id)) : [];

  const Section: React.FC<{ icon: any; title: string; count: number; children: React.ReactNode; action?: React.ReactNode }> = ({ icon: Icon, title, count, children, action }) => (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <Icon className="w-4 h-4 text-blue-600" />
          {title} ({count})
        </h3>
        {action}
      </div>
      {children}
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2">
        {story.description && <p className="text-slate-700 leading-relaxed text-sm">{story.description}</p>}
        <div className="flex flex-wrap items-center gap-4 text-slate-500 pt-2 border-t border-slate-200">
          <span>التصنيف: <strong>{story.categoryName || 'عام'}</strong></span>
          <span>الموقع: <strong>{story.locationName || 'غير محدد'}</strong></span>
          <span>الحالة: <strong>{STORY_STATUS_LABELS[story.status] || story.status}</strong></span>
          {canManage && (
            <button type="button" onClick={onEdit} className="mr-auto min-h-11 px-3 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100">
              تعديل بيانات التغطية
            </button>
          )}
        </div>
      </div>

      <FilterTabs<'file' | 'room'> label="عرض التغطية" active={tab} onChange={setTab} tabs={[{ id: 'file', label: 'ملف التغطية', tone: 'blue' }, { id: 'room', label: 'غرفة العمليات', tone: 'blue' }]} />
      {tab === 'room' ? <CoverageWarRoom coverage={story} news={items} media={media} requests={requests} segments={segments} sessions={apiService.getOnAirStates()}
        comments={apiService.getComments({ kind: 'story', id: story.id })} cards={cards} zone={stationTimeZone(apiService.getSettings().defaultTimezone)}
        bulletins={apiService.getBulletins().filter(bulletin => bulletinIds.has(bulletin.id))} bulletinStories={bulletinStories.filter(story => bulletinIds.has(story.bulletinId))}
        guestDirectory={apiService.getGuests()} /> :
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          icon={FileText}
          title="الأخبار"
          count={items.length}
          action={
            canCreateNews && onCreateNews ? (
              <button type="button" onClick={onCreateNews} className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                خبر جديد في التغطية
              </button>
            ) : undefined
          }
        >
          {items.length === 0 && <p className="text-2xs text-slate-500">لا توجد أخبار في هذه التغطية بعد.</p>}
          <ul className="space-y-1.5">
            {items.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-blue-300">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-slate-800 truncate">{n.title}</span>
                  <span className="text-2xs text-slate-500">
                    {NEWS_STATUS_LABELS[n.status] || n.status} · {n.authorName || ''} · {new Date(n.updatedAt || n.createdAt).toLocaleDateString(appLocale(), zoneOptions())}
                  </span>
                </div>
                {onOpenNews && (
                  <button type="button" onClick={() => onOpenNews(n.id)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg shrink-0" title="فتح الخبر">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={Film} title="الوسائط" count={media.length}>
          {media.length === 0 && <p className="text-2xs text-slate-500">لا توجد وسائط مرفقة بأخبار التغطية.</p>}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {media.map((m) => {
              const Icon = mediaIcon(m.mediaType);
              return (
                <li key={m.id} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 text-xs">
                  <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                  <a href={m.url || m.fileUrl} target="_blank" rel="noopener noreferrer" className="truncate font-bold text-slate-800 hover:underline">
                    {m.title || m.fileName}
                  </a>
                  {m.mediaType === 'VIDEO' && <span className="text-2xs text-slate-500 shrink-0 mr-auto">{videoStatusName(m.videoStatus)}</span>}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section icon={ArrowLeftRight} title="طلبات الأقسام" count={requests.length}>
          {requests.length === 0 && <p className="text-2xs text-slate-500">لا توجد طلبات مرتبطة بأخبار التغطية.</p>}
          <ul className="space-y-1.5">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 text-xs">
                <span className="px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 font-bold shrink-0">{requestTypeOf(r.type)?.name}</span>
                <span className="truncate text-slate-800">{r.title}</span>
                <span className="text-2xs text-slate-500 shrink-0 mr-auto">
                  {departmentName(r.departmentId)} · {requestStatusName(r.status)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={ListVideo} title="في الحلقات" count={segments.length}>
          {segments.length === 0 && <p className="text-2xs text-slate-500">لم تُستخدم أخبار التغطية في أي فقرة بعد.</p>}
          <ul className="space-y-1.5">
            {segments.map(({ episode, segment }) => (
              <li key={`${episode.id}:${segment.id}`} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 text-xs">
                <span className="min-w-0">
                  <span className="block font-bold text-slate-800 truncate">{segment.title}</span>
                  <span className="text-2xs text-slate-500">
                    {episode.programName} — {episode.title} · {arabicDate(episode.broadcastDate)}
                  </span>
                </span>
                {onOpenEpisode && (
                  <button type="button" onClick={() => onOpenEpisode(episode.id)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg shrink-0 mr-auto" title="فتح الحلقة">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>}

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <CommentThread target={{ kind: 'story', id: story.id, title: story.title }} currentUser={currentUser} title="نقاش فريق التغطية" />
      </div>
    </div>
  );
};
