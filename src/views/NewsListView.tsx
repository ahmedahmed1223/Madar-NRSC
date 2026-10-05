import { NewsVideosList } from '../components/news/NewsVideosEditor';
import { videosOf } from '../shared/newsVideos';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { notify } from '../services/notify';
import { canEditNewsContent, embargoLabel, isUnderEmbargo } from '../shared/newsWorkflow';
import { matchesQuery } from '../shared/search';
import { SortTh, sortList, usePersistentSort } from '../components/common/SortHeader';
import { ExportMenu, docContext } from '../components/common/ExportMenu';
import { newsListDoc } from '../services/documents/builders';
import { NEWS_STATUS_LABELS } from '../shared/newsWorkflow';
import { NewsArchiveModal } from '../components/news/NewsArchiveModal';
import { authClient } from '../services/authClient';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  Flame,
  CheckCircle,
  Clock,
  Eye,
  Edit2,
  Trash2,
  ChevronDown,
  Archive,
  Send,
  CheckSquare,
  Square,
  Radio,
  FileText,
  AlertCircle,
  ExternalLink,
  X,
  Lock,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { NewsItem, NewsStatus, NewsPriority, User, Category, NewsSource } from '../types';
import { Badge } from '../components/common/Badge';
import { FilterTabs } from '../components/common/FilterTabs';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { dataStore } from '../services/dataStore';
import { transitionDenial, isBreakingLive } from '../shared/newsWorkflow';
import { isLockActive, EditLock } from '../shared/collections';
import { sanitizeHtml } from '../utils/sanitizeHtml';

interface NewsListViewProps {
  newsList: NewsItem[];
  categories?: Category[];
  sources?: NewsSource[];
  currentUser: User;
  onEditNews: (newsId: string) => void;
  onCreateNews: () => void;
  onUpdateStatus: (newsId: string, toStatus: NewsStatus, comment?: string) => Promise<boolean>;
  onDeleteNews: (newsId: string) => void;
  onToggleBreaking: (newsItem: NewsItem) => void;
  onBulkAction: (newsIds: string[], action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE') => Promise<void>;
  /** Opens the list on a specific tab (e.g. the breaking-news desk). */
  initialTab?: ListTab;
}

type ListTab = 'ALL' | NewsStatus | 'BREAKING' | 'TRASH';

const NEWS_SORT_KEYS = ['updatedAt', 'title', 'category', 'priority', 'author', 'status'] as const;
type NewsSortKey = (typeof NEWS_SORT_KEYS)[number];
const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, MEDIUM: 1, HIGH: 2, URGENT: 3, CRITICAL: 4 };
const STATUS_RANK: Record<string, number> = { DRAFT: 0, IN_PROGRESS: 1, NEEDS_REVISION: 2, UNDER_REVIEW: 3, APPROVED: 4, SCHEDULED: 5, PUBLISHED: 6, UNPUBLISHED: 7, REJECTED: 8, ARCHIVED: 9 };
const newsSortValue = (n: NewsItem, key: NewsSortKey): unknown =>
  key === 'title' ? n.title : key === 'category' ? n.categoryName : key === 'priority' ? PRIORITY_RANK[n.priority] ?? 1 : key === 'author' ? n.authorName : key === 'status' ? STATUS_RANK[n.status] ?? 0 : n.updatedAt;

const PAGE_SIZE = 50;

