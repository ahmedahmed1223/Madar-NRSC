import { appLocale, zoneOptions } from '../../shared/dateFormat';
import type { NewsArchiveFilters } from '../../shared/newsArchive';
import type { CreateCorrectionInput, NewsCorrection } from '../../shared/newsCorrections';
import { COLLECTIONS } from '../../shared/collections';
import { newId } from '../../shared/ids';
import {
  DEFAULT_BREAKING_HOURS,
  NEWS_INITIAL_STATUSES,
  NEWS_STATUS_LABELS,
  canEditNewsContent,
  isBreakingLive,
  makeNewsSlug,
  transitionDenial,
  contentDenial,
} from '../../shared/newsWorkflow';
import { dataStore } from '../dataStore';
import { apiFetch } from '../http';
import { RbacService } from '../rbacService';
import type { NewsItem, NewsStatus, Story, User, WireItem } from '../../types';
import { ApiDomainDeps, getSnapshot, getStored, setStored, STORAGE_KEYS } from './storeContext';

export interface WireFeedStatus {
  sourceId: string;
  sourceName: string;
  feedUrl: string;
  ok: boolean;
  message: string;
  added: number;
  itemCount: number;
  checkedAt: string;
}

export interface NewsArchivePage {
  total: number;
  page: number;
  pageSize: number;
  activeDays: number;
  items: {
    id: string;
    title: string;
    summary: string;
    status: string;
    categoryName: string;
    authorName: string;
    publishDate: string | null;
    updatedAt: string;
  }[];
  /** «هل تقصد»: a corrected query that finds more, when this one found little or nothing. */
  suggestion?: string;
}

export interface WireStatusInfo {
  pollMinutes: number;
  retentionDays: number;
  feeds: WireFeedStatus[];
}

