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
  onUpdateStatus: (newsId: string, toStatus: NewsStatus, comment?: string) => void;
  onDeleteNews: (newsId: string) => void;
  onToggleBreaking: (newsItem: NewsItem) => void;
  onBulkAction: (newsIds: string[], action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE') => void;
  /** Opens the list on a specific tab (e.g. the breaking-news desk). */
  initialTab?: ListTab;
}

type ListTab = 'ALL' | NewsStatus | 'BREAKING' | 'TRASH';

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
  const [page, setPage] = useState(0);
  const [locks, setLocks] = useState<EditLock[]>(() => apiService.getEditLocks());
  const [deletedNews, setDeletedNews] = useState<NewsItem[]>(() => apiService.getDeletedNews());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedPriority, setSelectedPriority] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
  const filteredNews = sourceList.filter((item) => {
    if (activeTab === 'BREAKING') {
      if (!isBreakingLive(item)) return false;
    } else if (activeTab !== 'ALL' && activeTab !== 'TRASH' && item.status !== activeTab) return false;
    if (selectedCategory !== 'ALL' && item.categoryName !== selectedCategory) return false;
    if (selectedPriority !== 'ALL' && item.priority !== selectedPriority) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const fields = [item.title, item.summary, item.authorName, ...(item.keywords || [])];
      if (!fields.some((f) => String(f ?? '').toLowerCase().includes(q))) return false;
    }
    return true;
  });

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
      alert(err.message);
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

  const handleConfirmStatusChange = () => {
    if (statusModalNews) {
      onUpdateStatus(statusModalNews.id, targetStatus, statusComment);
      setStatusModalNews(null);
    }
  };

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
            غرفة الأخبار والتقارير الصحفية
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            إدارة وصياغة وتدقيق المواد الصحفية وسير عمل الاعتماد والنشر
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateNews}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إنشاء خبر جديد
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('ALL')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'ALL'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          الكل ({newsList.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('DRAFT')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'DRAFT'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          مسودات ({(newsList || []).filter((n) => n.status === 'DRAFT').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('UNDER_REVIEW')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'UNDER_REVIEW'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          قيد المراجعة ({(newsList || []).filter((n) => n.status === 'UNDER_REVIEW').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('APPROVED')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'APPROVED'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          معتمد للنشر ({(newsList || []).filter((n) => n.status === 'APPROVED').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('PUBLISHED')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'PUBLISHED'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          منشور ({(newsList || []).filter((n) => n.status === 'PUBLISHED').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ARCHIVED')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'ARCHIVED'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          أرشيف ({(newsList || []).filter((n) => n.status === 'ARCHIVED').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('NEEDS_REVISION')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'NEEDS_REVISION' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          مُعاد للتعديل ({(newsList || []).filter((n) => n.status === 'NEEDS_REVISION').length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('BREAKING')}
          className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
            activeTab === 'BREAKING' ? 'bg-red-600 text-white shadow-xs' : 'text-red-600 hover:bg-red-50'
          }`}
        >
          عاجل على الهواء ({(newsList || []).filter((n) => isBreakingLive(n)).length})
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={() => setActiveTab('TRASH')}
            className={`px-4 py-2 rounded-xl transition-colors shrink-0 ${
              activeTab === 'TRASH' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            سلة المحذوفات ({deletedNews.length})
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="news-list-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالعنوان، الملخص، أو اسم المحرر..."
            className="w-full pr-9 pl-8 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dropdowns & Reset */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
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

          <div className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
            {filteredNews.length} نتيجة
          </div>
        </div>
      </div>

      {/* Bulk Action Bar (when selected) */}
      {selectedIds.length > 0 && activeTab !== 'TRASH' && (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-xl flex items-center justify-between gap-4 text-xs shadow-md animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="font-bold">تم تحديد {selectedIds.length} عنصر</span>
          </div>

          <div className="flex items-center gap-2">
            {canApprove && (
              <button
                type="button"
                onClick={() => {
                  onBulkAction(selectedIds, 'APPROVE');
                  setSelectedIds([]);
                }}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg font-semibold"
              >
                اعتماد المحدد
              </button>
            )}
            {canPublish && (
              <button
                type="button"
                onClick={() => {
                  onBulkAction(selectedIds, 'PUBLISH');
                  setSelectedIds([]);
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold"
              >
                نشر المحدد
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onBulkAction(selectedIds, 'ARCHIVE');
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold"
            >
              أرشفة المحدد
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  onBulkAction(selectedIds, 'DELETE');
                  setSelectedIds([]);
                }}
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
                    className="p-1 text-slate-500 hover:text-slate-800"
                  >
                    {selectedIds.length === filteredNews.length && filteredNews.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="py-3.5 px-4">عنوان الخبر والموضوع</th>
                <th className="py-3.5 px-3">القسم</th>
                <th className="py-3.5 px-3">الأولوية</th>
                <th className="py-3.5 px-3">المصدر / المحرر</th>
                <th className="py-3.5 px-3">الحالة التحريرية</th>
                <th className="py-3.5 px-3 font-mono text-center">المشاهدات</th>
                <th className="py-3.5 px-4 text-center w-36">إجراءات تحريرية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredNews.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    لا توجد أخبار مطابقة للتصنيف أو معايير البحث المحددة.
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
                          className="p-1 text-slate-400 hover:text-slate-700"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Title */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2">
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
                            <span className="text-[11px] text-slate-400 block line-clamp-1 mt-0.5">
                              {item.summary}
                            </span>
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
                      <td className="py-3.5 px-3">
                        {(() => {
                          const catObj = (categories || []).find(
                            (c) => c.nameAr === item.categoryName || c.id === item.categoryId
                          );
                          const color = catObj?.colorCode || catObj?.color || '#2563eb';
                          return (
                            <span
                              className="px-2 py-0.5 rounded-md text-[11px] font-bold border inline-flex items-center gap-1.5"
                              style={{
                                backgroundColor: `${color}15`,
                                color: color,
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
                      <td className="py-3.5 px-3">
                        <Badge variant={pInfo.variant} size="sm">
                          {pInfo.label}
                        </Badge>
                      </td>

                      {/* Source / Author */}
                      <td className="py-3.5 px-3">
                        <div className="text-[11px]">
                          <span className="text-slate-800 font-semibold block">{item.sourceName}</span>
                          <span className="text-slate-400 block">{item.authorName}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3">
                        <Badge variant={sInfo.variant} size="sm">
                          {sInfo.label}
                        </Badge>
                      </td>

                      {/* Views */}
                      <td className="py-3.5 px-3 text-center font-mono font-semibold text-slate-600">
                        {item.viewsCount}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
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
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
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
                            title={lock ? `يحرره الآن ${lock.userName} (فتح للقراءة)` : 'تحرير الخبر'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Workflow actions offered only when the server will accept them */}
                          {['DRAFT', 'IN_PROGRESS', 'NEEDS_REVISION'].includes(item.status) && allowed(item, 'UNDER_REVIEW') && (
                            <button
                              type="button"
                              onClick={() => handleOpenStatusModal(item, 'UNDER_REVIEW')}
                              className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"
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
                              className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg"
                              title="إعادة للكاتب مع ملاحظات"
                            >
                              <Undo2 className="w-4 h-4" />
                            </button>
                          )}

                          {allowed(item, 'PUBLISHED') && item.status !== 'PUBLISHED' && (
                            <button
                              type="button"
                              onClick={() => handleOpenStatusModal(item, 'PUBLISHED')}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
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
                                  : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
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
                تاريخ الإنشاء: {new Date(previewNews.createdAt).toLocaleString('ar-SA')}
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

            {/* Summary */}
            {previewNews.summary && (
              <div className="p-4 bg-blue-50/50 border-r-4 border-blue-600 rounded-lg text-sm text-slate-700 font-medium">
                {previewNews.summary}
              </div>
            )}

            {/* Body */}
            <div
              className="prose prose-slate max-w-none text-slate-800 leading-relaxed text-sm"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewNews.content) }}
            />

            {/* Workflow Timeline / Audit History */}
            <div className="border-t border-slate-200 pt-5">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                سجل سير الموافقات والاعتمادات (Workflow Audit Trail)
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
                        <span className="text-slate-400 text-[10px]">
                          نقل من [{log.fromStatus}] إلى [{log.toStatus}]
                        </span>
                      </div>
                      <p className="text-slate-600 mt-1">{log.comment}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(log.timestamp).toLocaleString('ar-SA')}
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
            <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  className="text-[10px] text-slate-400 hover:text-slate-600"
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
              disabled={['NEEDS_REVISION', 'REJECTED'].includes(targetStatus) && !statusComment.trim()}
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
