import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { countLabel } from '../shared/labels';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { normalizeTaskStatus, priorityLabel, statusLabel } from '../shared/labels';
import { matchesQuery } from '../shared/search';
import { FormPage } from '../components/common/FormPage';
import { useFormDraft } from '../hooks/useFormDraft';
import { apiService } from '../services/api';
import { toLocalInputValue, fromLocalInputValue } from '../shared/dates';
import { RbacService } from '../services/rbacService';
import React, { useEffect, useState } from 'react';
import { Plus, Clock, User as UserIcon, Search, Trash2, Edit2, Link2, ChevronDown, CheckSquare } from 'lucide-react';
import { confirmDialog } from '../services/dialogs';
import { TASK_BOARD_COLUMNS, TASK_STATUS_OPTIONS, RELATED_ENTITY_LABELS, canChangeTaskStatus, isMyTask, relatedTaskPath, savedTaskView, saveTaskView, type TaskView } from '../services/taskBoard';
import { EditorialTask, TaskStatus, NewsPriority, User } from '../types';

/** Whole days a task is past its due time (0 when not overdue or already done). */
function overdueDays(t: EditorialTask): number {
  if (!t.dueDate || ['COMPLETED', 'CANCELLED'].includes(normalizeTaskStatus(t.status))) return 0;
  const late = Date.now() - new Date(t.dueDate).getTime();
  return late > 0 ? Math.max(1, Math.floor(late / 86_400_000)) : 0;
}

const OverdueBadge: React.FC<{ task: EditorialTask }> = ({ task }) => {
  const days = overdueDays(task);
  if (!days) return null;
  return (
    <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-2xs font-bold whitespace-nowrap">
      متأخرة {countLabel(days, { zero: '', one: 'يوماً واحداً', two: 'يومين', few: 'أيام', many: 'يوماً' })}
    </span>
  );
};
import { Badge } from '../components/common/Badge';
import { SortableItem, SortableList, SortableScope } from '../components/dnd/Sortable';
import { notify } from '../services/notify';

interface TasksViewProps {
  tasks: EditorialTask[];
  currentUser: User;
  /** Resolves false when the server refused the task (the form then stays open). */
  onSaveTask: (task: Partial<EditorialTask>) => boolean | void | Promise<boolean | void>;
  onDeleteTask: (taskId: string) => void;
  /** Opens an in-app address (e.g. '/bulletins/<id>') for the record a task was created from. */
  onOpenLink?: (path: string) => void;
  /** A task to highlight and scroll to (notifications link to /tasks/<id>). */
  focusId?: string | null;
}

/** One priority vocabulary on the board and in the list: urgent in red, high in amber. */
const priorityVariant = (p?: string) => (p === 'URGENT' || p === 'CRITICAL' ? 'danger' : p === 'HIGH' ? 'warning' : 'default');

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, URGENT: 0, HIGH: 1, NORMAL: 2, MEDIUM: 2, LOW: 3 };
const dueTime = (t: { dueDate?: string }) => (t.dueDate ? Date.parse(t.dueDate) || Infinity : Infinity);

const cmp = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);

