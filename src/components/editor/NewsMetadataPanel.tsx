import React from 'react';
import {
  Flame,
  Image as ImageIcon,
  Video,
  Tag,
  MapPin,
  Calendar,
  History,
  X,
  Check,
} from 'lucide-react';
import type { Category, NewsItem, NewsPriority, NewsSource, Story, User } from '../../types';
import type { NewsVideo } from '../../shared/newsVideos';
import { NEWS_STATUS_LABELS } from '../../shared/newsWorkflow';
import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { toLocalInputValue } from '../../shared/dates';
import { GlossaryDatalist } from './WritingAids';
import { CommentThread } from '../comments/CommentThread';
import { AttachmentsPanel } from '../media/AttachmentsPanel';
import { NewsVideosEditor } from '../news/NewsVideosEditor';
import type { RequestDraft } from '../requests/RequestFormPage';

const WORKFLOW_ACTION_LABELS: Record<string, string> = {
  QUALITY_PASSED: 'اجتازت التدقيق',
  REVIEW_CLAIMED: 'استلم المراجعة',
  REVIEW_RELEASED: 'أعاد الخبر إلى طابور المراجعة',
  BREAKING_REQUESTED: 'أرسله عاجلاً من الميدان',
};

const LOCATION_PRESETS = [
  'الرياض',
  'القدس',
  'واشنطن',
  'لندن',
  'القاهرة',
  'دبي',
  'بيروت',
  'جنيف',
  'باريس',
  'إسطنبول',
  'غزة',
  'موسكو',
];

const TRENDING_TAGS = [
  'عاجل',
  'اقتصاد',
  'الشرق_الأوسط',
  'تقنية',
  'بيان_رسمي',
  'مؤتمر_صحفي',
  'قمة_عربية',
  'أسواق_المال',
];

export interface NewsMetadataPanelProps {
  newsItem?: NewsItem | null;
  currentUser: User;
  ro: boolean;
  canEditContent: boolean;
  canBreakingPush: boolean;
  isBreaking: boolean;
  onBreakingChange: (checked: boolean) => void;
  stories: Story[];
  storyId: string;
  onStoryIdChange: (id: string) => void;
  categoryOptions: { category: Category; path: string }[];
  categoryId: string;
  onCategoryIdChange: (id: string) => void;
  sources: NewsSource[];
  sourceId: string;
  onSourceIdChange: (id: string) => void;
  priority: NewsPriority;
  onPriorityChange: (priority: NewsPriority) => void;
  locationName: string;
  onLocationNameChange: (value: string) => void;
  eventDate: string;
  onEventDateChange: (value: string) => void;
  mediaIds: string[];
  onMediaIdsChange: (ids: string[]) => void;
  onRequestMontage: (draft: RequestDraft) => void;
  mainImageUrl: string;
  onMainImageUrlChange: (url: string) => void;
  imagePresets: { label: string; url: string }[];
  videos: NewsVideo[];
  onVideosChange: (videos: NewsVideo[]) => void;
  keywords: string[];
  onKeywordsChange: React.Dispatch<React.SetStateAction<string[]>>;
  tagInput: string;
  onTagInputChange: (value: string) => void;
  onAddTag: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRemoveTag: (tag: string) => void;
}