export interface NewsRevision {
  version: number;
  data: NewsItem;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

export function createNewsApi(deps: ApiDomainDeps) {
  function getNewsCorrections(): NewsCorrection[] {
    return getStored(COLLECTIONS.newsCorrections.storageKey, []);
  }

  async function correctionContext(newsId: string): Promise<{ newsVersion: number; newsTitle: string; newsText: string; records: NewsCorrection[]; historyVersions: number[] }> {
    return (await apiFetch(`/api/v1/news/${encodeURIComponent(newsId)}/corrections`)).data;
  }

  async function registerNewsCorrection(input: CreateCorrectionInput): Promise<NewsCorrection> {
    return (await apiFetch(`/api/v1/news/${encodeURIComponent(input.newsId)}/corrections`, { method: 'POST', json: input })).data;
  }

  function getNews(): NewsItem[] {
    const items = getSnapshot<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    return items.filter((n) => !n.deletedAt);
  }

  function getNewsById(id: string): NewsItem | undefined {
    return getNews().find((n) => n.id === id);
  }

  function saveNews(newsData: Partial<NewsItem> & { expectedUpdatedAt?: string }, user?: User): NewsItem {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const currentUser = user || deps.getCurrentUser();
    const can = (perm: string) => RbacService.hasPermission(currentUser, perm);
    const now = new Date().toISOString();
    const { expectedUpdatedAt, ...data } = newsData;

    if (data.id) {
      const idx = all.findIndex((n) => n.id === data.id);
      if (idx !== -1) {
        const old = all[idx];
        if (expectedUpdatedAt && old.updatedAt && old.updatedAt !== expectedUpdatedAt) {
          throw new Error('عدّل زميل هذا الخبر بعد أن فتحته. حمّل أحدث نسخة من سجل النسخ أو أعد فتح الخبر قبل الحفظ.');
        }
        if (!canEditNewsContent(can, currentUser.id, old)) {
          throw new Error(
            old.status === 'PUBLISHED' || old.status === 'APPROVED'
              ? 'لا يمكنك تعديل خبر معتمد أو منشور دون صلاحية الاعتماد أو النشر.'
              : 'صلاحياتك لا تسمح بتعديل هذا الخبر.'
          );
        }
        if (data.isBreaking !== undefined && !!data.isBreaking !== !!old.isBreaking && !can('news.breaking_push')) {
          throw new Error('عذراً، صلاحياتك لا تسمح بإطلاق الأخبار العاجلة أو إيقافها.');
        }
        const { status: _ignoredStatus, workflowLogs: _ignoredLogs, authorId: _a, authorName: _n, ...editable } = data;
        const updated: NewsItem = { ...old, ...editable, updatedAt: now };
        if (data.title && data.title !== old.title) updated.slug = makeNewsSlug(data.title, old.id);
        if (updated.isBreaking && !old.isBreaking && !updated.breakingUntil) {
          updated.breakingUntil = new Date(Date.now() + (deps.getSettings().breakingDurationHours ?? DEFAULT_BREAKING_HOURS) * 3600_000).toISOString();
        }
        all[idx] = updated;
        setStored(STORAGE_KEYS.NEWS, all);
        deps.logActivity('تعديل خبر', 'NEWS', updated.id, updated.title, `قام ${currentUser.fullName} بتحديث محتوى الخبر.`);
        return updated;
      }
    }

    if (!can('news.create')) throw new Error('صلاحياتك لا تسمح بإنشاء الأخبار.');
    const initialStatus: NewsStatus = NEWS_INITIAL_STATUSES.includes(data.status as NewsStatus) ? (data.status as NewsStatus) : 'DRAFT';
    if (data.isBreaking && !can('news.breaking_push')) {
      throw new Error('عذراً، صلاحياتك لا تسمح بإطلاق الأخبار العاجلة.');
    }

    const newsId = data.id && !all.some((n) => n.id === data.id) ? data.id : newId('nws');
    const title = data.title || 'خبر جديد بدون عنوان';
    const newItem: NewsItem = {
      id: newsId,
      title,
      shortTitle: data.shortTitle || title,
      slug: makeNewsSlug(title, newsId),
      content: data.content || '',
      summary: data.summary || '',
      mainImageUrl: data.mainImageUrl || '',
      digitalPackage: data.digitalPackage,
      videoUrl: data.videoUrl,
      videos: data.videos,
      storyId: data.storyId,
      wireId: data.wireId,
      diaryId: data.diaryId,
      mediaIds: data.mediaIds || [],
      sourceId: data.sourceId || '',
      sourceName: data.sourceName || '',
      categoryId: data.categoryId || '',
      categoryName: data.categoryName || '',
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      priority: data.priority || deps.getSettings().defaultNewsPriority || 'NORMAL',
      status: initialStatus,
      keywords: data.keywords || [],
      locationName: data.locationName || '',
      eventDate: data.eventDate || now,
      isBreaking: !!data.isBreaking,
      breakingUntil: data.isBreaking
        ? data.breakingUntil || new Date(Date.now() + (deps.getSettings().breakingDurationHours ?? DEFAULT_BREAKING_HOURS) * 3600_000).toISOString()
        : undefined,
      internalNotes: data.internalNotes || '',
      messageOrigin: data.messageOrigin,
      workflowLogs: [
        {
          id: newId('log'),
          newsId,
          fromStatus: initialStatus,
          toStatus: initialStatus,
          changedBy: { id: currentUser.id, name: currentUser.fullName, role: currentUser.role },
          comment: 'إنشاء الخبر لأول مرة',
          timestamp: now,
        },
      ],
      viewsCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    all.unshift(newItem);
    setStored(STORAGE_KEYS.NEWS, all);
    deps.logActivity('إنشاء خبر', 'NEWS', newItem.id, newItem.title, `قام ${currentUser.fullName} بإنشاء خبر جديد.`);
    return newItem;
  }

  function updateNewsStatus(
    newsId: string,
    toStatus: NewsStatus,
    userOrComment?: User | string,
    optionalComment?: string,
    opts: { scheduledDate?: string } = {}
  ): NewsItem {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const idx = all.findIndex((n) => n.id === newsId);
    if (idx === -1) throw new Error('الخبر غير موجود');

    const currentUser = typeof userOrComment === 'object' && userOrComment !== null ? userOrComment : deps.getCurrentUser();
    const comment = typeof userOrComment === 'string' ? userOrComment : optionalComment;
    const item = all[idx];
    const fromStatus = item.status;
    if (fromStatus === toStatus) return item;

    const denial =
      transitionDenial((perm) => RbacService.hasPermission(currentUser, perm), currentUser.id, item, toStatus) ||
      contentDenial(item, toStatus)?.message ||
      null;
    if (denial) {
      throw new Error(denial);
    }

    let scheduledDate: string | undefined;
    if (toStatus === 'SCHEDULED') {
      const when = opts.scheduledDate ? new Date(opts.scheduledDate) : null;
      if (!when || !Number.isFinite(when.getTime())) throw new Error('حدد موعداً صالحاً للنشر المجدول');
      if (when.getTime() < Date.now() - 60_000) throw new Error('موعد النشر المجدول يجب أن يكون في المستقبل');
      scheduledDate = when.toISOString();
    }

    const now = new Date().toISOString();
    const by = { id: currentUser.id, name: currentUser.fullName, role: currentUser.role };
    const updated: NewsItem = {
      ...item,
      status: toStatus,
      workflowLogs: [
        ...(item.workflowLogs || []),
        {
          id: newId('log'),
          newsId: item.id,
          fromStatus,
          toStatus,
          changedBy: by,
          comment:
            comment ||
            (scheduledDate
              ? `جدولة النشر في ${new Date(scheduledDate).toLocaleString(appLocale(), zoneOptions())}`
              : `تغيير الحالة إلى ${NEWS_STATUS_LABELS[toStatus]}`),
          timestamp: now,
        },
      ],
      editorId: ['APPROVED', 'PUBLISHED'].includes(toStatus) ? currentUser.id : item.editorId,
      editorName: ['APPROVED', 'PUBLISHED'].includes(toStatus) ? currentUser.fullName : item.editorName,
      updatedAt: now,
    };
    if (toStatus === 'SCHEDULED') updated.scheduledDate = scheduledDate;
    else if (fromStatus === 'SCHEDULED') updated.scheduledDate = undefined; // schedule cancelled or published
    if (toStatus === 'APPROVED' && fromStatus !== 'SCHEDULED') {
      Object.assign(updated, { approvedById: by.id, approvedByName: by.name, approvedAt: now });
    }
    if (toStatus === 'PUBLISHED') {
      Object.assign(updated, { publishedById: by.id, publishedByName: by.name });
      if (!item.publishDate) updated.publishDate = now;
      // A story flagged breaking goes on air for the standard window from the moment it is published.
      if (updated.isBreaking) updated.breakingUntil = new Date(Date.now() + (deps.getSettings().breakingDurationHours ?? DEFAULT_BREAKING_HOURS) * 3600_000).toISOString();
    }
    // Content that leaves the air also leaves the breaking ticker.
    if (['ARCHIVED', 'UNPUBLISHED', 'REJECTED'].includes(toStatus)) {
      updated.isBreaking = false;
      updated.breakingUntil = undefined;
    }

    all[idx] = updated;
    setStored(STORAGE_KEYS.NEWS, all);

    deps.logActivity(
      'تحديث حالة الخبر',
      'NEWS',
      item.id,
      item.title,
      `قام ${currentUser.fullName} بنقل الخبر من [${NEWS_STATUS_LABELS[fromStatus] || fromStatus}] إلى [${NEWS_STATUS_LABELS[toStatus]}]`
    );

    return updated;
  }

  function deleteNews(newsId: string, user?: User): void {
    const currentUser = user || deps.getCurrentUser();
    if (!RbacService.hasPermission(currentUser, 'news.delete')) throw new Error('صلاحياتك لا تسمح بحذف الأخبار.');
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const idx = all.findIndex((n) => n.id === newsId);
    if (idx !== -1) {
      all[idx] = { ...all[idx], deletedAt: new Date().toISOString(), isBreaking: false };
      setStored(STORAGE_KEYS.NEWS, all);
    }
  }

  function getActiveBreakingNews(): NewsItem[] {
    return getNews().filter((n) => isBreakingLive(n));
  }

  function setBreaking(newsId: string, on: boolean, hours = deps.getSettings().breakingDurationHours ?? DEFAULT_BREAKING_HOURS): NewsItem {
    const user = deps.getCurrentUser();
    if (!RbacService.hasPermission(user, 'news.breaking_push')) {
      throw new Error('عذراً، صلاحياتك لا تسمح بإطلاق الأخبار العاجلة أو إيقافها.');
    }
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const idx = all.findIndex((n) => n.id === newsId);
    if (idx === -1) throw new Error('الخبر غير موجود');
    if (on && all[idx].status !== 'PUBLISHED') throw new Error('يجب نشر الخبر قبل إطلاقه على شريط العاجل.');
    all[idx] = {
      ...all[idx],
      isBreaking: on,
      breakingUntil: on ? new Date(Date.now() + hours * 3600_000).toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };
    setStored(STORAGE_KEYS.NEWS, all);
    deps.logActivity(on ? 'إطلاق خبر عاجل' : 'إيقاف خبر عاجل', 'NEWS', newsId, all[idx].title, on ? `عاجل لمدة ${hours} ساعات` : 'أُوقف من الشريط');
    return all[idx];
  }

  // --- STORIES ---
  function getStories(): Story[] {
    return getSnapshot<Story[]>(STORAGE_KEYS.STORIES, []).filter((s) => !s.deletedAt);
  }

  function getStory(id: string): Story | undefined {
    return getStories().find((s) => s.id === id);
  }

  function saveStory(data: Partial<Story>, currentUser: User): Story {
    if (!RbacService.hasPermission(currentUser, 'news.create') && !RbacService.hasPermission(currentUser, 'news.edit_any')) {
      throw new Error('صلاحياتك لا تسمح بإدارة القصص الإخبارية');
    }
    const stories = getStored<Story[]>(STORAGE_KEYS.STORIES, []);
    let savedStory: Story;

    if (data.id) {
      const idx = stories.findIndex((s) => s.id === data.id);
      if (idx !== -1) {
        savedStory = { ...stories[idx], ...data, updatedAt: new Date().toISOString() } as Story;
        stories[idx] = savedStory;
        deps.logActivity('UPDATE', 'STORY', savedStory.id, savedStory.title, 'تحديث تغطية إخبارية');
      } else {
        throw new Error('Story not found');
      }
    } else {
      savedStory = {
        id: newId('s'),
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: currentUser.id,
      } as Story;
      stories.unshift(savedStory);
      deps.logActivity('CREATE', 'STORY', savedStory.id, savedStory.title, 'إنشاء تغطية إخبارية جديدة');
    }

    setStored(STORAGE_KEYS.STORIES, stories);
    return savedStory;
  }

  function deleteStory(id: string, currentUser: User): void {
    if (!RbacService.hasPermission(currentUser, 'news.delete')) throw new Error('صلاحياتك لا تسمح بحذف القصص الإخبارية');
    const stories = getStored<Story[]>(STORAGE_KEYS.STORIES, []);
    const idx = stories.findIndex((s) => s.id === id);
    if (idx === -1) return;
    stories[idx] = { ...stories[idx], deletedAt: new Date().toISOString() } as Story;
    setStored(STORAGE_KEYS.STORIES, stories);
    deps.logActivity('DELETE', 'STORY', id, stories[idx].title, 'حذف قصة إخبارية');
  }

  // --- NEWS ARCHIVE ---
  async function searchNewsArchive(query: string, page = 1, filters: NewsArchiveFilters = {}): Promise<NewsArchivePage> {
    const params = new URLSearchParams({ q: query, page: String(page) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const res = await apiFetch<{ data: NewsArchivePage }>(`/api/v1/archive/news?${params}`);
    return res.data;
  }

  async function getArchivedNews(id: string): Promise<NewsItem> {
    const res = await apiFetch<{ data: NewsItem }>(`/api/v1/archive/news/${encodeURIComponent(id)}`);
    return res.data;
  }

  async function reactivateArchivedNews(id: string): Promise<void> {
    await apiFetch(`/api/v1/archive/news/${encodeURIComponent(id)}/reactivate`, { method: 'POST', json: {} });
    await dataStore.pull();
  }

  // --- AGENCY WIRES ---
  function getWires(): WireItem[] {
    return getSnapshot<WireItem[]>(COLLECTIONS.wires.storageKey, []);
  }

  async function getWireStatus(): Promise<WireStatusInfo> {
    const res = await apiFetch<{ data: WireStatusInfo }>('/api/v1/wires/status');
    return res.data;
  }

  async function refreshWires(): Promise<WireFeedStatus[]> {
    const res = await apiFetch<{ data: { feeds: WireFeedStatus[] } }>('/api/v1/wires/refresh', { method: 'POST', json: {} });
    await dataStore.pull();
    return res.data.feeds;
  }

  async function testFeed(url: string): Promise<{ title: string; itemCount: number; sample: string[] }> {
    const res = await apiFetch<{ data: { title: string; itemCount: number; sample: string[] } }>('/api/v1/wires/test', { method: 'POST', json: { url } });
    return res.data;
  }

  // --- REVISION HISTORY & TRASH ---
  async function getNewsHistory(newsId: string): Promise<NewsRevision[]> {
    const res = await apiFetch<{ data: NewsRevision[] }>(`/api/v1/history/news/${encodeURIComponent(newsId)}`);
    return res.data;
  }

  function getDeletedNews(): NewsItem[] {
    return getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []).filter((n) => !!n.deletedAt);
  }

  function restoreNews(newsId: string): NewsItem {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const idx = all.findIndex((n) => n.id === newsId);
    if (idx === -1) throw new Error('الخبر غير موجود');
    if (!RbacService.hasPermission(deps.getCurrentUser(), 'news.delete')) {
      throw new Error('صلاحياتك لا تسمح باستعادة الأخبار المحذوفة');
    }
    all[idx] = { ...all[idx], deletedAt: null, updatedAt: new Date().toISOString() };
    setStored(STORAGE_KEYS.NEWS, all);
    return all[idx];
  }

  return {
    getNewsCorrections,
    correctionContext,
    registerNewsCorrection,
    getNews,
    getNewsById,
    saveNews,
    updateNewsStatus,
    deleteNews,
    getActiveBreakingNews,
    setBreaking,
    getStories,
    getStory,
    saveStory,
    deleteStory,
    searchNewsArchive,
    getArchivedNews,
    reactivateArchivedNews,
    getWires,
    getWireStatus,
    refreshWires,
    testFeed,
    getNewsHistory,
    getDeletedNews,
    restoreNews,
  };
}