/** Board order: urgent first, then soonest due (no due date last); for finished tasks the latest first. */
function compareForBoard(a: EditorialTask, b: EditorialTask, finished: boolean) {
  if (finished) return cmp(Number.isFinite(dueTime(b)) ? dueTime(b) : 0, Number.isFinite(dueTime(a)) ? dueTime(a) : 0);
  return cmp(PRIORITY_RANK[a.priority as string] ?? 2, PRIORITY_RANK[b.priority as string] ?? 2) || cmp(dueTime(a), dueTime(b));
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks = [],
  currentUser,
  onSaveTask,
  onDeleteTask,
  onOpenLink,
  focusId,
}) => {
  // Assignees may still move their own tasks; creating, reassigning and deleting need tasks.create_assign.
  const canAssign = RbacService.hasPermission(currentUser, 'tasks.create_assign');
  const [activeTab, setActiveTabState] = useState<TaskView>(savedTaskView);
  const setActiveTab = (view: TaskView) => {
    setActiveTabState(view);
    saveTaskView(view);
  };
  /** Status buttons and dragging only on tasks this colleague may move (the server refuses the rest). */
  const canMove = (t: EditorialTask) => canChangeTaskStatus(t, currentUser.id, canAssign);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  // Colleagues who only carry out tasks start on their own; task managers see the whole team.
  const [mineOnly, setMineOnly] = useState(!canAssign);
  const [showCancelled, setShowCancelled] = useState(false);
  // Each kanban column draws a page at a time: years of finished tasks would otherwise fill the board.
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>({});
  const columnLimit = (status: string) => columnLimits[status] ?? 30;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EditorialTask | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<NewsPriority>('NORMAL');
  const [dueDate, setDueDate] = useState(toLocalInputValue());
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  // Tasks are assigned to real accounts so the assignee is notified and can update the task.
  const assignableUsers = apiService.getUsers().filter((u) => u.isActive !== false && !u.deletedAt);
  const [status, setStatus] = useState<TaskStatus>('TODO');
  const [saving, setSaving] = useState(false);
  const draft = useFormDraft(`task:${currentUser.id}:${editingTask?.id || 'new'}`, isModalOpen,
    { title, description, priority, dueDate, assigneeId, status }, value => {
      setTitle(value.title); setDescription(value.description); setPriority(value.priority);
      setDueDate(value.dueDate); setAssigneeId(value.assigneeId); setStatus(value.status);
    });

  const TASK_TEMPLATES = [
    'تصوير تقرير ميداني VT مع المقابلات',
    'تغطية المؤتمر الصحفي والبث المباشر',
    'إعداد مادة أوتوكيو لنشرة الثامنة',
    'التنسيق والحجز مع ضيف الاستوديو',
    'تدقيق لغوي وصحفي لملف التغطية',
  ];


  const handleSetDeadlinePreset = (hoursToAdd: number) => {
    const target = new Date(Date.now() + hoursToAdd * 3600 * 1000);
    setDueDate(toLocalInputValue(target));
  };

  const handleOpenAdd = () => {
    setEditingTask(null);
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setDueDate(toLocalInputValue(new Date(Date.now() + 86400000)));
    setAssigneeId(currentUser.id);
    setStatus('TODO');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (t: EditorialTask) => {
    setEditingTask(t);
    setTitle(t.title);
    setDescription(t.description || '');
    setPriority(t.priority);
    setDueDate(toLocalInputValue(t.dueDate || new Date()));
    setAssigneeId(t.assigneeId || t.assignedToId || currentUser.id);
    setStatus(normalizeTaskStatus(t.status) as TaskStatus);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    const assignee = assignableUsers.find((u) => u.id === assigneeId) || currentUser;
    const assignedToName = assignee.fullName;
    try {
    const saved = await onSaveTask({
      id: editingTask?.id,
      title,
      description,
      priority,
      dueDate: fromLocalInputValue(dueDate) || new Date(Date.now() + 86400000).toISOString(),
      assignedToName,
      assigneeName: assignedToName,
      status,
      assignedToId: assignee.id,
      assigneeId: assignee.id,
      assigneeAvatar: assignee.avatarUrl,
      ...(editingTask ? {} : { createdById: currentUser.id, createdByName: currentUser.fullName }),
    });
    if (saved !== false) { draft.clearDraft(); setIsModalOpen(false); }
    } finally { setSaving(false); }
  };

  const handleQuickStatusChange = (taskId: string, newStatus: TaskStatus) => {
    onSaveTask({ id: taskId, status: newStatus });
  };

  const handleDelete = async (t: EditorialTask) => {
    const ok = await confirmDialog({
      title: 'حذف المهمة',
      message: `حذف المهمة «${t.title}»؟ سيختفي التكليف من لوحة المسؤول عنه.`,
      confirmLabel: 'حذف المهمة',
      danger: true,
    });
    if (ok) onDeleteTask(t.id);
  };

  // A bulletin story opens its bulletin; the story itself has no address of its own.
  const bulletinOfStory = (storyId: string) => apiService.getBulletinStories().find((s) => s.id === storyId)?.bulletinId;
  const relatedChip = (task: EditorialTask) => {
    if (!task.relatedEntityId || !task.relatedEntityType || task.relatedEntityType === 'GENERAL') return null;
    const kind = RELATED_ENTITY_LABELS[task.relatedEntityType] || 'سجل';
    const text = `${kind}: ${task.relatedEntityTitle || 'بلا عنوان'}`;
    const path = relatedTaskPath(task, bulletinOfStory);
    if (!path || !onOpenLink) {
      return (
        <span className="inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-2xs font-semibold">
          <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{text}</span>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenLink(path)}
        title={`فتح ${text}`}
        className="inline-flex items-center gap-1 max-w-full min-h-8 px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-2xs font-semibold focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{text}</span>
      </button>
    );
  };

  // A notification link (/tasks/<id>) brings that task into view: clear the filters that might hide it, then scroll to it.
  useEffect(() => {
    if (!focusId) return;
    const task = tasks.find((t) => t.id === focusId);
    if (!task) return;
    const st = normalizeTaskStatus(task.status);
    setActiveTabState('KANBAN');
    setSearchQuery('');
    setSelectedStatus('ALL');
    setMineOnly(false);
    if (st === 'CANCELLED') setShowCancelled(true);
    setColumnLimits((c) => ({ ...c, [st]: Math.max(c[st] ?? 30, tasks.filter((x) => normalizeTaskStatus(x.status) === st).length) }));
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(focusId)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
    // Only when the target changes (not on every task update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, tasks.some((t) => t.id === focusId)]);

  // One status vocabulary for the board and the table (older tasks use DONE for completed).
  const assigneeOf = (t: EditorialTask) =>
    t.assigneeName || t.assignedToName || apiService.getUsers().find((u) => u.id === (t.assigneeId || t.assignedToId))?.fullName || 'غير مسندة';
  const filteredTasks = (tasks || []).map((t) => ({ ...t, status: normalizeTaskStatus(t.status) as TaskStatus })).filter((t) => {
    if (selectedStatus !== 'ALL' && t.status !== selectedStatus) return false;
    if (mineOnly && !isMyTask(t, currentUser.id)) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, t.title, t.description, assigneeOf(t), t.relatedEntityTitle);
    }
    return true;
  });

  const taskListPage = useIncremental(filteredTasks, 50, `${searchQuery}|${selectedStatus}|${mineOnly}`);

  const columns = TASK_BOARD_COLUMNS;
  const isFinished = (s: TaskStatus) => s === 'COMPLETED' || s === 'CANCELLED';
  const focusRing = (id: string) => (focusId === id ? 'ring-2 ring-blue-500 ring-offset-2' : '');

  const quickMoves: { status: TaskStatus; label: string; className: string }[] = [
    { status: 'TODO', label: '← مطلوبة', className: 'bg-slate-100 hover:bg-slate-200 text-slate-600' },
    { status: 'IN_PROGRESS', label: 'قيد التنفيذ', className: 'bg-blue-50 hover:bg-blue-100 text-blue-700' },
    { status: 'IN_REVIEW', label: 'قيد المراجعة', className: 'bg-amber-50 hover:bg-amber-100 text-amber-800' },
    { status: 'COMPLETED', label: 'إنجاز ✓', className: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700' },
  ];

  const renderCard = (t: EditorialTask, colStatus: TaskStatus) => (
    <SortableItem
      key={t.id}
      id={t.id}
      container={`col:${colStatus}`}
      label={t.title}
      disabled={!canMove(t)}
      data-task-id={t.id}
      tabIndex={-1}
      className={`bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-all space-y-2.5 outline-hidden ${focusRing(t.id)}`}
    >
      {({ handle }) => (
      <>
      <div className="flex items-start justify-between gap-2">
        {handle}
        <Badge
          variant={priorityVariant(t.priority)}
          size="sm"
        >
          {priorityLabel(t.priority)}
        </Badge>
        <div className="flex items-center gap-1">
          {canAssign && (
          <button
            type="button"
            onClick={() => handleOpenEdit(t)}
            aria-label={`تعديل المهمة: ${t.title}`}
            title="تعديل المهمة"
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          )}
          {canAssign && (
          <button
            type="button"
            onClick={() => void handleDelete(t)}
            aria-label={`حذف المهمة: ${t.title}`}
            title="حذف المهمة"
            className="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          )}
        </div>
      </div>

      <h4 className="text-xs font-bold text-slate-800 leading-snug">{t.title}</h4>

      {t.description && (
        <p className="text-2xs text-slate-500 line-clamp-2">{t.description}</p>
      )}

      {relatedChip(t)}

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-2xs text-slate-500">
        <div className="flex items-center gap-1">
          <UserIcon className="w-3 h-3 text-slate-500" />
          <span className="font-semibold text-slate-700">{assigneeOf(t)}</span>
        </div>
        <div className={`flex items-center gap-1 tabular-nums ${overdueDays(t) ? 'text-amber-800' : 'text-slate-500'}`}>
          <OverdueBadge task={t} />
          <Clock className="w-3 h-3" />
          <span>{t.dueDate ? new Date(t.dueDate).toLocaleDateString(appLocale(), { ...zoneOptions(), day: 'numeric', month: 'short' }) : ''}</span>
        </div>
      </div>

      {/* Quick Move Buttons: only on tasks this colleague may move */}
      {canMove(t) && <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-end gap-1">
        {quickMoves.filter((m) => m.status !== colStatus).map((m) => (
          <button
            key={m.status}
            type="button"
            onClick={() => handleQuickStatusChange(t.id, m.status)}
            className={`min-h-7 text-2xs px-2 py-0.5 rounded font-semibold ${m.className}`}
          >
            {m.label}
          </button>
        ))}
      </div>}
      </>
      )}
    </SortableItem>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-blue-600" />
            المهام
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            المهام المسندة إلى الزملاء: من ينفّذ ماذا، وموعد التسليم، وأين وصل العمل.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div role="group" aria-label="طريقة العرض" className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 text-xs font-bold">
            <button
              type="button"
              aria-pressed={activeTab === 'KANBAN'}
              onClick={() => setActiveTab('KANBAN')}
              className={`min-h-9 px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'KANBAN' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600'
              }`}
            >
              لوحة
            </button>
            <button
              type="button"
              aria-pressed={activeTab === 'LIST'}
              onClick={() => setActiveTab('LIST')}
              className={`min-h-9 px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'LIST' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600'
              }`}
            >
              قائمة
            </button>
          </div>

          {canAssign && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            <Plus className="w-4 h-4" />
            تكليف بمهمة
          </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="tasks-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم أو الشخص المسؤول..."
            className="w-full pr-9 pl-4 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="tasks-status-filter" className="text-xs text-slate-600 font-medium">الحالة:</label>
          <select
            id="tasks-status-filter"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium transition-all"
          >
            <option value="ALL">جميع الحالات</option>
            {TASK_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label htmlFor="tasks-mine-only" className="inline-flex items-center gap-2 min-h-11 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
            <input
              id="tasks-mine-only"
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            مهامي فقط
          </label>
        </div>
      </div>

      {/* KANBAN VIEW */}
      {activeTab === 'KANBAN' ? (
        <SortableScope
          onDrop={({ id, from, to }) => {
            if (from === to) return;
            const task = tasks.find((x) => x.id === id);
            if (task && !canMove(task)) return;
            const status = to.slice(4) as TaskStatus;
            const previous = task?.status;
            handleQuickStatusChange(id, status);
            const label = columns.find((c) => c.status === status)?.label || status;
            notify({
              type: 'success',
              message: `نُقلت «${task?.title || ''}» إلى ${label}`,
              action: previous ? { label: 'تراجع', run: () => handleQuickStatusChange(id, previous) } : undefined,
            });
          }}
        >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
          {columns.filter((col) => !col.collapsible).map((col) => {
            // Open columns lead with what is urgent and due first; finished work shows the latest first.
            const colTasks = filteredTasks.filter((t) => t.status === col.status).sort((a, b) => compareForBoard(a, b, isFinished(col.status)));

            return (
              <SortableList
                key={col.status}
                id={`col:${col.status}`}
                aria-label={col.label}
                className="bg-slate-50/80 rounded-2xl p-3 border border-slate-200 flex flex-col min-h-[450px]"
              >
                <div className={`flex items-center justify-between pb-3 mb-3 border-b-2 ${col.color}`}>
                  <h3 className="text-xs font-bold text-slate-700">{col.label}</h3>
                  <span className="w-5 h-5 rounded-full bg-white text-slate-700 text-2xs font-bold flex items-center justify-center shadow-2xs font-mono">
                    {colTasks.length}
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {colTasks.slice(0, columnLimit(col.status)).map((t) => renderCard(t, col.status))}
                  <ShowMore remaining={Math.max(0, colTasks.length - columnLimit(col.status))} onMore={() => setColumnLimits((c) => ({ ...c, [col.status]: columnLimit(col.status) + 30 }))} noun="مهمة" className="!py-1" />
                </div>
              </SortableList>
            );
          })}
        </div>
        {columns.filter((col) => col.collapsible).map((col) => {
          const colTasks = filteredTasks.filter((t) => t.status === col.status).sort((a, b) => compareForBoard(a, b, true));
          return (
            <section key={col.status} className="mt-4 bg-slate-50/80 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => setShowCancelled((v) => !v)}
                aria-expanded={showCancelled}
                aria-controls={`tasks-col-${col.status}`}
                className="w-full min-h-11 flex items-center justify-between gap-2 px-4 rounded-2xl text-xs font-bold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="flex items-center gap-2">
                  <ChevronDown className={`w-4 h-4 transition-transform ${showCancelled ? '' : 'rotate-90'}`} aria-hidden="true" />
                  {col.label}
                </span>
                <span className="min-w-5 h-5 px-1 rounded-full bg-white text-slate-700 text-2xs font-bold flex items-center justify-center shadow-2xs font-mono">
                  {colTasks.length}
                </span>
              </button>
              {showCancelled && (
                <div id={`tasks-col-${col.status}`}>
                <SortableList
                  id={`col:${col.status}`}
                  aria-label={col.label}
                  className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 min-h-16"
                >
                  {colTasks.length === 0 && <p className="text-2xs text-slate-500 py-2">لا توجد مهام ملغاة.</p>}
                  {colTasks.slice(0, columnLimit(col.status)).map((t) => renderCard(t, col.status))}
                  <ShowMore remaining={Math.max(0, colTasks.length - columnLimit(col.status))} onMore={() => setColumnLimits((c) => ({ ...c, [col.status]: columnLimit(col.status) + 30 }))} noun="مهمة" className="!py-1 col-span-full" />
                </SortableList>
                </div>
              )}
            </section>
          );
        })}
        </SortableScope>
      ) : (
        /* LIST VIEW */
        <div role="region" aria-label="قائمة المهام" tabIndex={0} className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-2xs">
          <table className="w-full min-w-[720px] text-right text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <th scope="col" className="py-3 px-4">عنوان المهمة</th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">الأولوية</th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">المسؤول المكلف</th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">تاريخ الاستحقاق</th>
                <th scope="col" className="py-3 px-3">الحالة</th>
                <th scope="col" className="py-3 px-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                    {tasks.length === 0 ? 'لا مهام بعد.' : mineOnly && !searchQuery && selectedStatus === 'ALL' ? 'لا مهام مسندة إليك الآن. ألغِ «مهامي فقط» لرؤية مهام الفريق.' : 'لا مهام تطابق البحث أو التصفية.'}
                  </td>
                </tr>
              )}
              {taskListPage.visible.map((t) => (
                <tr key={t.id} data-task-id={t.id} tabIndex={-1} className={`hover:bg-slate-50/70 outline-hidden ${focusId === t.id ? 'bg-blue-50' : ''}`}>
                  <td className="py-3 px-4 font-bold text-slate-800">
                    <div className="space-y-1">
                      <div>{t.title}</div>
                      {relatedChip(t)}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <Badge variant={priorityVariant(t.priority)} size="sm">
                      {priorityLabel(t.priority)}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-700">{assigneeOf(t)}</td>
                  <td className="py-3 px-3 tabular-nums text-slate-600">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={overdueDays(t) ? 'text-amber-800 font-semibold' : ''}>{t.dueDate ? new Date(t.dueDate).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' }) : '—'}</span>
                      <OverdueBadge task={t} />
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {canMove(t) && t.status !== 'CANCELLED' ? (
                      <select
                        aria-label={`حالة المهمة: ${t.title}`}
                        value={t.status}
                        onChange={(e) => handleQuickStatusChange(t.id, e.target.value as TaskStatus)}
                        className="min-h-9 px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                      >
                        {TASK_STATUS_OPTIONS.filter((o) => canAssign || o.value !== 'CANCELLED').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <Badge
                        variant={t.status === 'COMPLETED' ? 'success' : t.status === 'IN_PROGRESS' ? 'primary' : t.status === 'BLOCKED' ? 'danger' : t.status === 'CANCELLED' ? 'default' : 'warning'}
                        size="sm"
                      >
                        {statusLabel(t.status, 'task')}
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {canAssign && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(t)}
                        aria-label={`تعديل المهمة: ${t.title}`}
                        title={`تعديل المهمة: ${t.title}`}
                        className="w-11 h-11 inline-flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      )}
                      {canAssign && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(t)}
                        aria-label={`حذف المهمة: ${t.title}`}
                        title={`حذف المهمة: ${t.title}`}
                        className="w-11 h-11 inline-flex items-center justify-center text-red-700 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowMore remaining={taskListPage.remaining} onMore={taskListPage.showMore} onAll={taskListPage.showAll} noun="مهمة" className="border-t border-slate-100" />
        </div>
      )}

      {/* Task Add / Edit Modal */}
      <FormPage
        isOpen={isModalOpen}
        draft={draft}
        onClose={() => setIsModalOpen(false)}
        title={editingTask ? 'تعديل المهمة التحريرية' : 'إسناد وتكليف بمهمة صحفية'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="task-title-input" className="block text-xs font-bold text-slate-700">عنوان المهمة الصحفية *</label>
              {title && (
                <button
                  type="button"
                  onClick={() => setTitle('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="task-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: تصوير تقرير ميداني عن فعاليات القمة"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500"
            />
            {/* Quick Title Templates */}
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-2xs text-slate-500 font-bold">قوالب مهام:</span>
              {TASK_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl}
                  type="button"
                  onClick={() => setTitle(tmpl)}
                  className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-1.5 py-0.5 rounded transition-colors"
                >
                  {tmpl.slice(0, 20)}...
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="task-desc-textarea" className="block text-xs font-bold text-slate-700 mb-1">التفاصيل والتوجيهات الفنية</label>
            <textarea
              id="task-desc-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="وصف المطلوب، المقابلات المطلوبة، وزمن التقرير، والتنسيق مع المصورين..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="task-assignee-input" className="block text-xs font-bold text-slate-700 mb-1">المكلف بالمهمة الصحفية</label>
            <select
              id="task-assignee-input"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} — {u.jobTitle}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-priority-select" className="block text-xs font-bold text-slate-700 mb-1">درجة الأولوية</label>
              <select
                id="task-priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as NewsPriority)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-bold focus:ring-2 focus:ring-blue-500"
              >
                <option value="URGENT">🔴 عاجل وفوري</option>
                <option value="HIGH">🟠 أولوية عالية</option>
                <option value="NORMAL">🔵 أولوية عادية</option>
                <option value="LOW">⚪ أولوية منخفضة</option>
              </select>
            </div>

            <div>
              <label htmlFor="task-status-select" className="block text-xs font-bold text-slate-700 mb-1">حالة المعالجة</label>
              <select
                id="task-status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-bold focus:ring-2 focus:ring-blue-500"
              >
                {TASK_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="task-due-date-input" className="block text-xs font-bold text-slate-700">تاريخ وموعد التسليم النهائي</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSetDeadlinePreset(2)}
                  className="text-2xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100"
                >
                  +2س
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDeadlinePreset(6)}
                  className="text-2xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200"
                >
                  +6س
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDeadlinePreset(24)}
                  className="text-2xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200"
                >
                  غداً
                </button>
              </div>
            </div>
            <input
              id="task-due-date-input"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void draft.close(() => setIsModalOpen(false))}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              حفظ المهمة
            </button>
          </div>
        </form>
      </FormPage>
    </div>
  );
};