export const NewsListView: React.FC<NewsListViewProps> = ({
  newsList = [],
  categories = [],
  currentUser,
  onEditNews,
  onCreateNews,
  onUpdateStatus,
  onDeleteNews,
  onToggleBreaking,
  onBulkAction,
  initialTab = 'ALL',
}) => {
  const [activeTab, setActiveTab] = useState<ListTab>(initialTab);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [locks, setLocks] = useState<EditLock[]>(() => apiService.getEditLocks());
  const [deletedNews, setDeletedNews] = useState<NewsItem[]>(() => apiService.getDeletedNews());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedPriority, setSelectedPriority] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const runBulkAction = async (action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE') => {
    if (bulkSubmitting) return;
    setBulkSubmitting(true);
    try {
      await onBulkAction(selectedIds, action);
      setSelectedIds([]);
    } finally {
      setBulkSubmitting(false);
    }
  };
  const [previewNews, setPreviewNews] = useState<NewsItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Status Change with Comment Modal
  const [statusModalNews, setStatusModalNews] = useState<NewsItem | null>(null);
  const [targetStatus, setTargetStatus] = useState<NewsStatus>('APPROVED');
  const [statusComment, setStatusComment] = useState('');

  // Same permission model the server enforces (custom roles and per-user overrides included).
  const can = (perm: string) => RbacService.hasPermission(currentUser, perm);
  const allowed = (item: NewsItem, to: NewsStatus) => transitionDenial(can, currentUser.id, item, to) === null;
  const canPublish = can('news.publish');
  const canApprove = can('news.approve');
  const canDelete = can('news.delete');
  const canManageBreaking = can('news.breaking_push');

  useEffect(
    () =>
      dataStore.subscribe((evt) => {
        if (evt.type !== 'data-changed') return;
        if (evt.collections.includes('editLocks')) setLocks(apiService.getEditLocks());
        if (evt.collections.includes('news')) setDeletedNews(apiService.getDeletedNews());
      }),
    []
  );

  const lockByNewsId = useMemo(() => {
    const map = new Map<string, EditLock>();
    locks.forEach((l) => {
      if (l.collection === 'news' && isLockActive(l) && l.userId !== currentUser.id) map.set(l.entityId, l);
    });
    return map;
  }, [locks, currentUser.id]);

  // Filter logic
  const sourceList = activeTab === 'TRASH' ? deletedNews : newsList || [];
  const [sort, toggleSort] = usePersistentSort<NewsSortKey>('nrcs_sort_news', { key: 'updatedAt', dir: 'desc' }, NEWS_SORT_KEYS);
  const filteredNews = sortList(sourceList.filter((item) => {
    if (activeTab === 'BREAKING') {
      if (!isBreakingLive(item)) return false;
    } else if (activeTab !== 'ALL' && activeTab !== 'TRASH' && item.status !== activeTab) return false;
    if (selectedCategory !== 'ALL' && item.categoryName !== selectedCategory) return false;
    if (selectedPriority !== 'ALL' && item.priority !== selectedPriority) return false;
    if (searchQuery.trim()) {
      if (!matchesQuery(searchQuery, item.title, item.shortTitle, item.summary, item.authorName, item.categoryName, item.sourceName, item.locationName, item.keywords || [])) return false;
    }
    return true;
  }), sort, newsSortValue);

  const pageCount = Math.max(1, Math.ceil(filteredNews.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedNews = filteredNews.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Selection never includes rows hidden by a filter or tab change.
  useEffect(() => {
    setSelectedIds([]);
    setPage(0);
  }, [activeTab, searchQuery, selectedCategory, selectedPriority]);

  const handleRestore = (id: string) => {
    try {
      apiService.restoreNews(id);
      setDeletedNews(apiService.getDeletedNews());
    } catch (err: any) {
      notify({ type: 'warning', message: err.message });
    }
  };

  const categoryOptions = Array.from(
    new Set([
      ...(categories || []).map((c) => c.nameAr),
      ...(newsList || []).map((n) => n.categoryName),
    ])
  ).filter(Boolean);

  const handleSelectAll = () => {
    if (selectedIds.length === pagedNews.length && pagedNews.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pagedNews.map((n) => n.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleOpenStatusModal = (item: NewsItem, status: NewsStatus) => {
    setStatusModalNews(item);
    setTargetStatus(status);
    setStatusComment('');
  };

  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const handleConfirmStatusChange = async () => {
    if (!statusModalNews || statusSubmitting) return;
    setStatusSubmitting(true);
    try {
      if (await onUpdateStatus(statusModalNews.id, targetStatus, statusComment)) setStatusModalNews(null);
    } finally {
      setStatusSubmitting(false);
    }
  };

  const countBy = (status: NewsStatus) => (newsList || []).filter((n) => n.status === status).length;

  const statusBadgeInfo: Record<NewsStatus, { label: string; variant: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'default' }> = {
    DRAFT: { label: 'مسودة', variant: 'default' },
    IN_PROGRESS: { label: 'قيد التحرير', variant: 'info' },
    UNDER_REVIEW: { label: 'قيد المراجعة', variant: 'warning' },
    NEEDS_REVISION: { label: 'يحتاج تعديلات', variant: 'danger' },
    APPROVED: { label: 'معتمد للنشر', variant: 'purple' },
    SCHEDULED: { label: 'مجدول للبث', variant: 'info' },
    PUBLISHED: { label: 'منشور', variant: 'success' },
    ARCHIVED: { label: 'مؤرشف', variant: 'default' },
    REJECTED: { label: 'مرفوض / مرتجع', variant: 'danger' },
    UNPUBLISHED: { label: 'تم سحبه', variant: 'default' },
  };

  const priorityBadgeInfo: Record<NewsPriority, { label: string; variant: 'danger' | 'warning' | 'primary' | 'default' }> = {
    CRITICAL: { label: 'خطير (خبر عاجل)', variant: 'danger' },
    URGENT: { label: 'عاجل جداً', variant: 'danger' },
    HIGH: { label: 'أولوية عالية', variant: 'warning' },
    MEDIUM: { label: 'متوسط', variant: 'default' },
    NORMAL: { label: 'عادي', variant: 'default' },
    LOW: { label: 'منخفض', variant: 'default' },
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            {initialTab === 'BREAKING' ? 'العاجل' : 'الأخبار'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {initialTab === 'BREAKING'
              ? 'الأخبار العاجلة المفعّلة على شريط البث، وما يُحضَّر منها'
              : 'إدارة وصياغة وتدقيق المواد الصحفية وسير عمل الاعتماد والنشر'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsArchiveOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            <Archive className="w-4 h-4" />
            الأرشيف القديم
          </button>
          {can('news.create') && <button
            type="button"
            onClick={onCreateNews}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            <Plus className="w-4 h-4" />
            إنشاء خبر جديد
          </button>}
        </div>
      </div>

      <NewsArchiveModal
        isOpen={isArchiveOpen}
        onClose={() => setIsArchiveOpen(false)}
        canReactivate={RbacService.hasPermission(currentUser, 'news.edit_any')}
        onReactivated={() => {
          setIsArchiveOpen(false);
          setArchiveNotice('أُعيد الخبر إلى غرفة الأخبار وسيظهر في القائمة خلال لحظات.');
        }}
      />
      {archiveNotice && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex justify-between">
          <span>{archiveNotice}</span>
          <button type="button" onClick={() => setArchiveNotice(null)} aria-label="إغلاق">×</button>
        </div>
      )}

      {/* Status tabs, in workflow order; archive and trash after a divider. */}
      <FilterTabs<ListTab>
        label="تصفية الأخبار حسب الحالة"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'ALL', label: 'الكل', count: newsList.length, tone: 'blue' },
          { id: 'DRAFT', label: 'مسودات', count: countBy('DRAFT'), tone: 'slate' },
          { id: 'UNDER_REVIEW', label: 'قيد المراجعة', count: countBy('UNDER_REVIEW'), tone: 'amber' },
          { id: 'NEEDS_REVISION', label: 'مُعاد للتعديل', count: countBy('NEEDS_REVISION'), tone: 'rose' },
          { id: 'APPROVED', label: 'معتمد للنشر', count: countBy('APPROVED'), tone: 'violet' },
          { id: 'SCHEDULED', label: 'مجدول', count: countBy('SCHEDULED'), tone: 'sky' },
          { id: 'PUBLISHED', label: 'منشور', count: countBy('PUBLISHED'), tone: 'emerald' },
          { id: 'BREAKING', label: 'عاجل على الهواء', count: (newsList || []).filter((n) => isBreakingLive(n)).length, tone: 'red', secondary: true },
          { id: 'ARCHIVED', label: 'أرشيف', count: countBy('ARCHIVED'), tone: 'slate', secondary: true },
          ...(canDelete ? [{ id: 'TRASH' as ListTab, label: 'سلة المحذوفات', count: deletedNews.length, tone: 'slate' as const, secondary: true }] : []),
        ]}
      />

      {activeTab === 'TRASH' && (authClient.getSession()?.trashRetentionDays ?? 0) > 0 && (
        <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-xs text-slate-600">
          تُحذف المواد نهائياً من السلة تلقائياً بعد {authClient.getSession()?.trashRetentionDays} يوماً من نقلها إليها.
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="py-3 border-y border-slate-200 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="news-list-search-input"
            type="search"
            aria-label="البحث في الأخبار"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالعنوان، الملخص، أو اسم المحرر..."
            className="w-full pr-9 pl-8 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dropdowns & Reset */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <label htmlFor="news-list-category-select">القسم:</label>
            <select
              id="news-list-category-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium transition-all"
            >
              <option value="ALL">جميع الأقسام</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <label htmlFor="news-list-priority-select">الأولوية:</label>
            <select
              id="news-list-priority-select"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium transition-all"
            >
              <option value="ALL">جميع الأولويات</option>
              <option value="CRITICAL">عاجل وفوري</option>
              <option value="URGENT">عاجل جداً</option>
              <option value="HIGH">أولوية عالية</option>
              <option value="NORMAL">عادي</option>
              <option value="LOW">منخفض</option>
            </select>
          </div>

          {(searchQuery || selectedCategory !== 'ALL' || selectedPriority !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('ALL');
                setSelectedPriority('ALL');
              }}
              className="px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
            >
              إعادة تعيين الفلاتر
            </button>
          )}

          <div role="status" aria-live="polite" className="text-xs tabular-nums text-slate-600 px-2 py-1">
            {filteredNews.length} نتيجة
          </div>
          <ExportMenu
            items={[
              {
                id: 'list',
                label: 'قائمة الأخبار المعروضة',
                hint: `${filteredNews.length} خبر حسب البحث والفلاتر الحالية`,
                build: () => newsListDoc(filteredNews, activeTab === 'ALL' ? 'كل الأخبار' : activeTab === 'BREAKING' ? 'العاجل' : activeTab === 'TRASH' ? 'سلة المحذوفات' : NEWS_STATUS_LABELS[activeTab as NewsStatus] || '', docContext()),
              },
            ]}
          />
        </div>
      </div>

      {/* Bulk Action Bar (when selected) */}
      {selectedIds.length > 0 && activeTab !== 'TRASH' && (
          <div className="bg-slate-900 text-white px-4 py-3 rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs shadow-md animate-fadeIn">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">تم تحديد {selectedIds.length} عنصر</span>
          </div>

          <div className="flex items-center gap-2">
            {canApprove && (
              <button
                type="button"
                onClick={() => {
                  void runBulkAction('APPROVE');
                }}
                disabled={bulkSubmitting}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg font-semibold"
              >
                اعتماد المحدد
              </button>
            )}
            {canPublish && (
              <button
                type="button"
                onClick={() => {
                  void runBulkAction('PUBLISH');
                }}
                disabled={bulkSubmitting}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-500 rounded-lg font-semibold"
              >
                نشر المحدد
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void runBulkAction('ARCHIVE');
              }}
              disabled={bulkSubmitting}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold"
            >
              أرشفة المحدد
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  void runBulkAction('DELETE');
                }}
                disabled={bulkSubmitting}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg font-semibold"
              >
                حذف المحدد
              </button>
            )}
          </div>
        </div>
      )}

      {/* News Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3.5 px-3 w-10 text-center">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    role="checkbox"
                    aria-checked={selectedIds.length === 0 ? false : selectedIds.length === pagedNews.length ? true : 'mixed'}
                    aria-label="تحديد كل الأخبار المعروضة"
                    className="p-1 text-slate-500 hover:text-slate-800"
                  >
                    {selectedIds.length === filteredNews.length && filteredNews.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <SortTh className="py-3.5 px-3 sm:px-4 min-w-[10rem] sm:min-w-[14rem]" label="عنوان الخبر والموضوع" sortKey="title" sort={sort} onSort={toggleSort} />
                <SortTh className="py-3.5 px-3 hidden lg:table-cell" label="القسم" sortKey="category" sort={sort} onSort={toggleSort} />
                <SortTh className="py-3.5 px-3 hidden lg:table-cell" label="الأولوية" sortKey="priority" sort={sort} onSort={toggleSort} defaultDir="desc" />
                <SortTh className="py-3.5 px-3 hidden lg:table-cell" label="المصدر / المحرر" sortKey="author" sort={sort} onSort={toggleSort} />
                <SortTh className="py-3.5 px-3 hidden sm:table-cell" label="الحالة التحريرية" sortKey="status" sort={sort} onSort={toggleSort} />
                <SortTh className="py-3.5 px-3 text-center hidden md:table-cell" label="آخر تحديث" sortKey="updatedAt" sort={sort} onSort={toggleSort} defaultDir="desc" />
                <th className="py-3.5 px-2 sm:px-4 text-center w-28 sm:w-36">إجراءات تحريرية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredNews.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    لا توجد أخبار مطابقة للتصنيف أو معايير البحث المحددة.
                    {(searchQuery || selectedCategory !== 'ALL' || selectedPriority !== 'ALL') && (
                      <button type="button" onClick={() => { setSearchQuery(''); setSelectedCategory('ALL'); setSelectedPriority('ALL'); document.getElementById('news-list-search-input')?.focus(); }} className="block mx-auto mt-3 min-h-11 px-4 text-blue-600 font-semibold">
                        مسح البحث والفلاتر
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                pagedNews.map((item) => {
                  const lock = lockByNewsId.get(item.id);
                  const sInfo = statusBadgeInfo[item.status] || { label: item.status, variant: 'default' };
                  const pInfo = priorityBadgeInfo[item.priority] || { label: item.priority, variant: 'default' };
                  const isSelected = selectedIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      {/* Select */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(item.id)}
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-label={`تحديد الخبر: ${item.title}`}
                          className="p-1 text-slate-500 hover:text-slate-700"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Title */}
                      <td className="py-3.5 px-3 sm:px-4">
                        <div className="flex items-start gap-2">
                          {isUnderEmbargo(item) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200" title={item.embargoNote || ''}>
                              محظور حتى {embargoLabel(item.embargoUntil)}
                            </span>
                          )}
                          {item.isBreaking && (
                            <Badge variant="danger" size="sm" dot className="shrink-0 mt-0.5">
                              عاجل
                            </Badge>
                          )}
                          <div>
                            <span
                              onClick={() => setPreviewNews(item)}
                              className="font-bold text-slate-800 hover:text-blue-600 cursor-pointer block leading-snug"
                            >
                              {item.title}
                            </span>
                            <span className="text-[11px] text-slate-500 block line-clamp-1 mt-0.5">
                              {item.summary}
                            </span>
                            {/* Below 1024px the category, priority, author and time columns fold in here. */}
                            <span className="lg:hidden flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-slate-500">
                              <span className="sm:hidden">
                                <Badge variant={sInfo.variant} size="sm">
                                  {sInfo.label}
                                </Badge>
                              </span>
                              <span className="font-semibold text-slate-600">{item.categoryName}</span>
                              <Badge variant={pInfo.variant} size="sm">
                                {pInfo.label}
                              </Badge>
                              {item.authorName && <span>{item.authorName}</span>}
                              {item.updatedAt && (
                                <span className="md:hidden tabular-nums">
                                  {new Date(item.updatedAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </span>
                            {item.status === 'SCHEDULED' && item.scheduledDate && (
                              <span className="inline-flex items-center gap-1 mt-1 ml-1 text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
                                <Clock className="w-3 h-3" />
                                ينشر في {new Date(item.scheduledDate).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            )}
                            {lock && (
                              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                <Lock className="w-3 h-3" />
                                يحرره الآن: {lock.userName}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3.5 px-3 hidden lg:table-cell">
                        {(() => {
                          const catObj = (categories || []).find(
                            (c) => c.nameAr === item.categoryName || c.id === item.categoryId
                          );
                          const color = catObj?.colorCode || catObj?.color || '#2563eb';
                          return (
                            <span
                              className="px-2 py-0.5 rounded-md text-[11px] font-bold border inline-flex items-center gap-1.5"
                              style={{
                                backgroundColor: 'var(--color-slate-50)',
                                color: 'var(--color-slate-800)',
                                borderColor: `${color}30`,
                              }}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span>{item.categoryName || catObj?.nameAr}</span>
                            </span>
                          );
                        })()}
                      </td>

                      {/* Priority */}
                      <td className="py-3.5 px-3 hidden lg:table-cell">
                        <Badge variant={pInfo.variant} size="sm">
                          {pInfo.label}
                        </Badge>
                      </td>

                      {/* Source / Author */}
                      <td className="py-3.5 px-3 hidden lg:table-cell">
                        <div className="text-[11px]">
                          <span className="text-slate-800 font-semibold block">{item.sourceName}</span>
                          <span className="text-slate-500 block">{item.authorName}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 hidden sm:table-cell">
                        <Badge variant={sInfo.variant} size="sm">
                          {sInfo.label}
                        </Badge>
                      </td>

                      {/* Last update */}
                      <td className="py-3.5 px-3 text-center text-[11px] text-slate-500 whitespace-nowrap tabular-nums hidden md:table-cell" title={item.updatedAt ? new Date(item.updatedAt).toLocaleString(appLocale(), zoneOptions()) : ''}>
                        {item.updatedAt ? new Date(item.updatedAt).toLocaleString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-2 sm:px-4 text-center">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {/* Quick Preview */}
                          <button
                            type="button"
                            onClick={() => setPreviewNews(item)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"
                            title="معاينة وسجل التدقيق"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {activeTab === 'TRASH' ? (
                            <button
                              type="button"
                              onClick={() => handleRestore(item.id)}
                              className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg"
                              title="استعادة الخبر من سلة المحذوفات"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          ) : (
                            <>
                          {/* Edit */}
                          <button
                            type="button"
                            onClick={() => onEditNews(item.id)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                            title={lock ? `يحرره الآن ${lock.userName} (فتح للقراءة)` : canEditNewsContent(can, currentUser.id, item) ? 'تحرير الخبر' : 'فتح الخبر للقراءة'}
                          >
                            {canEditNewsContent(can, currentUser.id, item) && !lock ? <Edit2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>

                          {/* Workflow actions offered only when the server will accept them */}
                          {['DRAFT', 'IN_PROGRESS', 'NEEDS_REVISION'].includes(item.status) && allowed(item, 'UNDER_REVIEW') && (
                            <button
                              type="button"
                              onClick={() => handleOpenStatusModal(item, 'UNDER_REVIEW')}
                              className="p-1.5 text-amber-700 hover:bg-amber-50 rounded-lg"
                              title="إرسال للمراجعة"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          )}

                          {allowed(item, 'APPROVED') && item.status !== 'APPROVED' && (
                            <button
                              type="button"
                              onClick={() => handleOpenStatusModal(item, 'APPROVED')}
                              className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg"
                              title="اعتماد الخبر"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}

                          {['UNDER_REVIEW', 'APPROVED'].includes(item.status) && allowed(item, 'NEEDS_REVISION') && (
                            <button
                              type="button"
                              onClick={() => handleOpenStatusModal(item, 'NEEDS_REVISION')}
                              className="p-1.5 text-orange-700 hover:bg-orange-50 rounded-lg"
                              title="إعادة للكاتب مع ملاحظات"
                            >
                              <Undo2 className="w-4 h-4" />
                            </button>
                          )}

                          {allowed(item, 'PUBLISHED') && item.status !== 'PUBLISHED' && (
                            <button
                              type="button"
                              onClick={() => handleOpenStatusModal(item, 'PUBLISHED')}
                              className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg"
                              title="نشر رسمي الآن"
                            >
                              <Radio className="w-4 h-4" />
                            </button>
                          )}

                          {/* Breaking flag: only for published stories (or to take one off air) */}
                          {canManageBreaking && (item.status === 'PUBLISHED' || item.isBreaking) && (
                            <button
                              type="button"
                              onClick={() => onToggleBreaking(item)}
                              className={`p-1.5 rounded-lg transition-colors ${
                                isBreakingLive(item)
                                  ? 'text-red-600 bg-red-50 hover:bg-red-100'
                                  : 'text-slate-500 hover:text-red-600 hover:bg-red-50'
                              }`}
                              title={isBreakingLive(item) ? 'إيقاف من شريط العاجل' : 'إطلاق على شريط العاجل (4 ساعات)'}
                            >
                              <Flame className="w-4 h-4" />
                            </button>
                          )}

                          {/* Delete */}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                              title="نقل إلى سلة المحذوفات"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs">
            <span className="text-slate-500">
              {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filteredNews.length)} من {filteredNews.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 font-bold"
              >
                السابق
              </button>
              <span className="px-2 font-mono">
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 font-bold"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Preview News & Workflow History Modal */}
      <Modal
        isOpen={!!previewNews}
        onClose={() => setPreviewNews(null)}
        title={previewNews?.title || 'معاينة الخبر'}
        subtitle={`القسم: ${previewNews?.categoryName} | المحرر: ${previewNews?.authorName}`}
        maxWidth="4xl"
      >
        {previewNews && (
          <div className="space-y-6">
            {/* Header badges */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeInfo[previewNews.status]?.variant} size="md">
                  الحالة: {statusBadgeInfo[previewNews.status]?.label}
                </Badge>
                {previewNews.isBreaking && (
                  <Badge variant="danger" size="md" dot>
                    عاجل
                  </Badge>
                )}
                <span className="text-xs text-slate-500">
                  المصدر: <strong>{previewNews.sourceName}</strong>
                </span>
              </div>
              <div className="text-xs text-slate-500 font-mono">
                تاريخ الإنشاء: {new Date(previewNews.createdAt).toLocaleString(appLocale(), zoneOptions())}
              </div>
            </div>

            {/* Main image if exists */}
            {previewNews.mainImageUrl && (
              <img
                src={previewNews.mainImageUrl}
                alt={previewNews.title}
                className="w-full h-64 object-cover rounded-xl shadow-xs"
              />
            )}

            <NewsVideosList videos={videosOf(previewNews)} />

            {/* Summary */}
            {previewNews.summary && (
              <div className="p-4 bg-blue-50/50 rounded-lg text-sm text-blue-900 font-medium">
                {previewNews.summary}
              </div>
            )}

            {/* Body */}
            <div
              className="rich-content text-slate-800 text-sm"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewNews.content) }}
            />

            {/* Workflow Timeline / Audit History */}
            <div className="border-t border-slate-200 pt-5">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                سجل سير الموافقات والاعتمادات
              </h4>
              <div className="space-y-2.5">
                {previewNews.workflowLogs?.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-start justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-bold text-slate-800">
                        <span>{log.changedBy.name}</span>
                        <span className="text-[10px] text-blue-600">({log.changedBy.role})</span>
                        <span className="text-slate-500 text-[10px]">
                          نقل من [{log.fromStatus}] إلى [{log.toStatus}]
                        </span>
                      </div>
                      <p className="text-slate-600 mt-1">{log.comment}</p>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(log.timestamp).toLocaleString(appLocale(), zoneOptions())}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Status Change with Comment Modal */}
      <Modal
        isOpen={!!statusModalNews}
        onClose={() => setStatusModalNews(null)}
        title="تحديث الحالة التحريرية وسير العمل"
        subtitle={statusModalNews?.title}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="news-status-comment-textarea" className="block text-xs font-bold text-slate-700 mb-1">
              الحالة المستهدفة:
            </label>
            <div className="p-2.5 bg-blue-50 text-blue-900 rounded-lg text-xs font-bold">
              {statusBadgeInfo[targetStatus]?.label}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="news-status-comment-textarea" className="block text-xs font-bold text-slate-700">
                ملاحظات أو تعليق التحرير (يسجل في سجل التدقيق):
              </label>
              {statusComment && (
                <button
                  type="button"
                  onClick={() => setStatusComment('')}
                  className="text-[10px] text-slate-500 hover:text-slate-600"
                >
                  مسح الملاحظة
                </button>
              )}
            </div>
            <textarea
              id="news-status-comment-textarea"
              rows={3}
              value={statusComment}
              onChange={(e) => setStatusComment(e.target.value)}
              placeholder="مثال: تمت مراجعة الأرقام وصحة المصادر والتأكد من صياغة العناوين..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 leading-relaxed transition-all"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                'تم التدقيق اللغوي والمعلوماتي بنجاح',
                'معتمد للبث الفوري وإدراجه بالرانداون',
                'يرجى التأكد من اسم المتحدث الرسمي والمصدر',
                'مطلوب استكمال التقرير المرئي المرافق',
                'مرفوض لوجود تعارض مع المعايير التحريرية',
              ].map((template) => (
                <button
                  key={template}
                  type="button"
                  onClick={() => setStatusComment(template)}
                  className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors"
                >
                  +{template}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStatusModalNews(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleConfirmStatusChange}
              disabled={statusSubmitting || (['NEEDS_REVISION', 'REJECTED'].includes(targetStatus) && !statusComment.trim())}
              title={['NEEDS_REVISION', 'REJECTED'].includes(targetStatus) && !statusComment.trim() ? 'اكتب ملاحظات للكاتب أولاً' : undefined}
              className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs disabled:opacity-50"
            >
              تأكيد التحديث
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) onDeleteNews(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        title="نقل الخبر إلى سلة المحذوفات"
        message="سيختفي الخبر من القوائم وشريط العاجل، ويمكن لمن يملك صلاحية الحذف استعادته من «سلة المحذوفات»."
        confirmLabel="نقل إلى السلة"
        isDestructive
      />
    </div>
  );
};
