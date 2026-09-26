import { newId } from '../../shared/ids';
import React, { useState } from 'react';
import {
  RundownSegment,
  RundownSegmentType,
  Guest,
  NewsItem,
} from '../../types';
import {
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  Plus,
  Clock,
  Printer,
  CheckCircle2,
  Video,
  FileText,
  User as UserIcon,
  AlertCircle,
  Download,
  Database,
  Tv,
  Radio,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '../common/Badge';
import { SegmentModal } from './SegmentModal';
import { RequestFormPage, RequestDraft } from '../requests/RequestFormPage';
import { RbacService } from '../../services/rbacService';
import { segmentReadiness } from '../../shared/production';
import { departmentName } from '../../shared/departments';
import { TeleprompterModal } from './TeleprompterModal';
import { formatSecondsToTime, apiService } from '../../services/api';

interface RundownTableProps {
  segments: RundownSegment[];
  plannedDurationMinutes: number;
  onUpdateRundown: (segments: RundownSegment[]) => void;
  guests: Guest[];
  newsList: NewsItem[];
  defaultPresenter?: string;
  canEdit?: boolean;
  episodeId?: string;
}

export const RundownTable: React.FC<RundownTableProps> = ({
  segments,
  plannedDurationMinutes,
  onUpdateRundown,
  guests,
  newsList,
  defaultPresenter = '',
  canEdit = true,
  episodeId,
}) => {
  const [requestDraft, setRequestDraft] = useState<RequestDraft | null>(null);
  const canRequest = !!episodeId && RbacService.hasPermission(apiService.getCurrentUser(), 'requests.create');
  const episodeRecord = episodeId ? apiService.getEpisodes().find((e) => e.id === episodeId) : undefined;
  const readinessCtx = { requests: apiService.getRequests(), media: apiService.getMedia() as any[] };
  const [editingSegment, setEditingSegment] = useState<RundownSegment | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSyncingDb, setIsSyncingDb] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [isPrompterOpen, setIsPrompterOpen] = useState(false);
  const [draggedSegmentIdx, setDraggedSegmentIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  // Total runtime calculation
  const totalRundownSeconds = segments.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
  const plannedSeconds = plannedDurationMinutes * 60;
  const differenceSeconds = totalRundownSeconds - plannedSeconds;

  const displayedSegments = segments.filter((s) => {
    if (filterType !== 'ALL' && s.segmentType !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchScript = s.scriptText?.toLowerCase().includes(q);
      const matchPresenter = s.presenterName?.toLowerCase().includes(q);
      const matchGuest = s.guestName?.toLowerCase().includes(q);
      const matchNotes = s.notes?.toLowerCase().includes(q);
      if (!matchTitle && !matchScript && !matchPresenter && !matchGuest && !matchNotes) return false;
    }
    return true;
  });

  const handleManualDbSync = async () => {
    if (!episodeId) return;
    setIsSyncingDb(true);
    try {
      const ok = await apiService.flushSync();
      if (ok) {
        setSyncStatusMsg('تم الحفظ في قاعدة بيانات SQLite');
      } else {
        setSyncStatusMsg('بانتظار الاتصال بالخادم، ستتم المزامنة تلقائياً');
      }
    } catch {
      setSyncStatusMsg('تم الحفظ محلياً');
    } finally {
      setIsSyncingDb(false);
      setTimeout(() => setSyncStatusMsg(null), 3000);
    }
  };

  /**
   * Moves a segment next to its visible neighbour. Indexes come from the (possibly filtered)
   * displayed list, so they are mapped to the full rundown by id before splicing.
   */
  const moveById = (movedId: string, targetId: string) => {
    const from = segments.findIndex((s) => s.id === movedId);
    const to = segments.findIndex((s) => s.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const newSegments = [...segments];
    const [moved] = newSegments.splice(from, 1);
    newSegments.splice(to, 0, moved);
    onUpdateRundown(newSegments);
  };

  const handleMove = (index: number, direction: 'UP' | 'DOWN') => {
    if (!canEdit) return;
    const targetIdx = direction === 'UP' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= displayedSegments.length) return;
    moveById(displayedSegments[index].id, displayedSegments[targetIdx].id);
  };

  const handleDelete = (segmentId: string) => {
    if (!canEdit) return;
    const filtered = segments.filter((s) => s.id !== segmentId);
    onUpdateRundown(filtered);
  };

  const handleSaveSegment = (segmentData: Partial<RundownSegment>) => {
    if (editingSegment) {
      const updated = segments.map((s) =>
        s.id === editingSegment.id ? ({ ...s, ...segmentData } as RundownSegment) : s
      );
      onUpdateRundown(updated);
      setEditingSegment(null);
    } else {
      const newSeg: RundownSegment = {
        id: newId('seg'),
        episodeId: episodeId || segments[0]?.episodeId || 'ep-temp',
        orderIndex: segments.length + 1,
        title: segmentData.title || 'فقرة جديدة',
        segmentType: segmentData.segmentType || 'REPORT',
        startTimeOffset: '00:00:00',
        durationSeconds: segmentData.durationSeconds ?? apiService.getSettings().defaultSegmentDurationSeconds ?? 180,
        endTimeOffset: '00:03:00',
        presenterName: segmentData.presenterName || defaultPresenter,
        guestId: segmentData.guestId,
        guestName: segmentData.guestName,
        scriptText: segmentData.scriptText || '',
        videoAssetUrl: segmentData.videoAssetUrl,
        newsId: segmentData.newsId,
        newsTitle: segmentData.newsTitle,
        notes: segmentData.notes || '',
        isCompleted: false,
      };
      onUpdateRundown([...segments, newSeg]);
    }
  };

  const toggleComplete = (segmentId: string) => {
    if (!canEdit) return;
    const updated = segments.map((s) =>
      s.id === segmentId ? { ...s, isCompleted: !s.isCompleted } : s
    );
    onUpdateRundown(updated);
  };

  const handleDragReorder = (sourceIdx: number, destinationIdx: number) => {
    if (!canEdit || sourceIdx === destinationIdx) return;
    const source = displayedSegments[sourceIdx];
    const target = displayedSegments[destinationIdx];
    if (source && target) moveById(source.id, target.id);
  };

  const typeBadges: Record<RundownSegmentType, { label: string; variant: 'primary' | 'success' | 'danger' | 'purple' | 'info' | 'warning' | 'default' }> = {
    INTRO: { label: 'شارة / مقدمة', variant: 'purple' },
    REPORT: { label: 'تقرير مصور VT', variant: 'primary' },
    LIVE_INTERVIEW: { label: 'حوار مباشر', variant: 'danger' },
    NEWS_ITEM: { label: 'خبر قارئ', variant: 'info' },
    DISCUSSION: { label: 'طاولة حوار', variant: 'warning' },
    BREAK: { label: 'فاصل إعلاني', variant: 'default' },
    OUTRO: { label: 'تتر النهاية', variant: 'purple' },
  };

  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.warn('Printing is not supported or was blocked:', e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Rundown Timing Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-slate-500 block">إجمالي زمن الرانداون</span>
              <strong className="text-lg font-bold font-mono text-slate-800">
                {formatSecondsToTime(totalRundownSeconds)}
              </strong>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden sm:block" />

          <div>
            <span className="text-xs text-slate-500 block">المدة المقررة للحلقة</span>
            <span className="text-sm font-semibold text-slate-700">
              {plannedDurationMinutes} دقيقة ({formatSecondsToTime(plannedSeconds)})
            </span>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden sm:block" />

          {/* Overrun / Underrun Badge */}
          <div className="flex items-center gap-2">
            {differenceSeconds === 0 ? (
              <Badge variant="success" size="md">
                مطابق تماماً للزمن المقرر
              </Badge>
            ) : differenceSeconds > 0 ? (
              <Badge variant="danger" size="md" dot>
                فائض في الوقت: +{formatSecondsToTime(differenceSeconds)}
              </Badge>
            ) : (
              <Badge variant="warning" size="md" dot>
                عجز في الوقت: -{formatSecondsToTime(Math.abs(differenceSeconds))}
              </Badge>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {syncStatusMsg && (
            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 animate-fade-in">
              {syncStatusMsg}
            </span>
          )}

          {episodeId && (
            <a
              href={apiService.getMosExportUrl(episodeId)}
              download={`episode_${episodeId}_mos.xml`}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors border border-indigo-200"
              title="تصدير بروتوكول MOS Protocol 2.8.5 لأنظمة أتمتة البث وغرف الأخبار"
            >
              <Download className="w-4 h-4" />
              تصدير MOS (XML)
            </a>
          )}

          {episodeId && canEdit && (
            <button
              type="button"
              onClick={handleManualDbSync}
              disabled={isSyncingDb}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
              title="حفظ ومزامنة فورية مع قاعدة بيانات SQLite"
            >
              <Database className={`w-4 h-4 ${isSyncingDb ? 'animate-spin text-blue-600' : ''}`} />
              {isSyncingDb ? 'جارٍ الحفظ...' : 'حفظ الآن'}
            </button>
          )}


          <button
            type="button"
            onClick={() => setIsPrompterOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors border border-purple-200 shadow-2xs"
            title="فتح شاشة الملقن التفاعلية (Prompter) للمذيع ومخرج الاستوديو"
          >
            <Tv className="w-4 h-4 text-purple-600" />
            <span>شاشة الملقن (Prompter)</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            title="طباعة نسخة ورقية لاستوديو البث وغرفة المخرج"
          >
            <Printer className="w-4 h-4" />
            طباعة الرانداون
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setEditingSegment(null);
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              إضافة فقرة
            </button>
          )}
        </div>
      </div>

      {/* Segments Quick Search & Filter Bar */}
      {segments.length > 0 && (
        <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في عنوان الفقرة، السكريبت، المذيع أو الضيف..."
              className="w-full pr-8 pl-8 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">نوع الفقرة:</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="ALL">جميع الفقرات ({segments.length})</option>
              <option value="INTRO">شارة / مقدمة</option>
              <option value="REPORT">تقرير مصور VT</option>
              <option value="LIVE_INTERVIEW">حوار مباشر</option>
              <option value="NEWS_ITEM">خبر قارئ</option>
              <option value="DISCUSSION">طاولة حوار</option>
              <option value="BREAK">فاصل إعلاني</option>
              <option value="OUTRO">تتر النهاية</option>
            </select>

            {(searchQuery || filterType !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilterType('ALL');
                }}
                className="text-[11px] text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors font-bold"
              >
                إلغاء التصفية
              </button>
            )}

            <div className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
              {displayedSegments.length} من {segments.length}
            </div>
          </div>
        </div>
      )}

      {/* Rundown Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3 px-3 w-12 text-center">#</th>
                <th className="py-3 px-3 w-10 text-center">تمت</th>
                <th className="py-3 px-4">عنوان وموضوع الفقرة</th>
                <th className="py-3 px-3">النوع</th>
                <th className="py-3 px-3 font-mono text-center">البداية</th>
                <th className="py-3 px-3 font-mono text-center">المدة</th>
                <th className="py-3 px-3 font-mono text-center">النهاية</th>
                <th className="py-3 px-3">المذيع / الضيف</th>
                <th className="py-3 px-3">ملاحظات البث والمواد</th>
                <th className="py-3 px-3">الجاهزية</th>
                {canEdit && <th className="py-3 px-3 text-center w-28">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {segments.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 11 : 10} className="py-12 text-center text-slate-400">
                    لا توجد فقرات في جدول الرانداون بعد. انقر على "إضافة فقرة" لبدء تنظيم الحلقة.
                  </td>
                </tr>
              ) : displayedSegments.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 11 : 10} className="py-10 text-center text-slate-400">
                    لا توجد فقرات تطابق بحثك أو التصفية الحالية.
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setFilterType('ALL');
                      }}
                      className="text-blue-600 hover:underline font-bold mr-2"
                    >
                      إعادة عرض جميع الفقرات
                    </button>
                  </td>
                </tr>
              ) : (
                displayedSegments.map((seg, idx) => {
                  const badgeInfo = typeBadges[seg.segmentType] || { label: seg.segmentType, variant: 'default' };
                  const durationMins = Math.floor(seg.durationSeconds / 60);
                  const durationSecs = seg.durationSeconds % 60;
                  const durationStr = `${durationMins.toString().padStart(2, '0')}:${durationSecs.toString().padStart(2, '0')}`;

                  return (
                    <tr
                      key={seg.id}
                      draggable={canEdit}
                      onDragStart={() => setDraggedSegmentIdx(idx)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (canEdit && draggedSegmentIdx !== null && draggedSegmentIdx !== idx) {
                          e.currentTarget.classList.add('border-t-2', 'border-blue-500');
                        }
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.classList.remove('border-t-2', 'border-blue-500');
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('border-t-2', 'border-blue-500');
                        if (draggedSegmentIdx !== null) {
                          handleDragReorder(draggedSegmentIdx, idx);
                          setDraggedSegmentIdx(null);
                        }
                      }}
                      className={`hover:bg-slate-50/70 transition-colors ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${
                        seg.isCompleted ? 'bg-emerald-50/30 line-through opacity-70' : ''
                      }`}
                    >
                      {/* Order */}
                      <td className="py-3.5 px-3 text-center font-bold text-slate-500">
                        {idx + 1}
                      </td>

                      {/* Completed toggle */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleComplete(seg.id)}
                          className={`p-1 rounded-md transition-colors ${
                            seg.isCompleted ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'
                          }`}
                          title={seg.isCompleted ? 'تم بث الفقرة' : 'تحديد كتم البث'}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </td>

                      {/* Title & Script excerpt */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800 text-sm">{seg.title}</div>
                        {seg.scriptText && (
                          <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5" title={seg.scriptText}>
                            {seg.scriptText}
                          </p>
                        )}
                      </td>

                      {/* Type Badge */}
                      <td className="py-3.5 px-3">
                        <Badge variant={badgeInfo.variant} size="sm">
                          {badgeInfo.label}
                        </Badge>
                      </td>

                      {/* Start Offset */}
                      <td className="py-3.5 px-3 text-center font-mono text-slate-600 font-semibold bg-slate-50/50">
                        {seg.startTimeOffset}
                      </td>

                      {/* Duration */}
                      <td className="py-3.5 px-3 text-center font-mono font-bold text-blue-700 bg-blue-50/30">
                        {durationStr}
                      </td>

                      {/* End Offset */}
                      <td className="py-3.5 px-3 text-center font-mono text-slate-600 font-semibold bg-slate-50/50">
                        {seg.endTimeOffset}
                      </td>

                      {/* Presenter / Guest */}
                      <td className="py-3.5 px-3">
                        <div className="space-y-0.5">
                          {seg.presenterName && (
                            <div className="flex items-center gap-1 text-slate-700 font-medium">
                              <UserIcon className="w-3 h-3 text-slate-400" />
                              <span>{seg.presenterName}</span>
                            </div>
                          )}
                          {seg.guestName && (
                            <div className="flex items-center gap-1 text-purple-700 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                              <span>الضيف: {seg.guestName}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Notes & Linked News/Video */}
                      <td className="py-3.5 px-3">
                        <div className="space-y-1">
                          {seg.videoAssetUrl && (
                            <div className="flex items-center gap-1 text-[11px] text-red-600">
                              <Video className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[120px]">فيديو مرفق</span>
                            </div>
                          )}
                          {seg.newsTitle && (
                            <div className="flex items-center gap-1 text-[11px] text-blue-600">
                              <FileText className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[120px]" title={seg.newsTitle}>
                                {seg.newsTitle}
                              </span>
                            </div>
                          )}
                          {seg.notes && (
                            <span className="text-[11px] text-slate-500 italic block">{seg.notes}</span>
                          )}
                        </div>
                      </td>

                      {/* Readiness per department */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {segmentReadiness(seg, episodeRecord, readinessCtx).map((item) => (
                            <span
                              key={item.key}
                              title={`${departmentName(item.departmentId)}: ${item.detail}`}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${
                                item.state === 'ready'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : item.state === 'pending'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}
                            >
                              {item.state === 'ready' ? '✓' : item.state === 'pending' ? '…' : '✗'} {item.label}
                            </span>
                          ))}
                          {canRequest && seg.segmentType !== 'BREAK' && (
                            <button
                              type="button"
                              onClick={() =>
                                setRequestDraft({
                                  title: '',
                                  link: { kind: 'segment', episodeId, segmentId: seg.id, title: `${episodeRecord?.title || 'حلقة'} — ${seg.title}` },
                                })
                              }
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-dashed border-violet-300 text-violet-700 hover:bg-violet-50"
                              title="طلب مونتاج أو جرافيك أو استديو لهذه الفقرة"
                            >
                              + طلب
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Action buttons */}
                      {canEdit && (
                        <td className="py-3.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMove(idx, 'UP')}
                              disabled={idx === 0}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:hover:bg-transparent"
                              title="تحريك لأعلى"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMove(idx, 'DOWN')}
                              disabled={idx === segments.length - 1}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:hover:bg-transparent"
                              title="تحريك لأسفل"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSegment(seg);
                                setIsAddModalOpen(true);
                              }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded-md"
                              title="تعديل الفقرة"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(seg.id)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded-md"
                              title="حذف الفقرة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Segment Modal */}
      <RequestFormPage isOpen={!!requestDraft} onClose={() => setRequestDraft(null)} draft={requestDraft || undefined} onCreated={(t) => { setSyncStatusMsg(t); setTimeout(() => setSyncStatusMsg(null), 4000); }} />

      <SegmentModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingSegment(null);
        }}
        onSave={handleSaveSegment}
        segment={editingSegment}
        guests={guests}
        newsList={newsList}
        defaultPresenter={defaultPresenter}
      />

      {/* Broadcast Teleprompter Modal */}
      <TeleprompterModal
        isOpen={isPrompterOpen}
        onClose={() => setIsPrompterOpen(false)}
        segments={segments}
        episodeTitle="شاشة الملقن للفقرات (Teleprompter)"
      />

    </div>
  );
};