export const NewsMetadataPanel: React.FC<NewsMetadataPanelProps> = ({
  newsItem,
  currentUser,
  ro,
  canEditContent,
  canBreakingPush,
  isBreaking,
  onBreakingChange,
  stories,
  storyId,
  onStoryIdChange,
  categoryOptions,
  categoryId,
  onCategoryIdChange,
  sources,
  sourceId,
  onSourceIdChange,
  priority,
  onPriorityChange,
  locationName,
  onLocationNameChange,
  eventDate,
  onEventDateChange,
  mediaIds,
  onMediaIdsChange,
  onRequestMontage,
  mainImageUrl,
  onMainImageUrlChange,
  imagePresets,
  videos,
  onVideosChange,
  keywords,
  onKeywordsChange,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}) => {
  return (
    <div className="space-y-5">
      {/* Publishing & Category Box */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
          البيانات الوصفية والتصنيف
        </h3>

        {/* Breaking News Toggle (goes on air once the story is published) */}
        {canBreakingPush && (
          <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-red-600 animate-pulse" />
              <div>
                <span className="text-xs font-bold text-red-900 block">خبر عاجل للبث</span>
                <span className="text-2xs text-red-700 block">يظهر على شريط العاجل عند نشره ولمدة 4 ساعات</span>
              </div>
            </div>
            <input
              type="checkbox"
              aria-label="خبر عاجل للبث"
              disabled={ro}
              checked={isBreaking}
              onChange={(e) => onBreakingChange(e.target.checked)}
              className="w-5 h-5 text-red-600 rounded-md focus:ring-red-500 cursor-pointer"
            />
          </div>
        )}

        {/* Link to a running coverage (story) */}
        <div>
          <label htmlFor="news-story-select" className="block text-xs font-bold text-slate-700 mb-1">القصة / التغطية المرتبطة</label>
          <select
            id="news-story-select"
            disabled={ro}
            value={storyId}
            onChange={(e) => onStoryIdChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800"
          >
            <option value="">— بدون قصة —</option>
            {stories
              .filter((st) => st.status !== 'ARCHIVED' || st.id === storyId)
              .map((st) => (
                <option key={st.id} value={st.id}>
                  {st.title}
                </option>
              ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <label htmlFor="news-category-select" className="block text-xs font-bold text-slate-700 mb-1">تصنيف الخبر *</label>
          <select
            id="news-category-select"
            disabled={ro}
            value={categoryId}
            onChange={(e) => onCategoryIdChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          >
            {categoryOptions.map(({ category, path }) => (
              <option key={category.id} value={category.id}>
                {path}
              </option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label htmlFor="news-source-select" className="block text-xs font-bold text-slate-700 mb-1">مصدر الخبر *</label>
          <select
            id="news-source-select"
            disabled={ro}
            value={sourceId}
            onChange={(e) => onSourceIdChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div>
          <label htmlFor="news-priority-select" className="block text-xs font-bold text-slate-700 mb-1">الأولوية والخطورة</label>
          <select
            id="news-priority-select"
            disabled={ro}
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value as NewsPriority)}
            className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs bg-white font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          >
            <option value="URGENT">🔴 عاجل جداً</option>
            <option value="HIGH">🟠 أولوية عالية</option>
            <option value="NORMAL">🔵 أولوية عادية</option>
            <option value="LOW">⚪ أولوية منخفضة</option>
          </select>
        </div>

        {/* Location & Event Date with Quick-Select Chips */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="news-location-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                مكان الحدث والمكتب
              </label>
              {locationName && !ro && (
                <button
                  type="button"
                  onClick={() => onLocationNameChange('')}
                  className="inline-flex items-center min-h-6 px-1.5 rounded-md text-2xs text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                >
                  مسح
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="news-location-input"
                type="text"
                list="newsroom-glossary"
                readOnly={ro}
                value={locationName}
                onChange={(e) => onLocationNameChange(e.target.value)}
                placeholder="مثال: الرياض، القاهرة، جنيف..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <GlossaryDatalist id="newsroom-glossary" />
            </div>
            {/* Location Quick Presets */}
            {!ro && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {LOCATION_PRESETS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => onLocationNameChange(loc)}
                    className={`text-2xs min-h-6 px-2 py-0.5 rounded-md transition-all ${
                      locationName === loc
                        ? 'bg-blue-600 text-white font-bold'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="news-event-date-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                تاريخ وتوقيت وقوع الحدث
              </label>
              {!ro && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onEventDateChange(toLocalInputValue(new Date()))}
                    className="text-2xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100"
                  >
                    الآن
                  </button>
                  <button
                    type="button"
                    onClick={() => onEventDateChange(toLocalInputValue(new Date(Date.now() - 30 * 60000)))}
                    className="text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200"
                  >
                    -30د
                  </button>
                </div>
              )}
            </div>
            <input
              id="news-event-date-input"
              type="datetime-local"
              value={eventDate}
              readOnly={ro}
              onChange={(e) => onEventDateChange(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              dir="ltr"
            />
          </div>
        </div>
      </div>

      {/* Team discussion */}
      {newsItem?.id && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <CommentThread target={{ kind: 'news', id: newsItem.id, title: newsItem.title }} currentUser={currentUser} />
        </div>
      )}

      {/* Workflow Timeline */}
      {newsItem && newsItem.workflowLogs && newsItem.workflowLogs.length > 0 && (
        <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-200 pb-2">
            <History className="w-4 h-4 text-slate-500" />
            سجل الاعتماد والمراجعة
          </h3>
          <div className="relative pl-2 pr-4 space-y-4 before:content-[''] before:absolute before:right-2 before:top-2 before:bottom-0 before:w-0.5 before:bg-slate-200">
            {newsItem.workflowLogs.map((log) => (
              <div key={log.id} className="relative flex items-start gap-3 text-xs">
                <span className="absolute -right-[19px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white shadow-xs" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <strong className="text-slate-800 font-semibold">{log.changedBy.name}</strong>
                    <span className="text-2xs text-slate-500 font-mono">
                      {new Date(log.timestamp).toLocaleString(appLocale(), {
                        ...zoneOptions(),
                        hour: '2-digit',
                        minute: '2-digit',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  {log.action ? (
                    <p className="text-2xs font-bold text-emerald-800">{WORKFLOW_ACTION_LABELS[log.action] || log.action}</p>
                  ) : (
                    <p className="text-2xs text-slate-600">
                      غيّر الحالة إلى:{' '}
                      <span className="font-bold text-blue-700 bg-blue-50 px-1 rounded">
                        {NEWS_STATUS_LABELS[log.toStatus] || log.toStatus}
                      </span>
                    </p>
                  )}
                  {log.comment && (
                    <p className="text-2xs text-slate-500 italic bg-white p-1.5 rounded border border-slate-100 mt-1">
                      "{log.comment}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Media Links & Presets */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
          الوسائط المرفقة وسيرفرات البث
        </h3>

        <AttachmentsPanel
          mediaIds={mediaIds}
          onChange={onMediaIdsChange}
          currentUser={currentUser}
          directUpload
          readOnly={!canEditContent}
          onRequestMontage={
            newsItem?.id
              ? (m) =>
                  onRequestMontage({
                    type: 'MONTAGE',
                    title: `مونتاج: ${m.title || m.fileName}`,
                    details: `المادة الخام في المكتبة: ${m.title || m.fileName}`,
                    sourceMediaIds: [m.id],
                    link: { kind: 'news', newsId: newsItem.id, title: newsItem.title },
                  })
              : undefined
          }
        />

        {/* Image URL */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="news-image-url-input" className="block text-xs font-bold text-slate-700 flex items-center gap-1">
              <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
              رابط الصورة البارزة (URL)
            </label>
            {mainImageUrl && !ro && (
              <button
                type="button"
                onClick={() => onMainImageUrlChange('')}
                className="inline-flex items-center min-h-6 px-1.5 rounded-md text-2xs text-slate-500 hover:text-rose-600 hover:bg-rose-50"
              >
                مسح
              </button>
            )}
          </div>

          <input
            id="news-image-url-input"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck="false"
            value={mainImageUrl}
            readOnly={ro}
            onChange={(e) => onMainImageUrlChange(e.target.value)}
            placeholder="https://...jpg"
            className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            dir="ltr"
          />

          {/* Recent images from the media library */}
          {imagePresets.length > 0 && !ro && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-2xs text-slate-500 font-bold">من مكتبة الوسائط:</span>
              {imagePresets.map((img) => (
                <button
                  key={img.label}
                  type="button"
                  onClick={() => onMainImageUrlChange(img.url)}
                  className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors"
                >
                  {img.label}
                </button>
              ))}
            </div>
          )}

          {mainImageUrl && (
            <div className="relative mt-2 rounded-xl overflow-hidden border border-slate-200 group">
              <img
                src={mainImageUrl}
                alt="معاينة الصورة"
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-2xs text-white rounded">
                إطار 16:9
              </div>
            </div>
          )}
        </div>

        {/* Video clips in playout order */}
        <div>
          <p className="block text-xs font-bold text-slate-700 flex items-center gap-1 mb-1">
            <Video className="w-3.5 h-3.5 text-slate-500" />
            مقاطع الفيديو (بترتيب العرض)
          </p>
          <NewsVideosEditor videos={videos} onChange={onVideosChange} disabled={!canEditContent} />
        </div>
      </div>

      {/* Keywords / Tags with Trending Suggestions */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <label htmlFor="news-tag-input" className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 cursor-pointer">
            <Tag className="w-3.5 h-3.5 text-blue-500" />
            الكلمات المفتاحية والوسوم
          </label>
          {keywords.length > 0 && !ro && (
            <button
              type="button"
              onClick={() => onKeywordsChange([])}
              className="inline-flex items-center min-h-6 px-1.5 rounded-md text-2xs text-slate-500 hover:text-rose-600 hover:bg-rose-50"
            >
              مسح الكل
            </button>
          )}
        </div>

        {!ro && (
          <div className="relative">
            <input
              id="news-tag-input"
              type="text"
              value={tagInput}
              onChange={(e) => onTagInputChange(e.target.value)}
              onKeyDown={onAddTag}
              placeholder="اكتب الوسم واضغط Enter للإضافة..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>
        )}

        {/* Trending Suggestions */}
        {!ro && (
          <div>
            <span className="text-2xs text-slate-500 font-bold block mb-1">
              وسوم مقترحة وشائعة:
            </span>
            <div className="flex flex-wrap gap-1">
              {TRENDING_TAGS.map((t) => {
                const alreadyAdded = keywords.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (!alreadyAdded) {
                        onKeywordsChange((prev) => [...prev, t]);
                      }
                    }}
                    disabled={alreadyAdded}
                    className={`text-2xs px-2 py-0.5 rounded-full transition-all flex items-center gap-0.5 ${
                      alreadyAdded
                        ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                        : 'bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium'
                    }`}
                  >
                    <span>#{t}</span>
                    {alreadyAdded && <Check className="w-2.5 h-2.5 text-slate-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {ro && keywords.length === 0 && <p className="text-2xs text-slate-500">لا وسوم.</p>}

        {/* Active Tags */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
            {keywords.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white shadow-2xs"
              >
                <span>#{tag}</span>
                {!ro && (
                  <button
                    type="button"
                    onClick={() => onRemoveTag(tag)}
                    className="hover:text-amber-200 text-white"
                    title="حذف الوسم"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
