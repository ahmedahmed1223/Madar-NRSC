import { arabicDate } from '../../shared/dates';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import React from 'react';
import { ExternalLink, FileText, Film, ListVideo, Plus, ArrowLeftRight } from 'lucide-react';
import type { NewsItem, Story, User } from '../../types';
import { apiService } from '../../services/api';
import { useLiveData } from '../../hooks/useLiveData';
import { CommentThread } from '../comments/CommentThread';
import { mediaIcon } from '../media/MediaPicker';
import { NEWS_STATUS_LABELS } from '../../shared/newsWorkflow';
import { departmentName } from '../../shared/departments';
import { requestStatusName, requestTypeOf, videoStatusName } from '../../shared/production';

interface CoverageHubProps {
  story: Story;
  newsList: NewsItem[];
  currentUser: User;
  canCreateNews: boolean;
  onOpenNews?: (id: string) => void;
  onCreateNews?: () => void;
  onOpenEpisode?: (id: string) => void;
  onEdit: () => void;
}

/** Everything about one coverage in one place: stories, media, requests, episodes and discussion. */
export const CoverageHub: React.FC<CoverageHubProps> = ({ story, newsList, currentUser, canCreateNews, onOpenNews, onCreateNews, onOpenEpisode, onEdit }) => {
  useLiveData(['requests', 'media', 'episodes', 'comments']);
  const items = newsList.filter((n) => n.storyId === story.id);
  const newsIds = new Set(items.map((n) => n.id));
  const library = apiService.getMedia();
  const mediaIds = [...new Set(items.flatMap((n) => n.mediaIds || []))];
  const media = mediaIds.map((id) => library.find((m) => m.id === id)).filter(Boolean) as any[];
  const requests = apiService.getRequests().filter((r) => r.link?.newsId && newsIds.has(r.link.newsId));
  const segments = apiService
    .getEpisodes()
    .flatMap((e) => (e.rundown || []).filter((s) => s.newsId && newsIds.has(s.newsId)).map((s) => ({ episode: e, segment: s })));

  const Section: React.FC<{ icon: any; title: string; count: number; children: React.ReactNode; action?: React.ReactNode }> = ({ icon: Icon, title, count, children, action }) => (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <Icon className="w-4 h-4 text-indigo-600" />
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
          <span>الحالة: <strong>{story.status === 'ACTIVE' ? 'نشطة' : 'مغلقة'}</strong></span>
          <button type="button" onClick={onEdit} className="mr-auto px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100">
            تعديل بيانات التغطية
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          icon={FileText}
          title="الأخبار"
          count={items.length}
          action={
            canCreateNews && onCreateNews ? (
              <button type="button" onClick={onCreateNews} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                خبر جديد في التغطية
              </button>
            ) : undefined
          }
        >
          {items.length === 0 && <p className="text-[11px] text-slate-400">لا توجد أخبار في هذه التغطية بعد.</p>}
          <ul className="space-y-1.5">
            {items.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 hover:border-indigo-300">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-slate-800 truncate">{n.title}</span>
                  <span className="text-[10px] text-slate-500">
                    {NEWS_STATUS_LABELS[n.status] || n.status} · {n.authorName || ''} · {new Date(n.updatedAt || n.createdAt).toLocaleDateString(appLocale(), zoneOptions())}
                  </span>
                </div>
                {onOpenNews && (
                  <button type="button" onClick={() => onOpenNews(n.id)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg shrink-0" title="فتح الخبر">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={Film} title="الوسائط" count={media.length}>
          {media.length === 0 && <p className="text-[11px] text-slate-400">لا توجد وسائط مرفقة بأخبار التغطية.</p>}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {media.map((m) => {
              const Icon = mediaIcon(m.mediaType);
              return (
                <li key={m.id} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 text-xs">
                  <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                  <a href={m.url || m.fileUrl} target="_blank" rel="noopener noreferrer" className="truncate font-bold text-slate-800 hover:underline">
                    {m.title || m.fileName}
                  </a>
                  {m.mediaType === 'VIDEO' && <span className="text-[10px] text-slate-500 shrink-0 mr-auto">{videoStatusName(m.videoStatus)}</span>}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section icon={ArrowLeftRight} title="طلبات الأقسام" count={requests.length}>
          {requests.length === 0 && <p className="text-[11px] text-slate-400">لا توجد طلبات مرتبطة بأخبار التغطية.</p>}
          <ul className="space-y-1.5">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 text-xs">
                <span className="px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 font-bold shrink-0">{requestTypeOf(r.type)?.name}</span>
                <span className="truncate text-slate-800">{r.title}</span>
                <span className="text-[10px] text-slate-500 shrink-0 mr-auto">
                  {departmentName(r.departmentId)} · {requestStatusName(r.status)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={ListVideo} title="في الحلقات" count={segments.length}>
          {segments.length === 0 && <p className="text-[11px] text-slate-400">لم تُستخدم أخبار التغطية في أي فقرة بعد.</p>}
          <ul className="space-y-1.5">
            {segments.map(({ episode, segment }) => (
              <li key={`${episode.id}:${segment.id}`} className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 text-xs">
                <span className="min-w-0">
                  <span className="block font-bold text-slate-800 truncate">{segment.title}</span>
                  <span className="text-[10px] text-slate-500">
                    {episode.programName} — {episode.title} · {arabicDate(episode.broadcastDate)}
                  </span>
                </span>
                {onOpenEpisode && (
                  <button type="button" onClick={() => onOpenEpisode(episode.id)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg shrink-0 mr-auto" title="فتح الحلقة">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <CommentThread target={{ kind: 'story', id: story.id, title: story.title }} currentUser={currentUser} title="نقاش فريق التغطية" />
      </div>
    </div>
  );
};
