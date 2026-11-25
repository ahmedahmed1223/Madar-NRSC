import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { countLabel } from '../shared/labels';
import { appLocale, zoneOptions } from '../shared/dateFormat';
import { priorityLabel, statusLabel } from '../shared/labels';
import { matchesQuery } from '../shared/search';
import { FormPage } from '../components/common/FormPage';
import { useFormDraft } from '../hooks/useFormDraft';
import { apiService } from '../services/api';
import { toLocalInputValue, fromLocalInputValue } from '../shared/dates';
import { RbacService } from '../services/rbacService';
import React, { useEffect, useRef, useState } from 'react';
import { newId } from '../shared/ids';
import { ENTITY_ID_PATTERN } from '../shared/collections';
import { Plus, Clock, User as UserIcon, Search, Trash2, Edit2, Link2, ChevronDown, CheckSquare, X } from 'lucide-react';
import { confirmDialog, promptDialog } from '../services/dialogs';
import { takeMessageTask, type MessageTaskOrigin } from '../services/messageWorkspace';
import { TASK_BOARD_COLUMNS, TASK_PERIOD_OPTIONS, TASK_STATUS_OPTIONS, RELATED_ENTITY_LABELS, canChangeTaskStatus, isMyTask, relatedTaskPath, savedTaskView, saveTaskView, taskPeriodMatcher, taskStatusChoices, type TaskPeriod, type TaskView } from '../services/taskBoard';
import { EditorialTask, TaskStatus, NewsPriority, User } from '../types';
import { assignedWorkOnly } from '../shared/assignedWork';
import { assignmentScope } from '../shared/assignmentScope';
import type { WorkReminderOptions } from '../shared/workReminders';
import { WorkReminderFields } from '../components/common/WorkReminderFields';
import { departmentsOf, departmentWorkScope } from '../shared/departments';
import { normalizeTaskStatus, taskDurationLabel, taskTiming } from '../shared/taskWorkflow';
import { dataStore } from '../services/dataStore';
import { useLiveData } from '../hooks/useLiveData';

/** Whole days a task is past its due time (0 when not overdue or already done). */
function overdueDays(t: EditorialTask, now = Date.now()): number {
  if (!t.dueDate || ['COMPLETED', 'CANCELLED'].includes(normalizeTaskStatus(t.status))) return 0;
  const late = now - new Date(t.dueDate).getTime();
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

function TaskExecution({ task, now }: { task: EditorialTask; now: number }) {
  const { activeSeconds, elapsedSeconds } = taskTiming(task, now);
  if (elapsedSeconds === null) return null;
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-slate-600">
    <span>مدة التنفيذ {taskDurationLabel(activeSeconds)}</span>
    <span>المدة الكلية {taskDurationLabel(elapsedSeconds)}</span>
  </div>;
}
import { Badge } from '../components/common/Badge';
import { SortableItem, SortableList, SortableScope } from '../components/dnd/Sortable';
import { notify } from '../services/notify';

interface TasksViewProps {
  focusId?: string | null;
  onClearFocus?: () => void;
  tasks: EditorialTask[];
  currentUser: User;
  /** Resolves false when the server refused the task (the form then stays open). */
  onSaveTask: (task: Partial<EditorialTask>) => boolean | void | Promise<boolean | void>;
  onDeleteTask: (taskId: string) => void;
  /** Opens an in-app address (e.g. '/bulletins/<id>') for the record a task was created from. */
  onOpenLink?: (path: string) => void;
  openNewRequest?: boolean;
  onOpenNewHandled?: () => void;
}

/** One priority vocabulary on the board and in the list: urgent in red, high in amber. */
const priorityVariant = (p?: string) => (p === 'URGENT' || p === 'CRITICAL' ? 'danger' : p === 'HIGH' ? 'warning' : 'default');

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, URGENT: 0, HIGH: 1, NORMAL: 2, MEDIUM: 2, LOW: 3 };
const BLOCKED_REASON_LIMIT = 500;
const INITIAL_STATUS_OPTIONS = TASK_STATUS_OPTIONS.filter(option => option.value === 'TODO' || option.value === 'IN_PROGRESS');
const dueTime = (t: { dueDate?: string }) => (t.dueDate ? Date.parse(t.dueDate) || Infinity : Infinity);

const cmp = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);

/** Board order: urgent first, then soonest due (no due date last); for finished tasks the latest first. */
function compareForBoard(a: EditorialTask, b: EditorialTask, finished: boolean) {
  if (finished) return cmp(Number.isFinite(dueTime(b)) ? dueTime(b) : 0, Number.isFinite(dueTime(a)) ? dueTime(a) : 0);
  return cmp(PRIORITY_RANK[a.priority as string] ?? 2, PRIORITY_RANK[b.priority as string] ?? 2) || cmp(dueTime(a), dueTime(b));
}

export const TasksView: React.FC<TasksViewProps> = ({
  focusId,
  onClearFocus,
  tasks = [],
  currentUser,
  onSaveTask,
  onDeleteTask,
  onOpenLink,
  openNewRequest,
  onOpenNewHandled,
}) => {
  useLiveData(['settings', 'tasks'], 60_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const settings = apiService.getSettings();
  const workflow = settings.taskWorkflow;
  const assignedOnly = assignedWorkOnly(permission => RbacService.hasPermission(currentUser, permission));
  const scope = departmentWorkScope(currentUser.id, departmentsOf(settings));
  const scopedManager = !assignedOnly && scope.led.length > 0 && currentUser.role !== 'ADMIN' && currentUser.role !== 'SUPER_ADMIN';
  const allUsers = apiService.getUsers();
  const teamIds = scopedManager ? new Set(allUsers.filter(user => scope.departmentFor(user)).map(user => user.id)) : null;
  const eligibility = assignmentScope(currentUser, settings);
  const assignableUsers = allUsers.filter(user => (!teamIds || teamIds.has(user.id)) && !eligibility.errorFor(user));
  const canAssign = scopedManager || RbacService.hasPermission(currentUser, 'tasks.create_assign');
  const canManage = (task: EditorialTask) => teamIds ? teamIds.has(task.assigneeId || task.assignedToId || '') : canAssign;
  const [activeTab, setActiveTabState] = useState<TaskView>(() => focusId ? 'LIST' : savedTaskView());
  const setActiveTab = (view: TaskView) => {
    setActiveTabState(view);
    saveTaskView(view);
  };
  /** Status buttons and dragging only on tasks this colleague may move (the server refuses the rest). */
  const canMove = (t: EditorialTask) => canChangeTaskStatus(t, currentUser.id, canManage(t));
  const optionsFor = (t: EditorialTask, includeCurrent = false) =>
    taskStatusChoices(t.status, workflow, canManage(t), includeCurrent);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | NewsPriority>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [period, setPeriod] = useState<TaskPeriod>(() => {
    if (!assignedOnly || focusId) return 'ALL';
    const dueToday = taskPeriodMatcher('TODAY', now, settings.defaultTimezone);
    return tasks.some(task => isMyTask(task, currentUser.id) && dueToday(task)) ? 'TODAY' : 'ALL';
  });
  // Colleagues who only carry out tasks start on their own; task managers see the whole team.
  const [mineOnly, setMineOnly] = useState(!canAssign);
  const [showCancelled, setShowCancelled] = useState(false);
  // Each kanban column draws a page at a time: years of finished tasks would otherwise fill the board.
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>({});
  const columnLimit = (status: string) => columnLimits[status] ?? 30;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EditorialTask | null>(null);
  const [messageOrigin, setMessageOrigin] = useState<MessageTaskOrigin | null>(null);
  const focusedTask = focusId && ENTITY_ID_PATTERN.test(focusId) ? tasks.find(task => task.id === focusId && !(task as EditorialTask & { deletedAt?: string }).deletedAt && (!assignedOnly || isMyTask(task, currentUser.id))) : undefined;

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<NewsPriority>('NORMAL');
  const [dueDate, setDueDate] = useState(toLocalInputValue());
  const [reminderOptions, setReminderOptions] = useState<WorkReminderOptions>();
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [status, setStatus] = useState<TaskStatus>('TODO');
  const [blockedReason, setBlockedReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const newTaskId = useRef<string | null>(null);
  const moving = useRef(new Set<string>());
  const [movingTasks, setMovingTasks] = useState<ReadonlySet<string>>(new Set());
  const draft = useFormDraft(`task:${currentUser.id}:${editingTask?.id || (messageOrigin ? `message:${messageOrigin.channel}:${messageOrigin.messageId}` : 'new')}`, isModalOpen,
    { title, description, priority, dueDate, assigneeId, status, blockedReason, reminderOptions }, value => {
      setTitle(value.title); setDescription(value.description); setPriority(value.priority);
      setDueDate(value.dueDate); setAssigneeId(value.assigneeId); setStatus(normalizeTaskStatus(value.status));
      setBlockedReason(value.blockedReason || '');
      setReminderOptions(value.reminderOptions);
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
    newTaskId.current = null;
    setSaveError('');
    setEditingTask(null);
    setMessageOrigin(null);
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setDueDate(toLocalInputValue(new Date(Date.now() + 86400000)));
    setReminderOptions(undefined);
    setAssigneeId(teamIds && !teamIds.has(currentUser.id) ? assignableUsers[0]?.id || '' : currentUser.id);
    setStatus('TODO');
    setBlockedReason('');
    setIsModalOpen(true);
  };

  useEffect(() => {
    const origin = takeMessageTask(currentUser.id);
    if (!origin || !canAssign) return;
    handleOpenAdd();
    setMessageOrigin(origin);
    setTitle(origin.suggestedTitle);
  }, [currentUser.id, canAssign]);

  useEffect(() => {
    if (!openNewRequest) return;
    if (canAssign && !isModalOpen) handleOpenAdd();
    onOpenNewHandled?.();
    // Open once per request, using the current form defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewRequest]);

  const handleOpenEdit = (t: EditorialTask) => {
    setSaveError('');
    setEditingTask(t);
    setMessageOrigin(null);
    setTitle(t.title);
    setDescription(t.description || '');
    setPriority(t.priority);
    setDueDate(toLocalInputValue(t.dueDate || new Date()));
    setReminderOptions(t.reminderOptions);
    setAssigneeId(t.assigneeId || t.assignedToId || currentUser.id);
    setStatus(normalizeTaskStatus(t.status) as TaskStatus);
    setBlockedReason(t.blockedReason || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving || !(editingTask ? canManage(editingTask) : canAssign)) return;
    const reason = blockedReason.trim();
    const current = editingTask && apiService.getTasks().find(item => item.id === editingTask.id);
    if (editingTask && (!current || normalizeTaskStatus(current.status) !== normalizeTaskStatus(editingTask.status) || current.blockedReason !== editingTask.blockedReason)) {
      setSaveError('تغيّرت حالة المهمة منذ فتحها. افتح نسختها الحالية ثم أعد المحاولة.');
      return;
    }
    if (status === 'BLOCKED' && workflow?.requireBlockedReason && !reason && (normalizeTaskStatus(editingTask?.status) !== 'BLOCKED' || !!editingTask?.blockedReason)) {
      setSaveError('أدخل سبب توقف المهمة.');
      return;
    }
    if (!(editingTask ? optionsFor(editingTask, true) : INITIAL_STATUS_OPTIONS).some(option => option.value === status)) {
      setSaveError('الحالة المختارة غير متاحة لهذه المهمة. اختر حالة من القائمة.');
      return;
    }
    const originalAssignee = editingTask?.assigneeId || editingTask?.assignedToId;
    const assignee = (assigneeId === originalAssignee ? allUsers : assignableUsers).find(u => u.id === assigneeId);
    if (!assignee) { setSaveError('اختر مسؤولًا نشطًا عن المهمة.'); return; }
    const deadline = fromLocalInputValue(dueDate);
    if (!deadline) { setSaveError('حدد موعد تسليم صالحًا.'); return; }
    setSaving(true);
    setSaveError('');
    try {
    const id = editingTask?.id || newTaskId.current || newId('tsk');
    if (!editingTask) newTaskId.current = id;
    const saved = await onSaveTask({
      id,
      title,
      description,
      priority,
      dueDate: deadline,
      reminderOptions,
      assignedToName: assignee.fullName,
      assigneeName: assignee.fullName,
      status,
      ...(status === 'BLOCKED' && (reason || editingTask?.blockedReason) ? { blockedReason: reason } : {}),
      assignedToId: assignee.id,
      assigneeId: assignee.id,
      assigneeAvatar: assignee.avatarUrl,
      ...(editingTask ? {} : { createdById: currentUser.id, createdByName: currentUser.fullName }),
      ...(messageOrigin ? {
        relatedEntityType: 'MESSAGE',
        relatedEntityId: `${messageOrigin.channel}/entry/${messageOrigin.messageId}`,
        relatedEntityTitle: messageOrigin.label,
      } : {}),
    });
    if (saved !== false) { draft.clearDraft(); setIsModalOpen(false); }
    else setSaveError('لم يؤكد الخادم حفظ المهمة. احتفظنا بالبيانات لإعادة المحاولة.');
    } finally { setSaving(false); }
  };

  const handleQuickStatusChange = async (task: EditorialTask, newStatus: TaskStatus) => {
    const id = task.id;
    if (!canMove(task) || moving.current.has(id) || dataStore.hasPendingWrite('tasks', id)) return false;
    if (!optionsFor(task).some(option => option.value === newStatus)) {
      notify({ type: 'warning', message: 'هذه الحالة غير متاحة للمهمة الحالية.' });
      return false;
    }
    moving.current.add(id);
    setMovingTasks(new Set(moving.current));
    try {
      let reason: string | undefined;
      if (newStatus === 'BLOCKED') {
        const answer = await promptDialog({
          title: 'إيقاف المهمة',
          label: 'سبب التوقف',
          message: `ما الذي يعطّل «${task.title}»؟`,
          confirmLabel: 'حفظ الحالة',
          multiline: true,
          required: workflow?.requireBlockedReason,
        });
        if (answer === null) return false;
        reason = answer.trim();
        if (reason.length > BLOCKED_REASON_LIMIT) {
          notify({ type: 'warning', message: `اختصر سبب التوقف إلى ${BLOCKED_REASON_LIMIT} حرف.` });
          return false;
        }
      }
      const current = apiService.getTasks().find(item => item.id === id);
      if (apiService.getCurrentUser().id !== currentUser.id) return false;
      if (!current || !canMove(current) || normalizeTaskStatus(current.status) !== normalizeTaskStatus(task.status) || dataStore.hasPendingWrite('tasks', id)) {
        notify({ type: 'warning', message: 'تغيّرت المهمة. راجع حالتها الحالية قبل المحاولة مجددًا.' });
        return false;
      }
      return await onSaveTask({ id, status: newStatus, ...(newStatus === 'BLOCKED' ? { blockedReason: reason } : {}) }) !== false;
    } finally {
      moving.current.delete(id);
      setMovingTasks(new Set(moving.current));
    }
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
    if (assignedOnly || !path || !onOpenLink) {
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
    if (!focusId || !focusedTask) return;
    setActiveTabState('LIST');
    setSearchQuery('');
    setSelectedStatus('ALL');
    setPriorityFilter('ALL');
    setAssigneeFilter('ALL');
    setOverdueOnly(false);
    setPeriod('ALL');
    setMineOnly(false);
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(focusId)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
    // Only when the target changes (not on every task update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, !!focusedTask]);

  // One status vocabulary for the board and the table (older tasks use DONE for completed).
  const assigneeOf = (t: EditorialTask) =>
    t.assigneeName || t.assignedToName || apiService.getUsers().find((u) => u.id === (t.assigneeId || t.assignedToId))?.fullName || 'غير مسندة';
  const dueInPeriod = taskPeriodMatcher(period, now, settings.defaultTimezone);
  const assigneeIds = [...new Set((tasks || []).map(task => task.assigneeId || task.assignedToId).filter((id): id is string => !!id))];
  const assigneeOptions = assigneeIds.map(id => ({
    id,
    name: allUsers.find(user => user.id === id)?.fullName
      || (tasks || []).find(task => (task.assigneeId || task.assignedToId) === id)?.assigneeName
      || (tasks || []).find(task => (task.assigneeId || task.assignedToId) === id)?.assignedToName
      || 'غير معروف',
  })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const filteredTasks = (tasks || []).map((t) => ({ ...t, status: normalizeTaskStatus(t.status) as TaskStatus })).filter((t) => {
    if (focusedTask && t.id !== focusedTask.id) return false;
    if (selectedStatus !== 'ALL' && t.status !== selectedStatus) return false;
    if ((assignedOnly || mineOnly) && !isMyTask(t, currentUser.id)) return false;
    if (!focusedTask && !dueInPeriod(t)) return false;
    if (priorityFilter !== 'ALL' && !(priorityFilter === 'URGENT' ? t.priority === 'URGENT' || t.priority === 'CRITICAL' : t.priority === priorityFilter)) return false;
    if (assigneeFilter !== 'ALL' && (t.assigneeId || t.assignedToId) !== assigneeFilter) return false;
    if (overdueOnly && !overdueDays(t, now)) return false;
    return !searchQuery.trim() || matchesQuery(searchQuery, t.title, t.description, assigneeOf(t), t.relatedEntityTitle);
  });

  const taskCounts = {
    visible: filteredTasks.length,
    open: filteredTasks.filter(task => !['COMPLETED', 'CANCELLED'].includes(task.status)).length,
    overdue: filteredTasks.filter(task => overdueDays(task, now) > 0).length,
    blocked: filteredTasks.filter(task => task.status === 'BLOCKED').length,
    urgent: filteredTasks.filter(task => task.priority === 'URGENT' || task.priority === 'CRITICAL').length,
  };
  const taskListPage = useIncremental(filteredTasks, 50, `${searchQuery}|${selectedStatus}|${priorityFilter}|${assigneeFilter}|${overdueOnly}|${period}|${mineOnly}|${assignedOnly}`);
  const selectedDeadline = dueDate ? Date.parse(fromLocalInputValue(dueDate)) : NaN;
  const pastDueOpenTask = Number.isFinite(selectedDeadline) && selectedDeadline < now
    && !['COMPLETED', 'CANCELLED'].includes(normalizeTaskStatus(status));

  const columns = TASK_BOARD_COLUMNS;
  const isFinished = (s: TaskStatus) => s === 'COMPLETED' || s === 'CANCELLED';
  const focusRing = (id: string) => (focusId === id ? 'ring-2 ring-blue-500 ring-offset-2' : '');

  const pending = (task: EditorialTask) => movingTasks.has(task.id) || dataStore.hasPendingWrite('tasks', task.id);
  const movementControl = (task: EditorialTask) => {
    const current = normalizeTaskStatus(task.status);
    const options = canMove(task) ? optionsFor(task, true) : [];
    return <div className="space-y-1">
      {pending(task) && <p role="status" className="text-xs text-slate-600">بانتظار تأكيد نقل المهمة</p>}
      {options.length > 1 ? (
        <select
          aria-label={`حالة المهمة: ${task.title}`}
          value={current}
          disabled={pending(task)}
          onChange={(event) => void handleQuickStatusChange(task, event.target.value as TaskStatus)}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800"
        >
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : <Badge
        variant={current === 'COMPLETED' ? 'success' : current === 'IN_PROGRESS' ? 'primary' : current === 'BLOCKED' ? 'danger' : current === 'CANCELLED' ? 'default' : 'warning'}
        size="sm"
      >{statusLabel(current, 'task')}</Badge>}
      {current === 'BLOCKED' && task.blockedReason && <p className="text-xs text-rose-800 [overflow-wrap:anywhere]">سبب التوقف: {task.blockedReason}</p>}
    </div>;
  };

  const renderCard = (t: EditorialTask, colStatus: TaskStatus) => (
    <SortableItem
      key={t.id}
      id={t.id}
      container={`col:${colStatus}`}
      label={t.title}
      disabled={!canMove(t) || !optionsFor(t).length || pending(t)}
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
          {canManage(t) && (
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
          {canManage(t) && (
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

      <TaskExecution task={t} now={now} />
      {movementControl(t)}
      </>
      )}
    </SortableItem>
  );

  return (
    <div className="space-y-6">
      {focusId && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-2 text-sm text-slate-700">
        <span>{focusedTask ? 'المهمة المحددة' : 'العنصر المطلوب غير متاح؛ يمكنك متابعة العمل من القائمة.'}</span>
        <button type="button" onClick={onClearFocus} className="min-h-11 px-3 inline-flex items-center gap-2 text-blue-700"><X className="w-4 h-4" />عرض كل المهام</button>
      </div>}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-blue-600" />
            المهام
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {assignedOnly ? 'تابع المهام المسندة إليك وحدّث حالتها أثناء العمل.' : 'المهام المسندة إلى الزملاء ومواعيد تسليمها وحالة تنفيذها.'}
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
            aria-label="بحث في المهام"
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
          <label htmlFor="tasks-priority-filter" className="sr-only">الأولوية</label>
          <select id="tasks-priority-filter" aria-label="الأولوية" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as 'ALL' | NewsPriority)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800">
            <option value="ALL">كل الأولويات</option>
            <option value="URGENT">عاجل</option>
            <option value="HIGH">عالية</option>
            <option value="NORMAL">عادية</option>
            <option value="LOW">منخفضة</option>
          </select>
          <label htmlFor="tasks-assignee-filter" className="sr-only">المسؤول</label>
          <select id="tasks-assignee-filter" aria-label="المسؤول" value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800">
            <option value="ALL">كل المسؤولين</option>
            {assigneeOptions.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <label htmlFor="tasks-overdue-only" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
            <input id="tasks-overdue-only" type="checkbox" checked={overdueOnly} onChange={event => setOverdueOnly(event.target.checked)} className="size-4 accent-amber-600" />
            متأخرة فقط
          </label>
          <div className="inline-flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <label htmlFor="tasks-period">موعد التسليم</label>
            <select id="tasks-period" value={period} onChange={(event) => setPeriod(event.target.value as TaskPeriod)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800">
              {TASK_PERIOD_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {!assignedOnly && <label htmlFor="tasks-mine-only" className="inline-flex items-center gap-2 min-h-11 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
            <input
              id="tasks-mine-only"
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            مهامي فقط
          </label>}
          <button type="button" onClick={() => { setSearchQuery(''); setSelectedStatus('ALL'); setPriorityFilter('ALL'); setAssigneeFilter('ALL'); setOverdueOnly(false); setPeriod('ALL'); setMineOnly(false); }} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            إعادة ضبط الفلاتر
          </button>
        </div>
      </div>
      <dl aria-label="مؤشرات المهام" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'الظاهرة', value: taskCounts.visible },
          { label: 'مفتوحة', value: taskCounts.open },
          { label: 'متأخرة', value: taskCounts.overdue },
          { label: 'متعطلة', value: taskCounts.blocked },
          { label: 'عاجلة', value: taskCounts.urgent },
        ].map(item => <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <dt className="text-xs text-slate-600">{item.label}</dt>
          <dd className="font-mono text-xl font-bold tabular-nums text-slate-900">{item.value}</dd>
        </div>)}
      </dl>

      {/* KANBAN VIEW */}
      {activeTab === 'KANBAN' ? (
        <SortableScope
          onDrop={async ({ id, from, to }) => {
            if (from === to || !to.startsWith('col:')) return;
            const task = tasks.find((x) => x.id === id);
            const next = to.slice(4) as TaskStatus;
            if (!task || !await handleQuickStatusChange(task, next)) return;
            const previous = normalizeTaskStatus(task.status);
            const savedTask = apiService.getTasks().find(item => item.id === id && normalizeTaskStatus(item.status) === next);
            const canUndo = savedTask && optionsFor(savedTask).some(option => option.value === previous);
            notify({
              type: 'success',
              message: `نُقلت «${task.title}» إلى ${statusLabel(next, 'task')}`,
              action: canUndo ? { label: 'تراجع', run: () => { void handleQuickStatusChange(savedTask, previous); } } : undefined,
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
        <div role="region" aria-label="قائمة المهام" className="@container/task-list bg-white border border-slate-200 rounded-lg shadow-2xs">
          <table role="table" className="@max-[54rem]/task-list:block w-full text-start text-xs">
            <thead role="rowgroup" className="@max-[54rem]/task-list:sr-only">
              <tr role="row" className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <th role="columnheader" scope="col" className="py-3 px-4">عنوان المهمة</th>
                <th role="columnheader" scope="col" className="py-3 px-3">الأولوية</th>
                <th role="columnheader" scope="col" className="py-3 px-3">المسؤول المكلف</th>
                <th role="columnheader" scope="col" className="py-3 px-3">تاريخ الاستحقاق</th>
                <th role="columnheader" scope="col" className="py-3 px-3">الحالة</th>
                <th role="columnheader" scope="col" className="py-3 px-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="@max-[54rem]/task-list:block divide-y divide-slate-200">
              {filteredTasks.length === 0 && (
                <tr role="row" className="@max-[54rem]/task-list:block">
                  <td role="cell" colSpan={6} className="@max-[54rem]/task-list:block py-10 px-4 text-center text-slate-500">
                    {period !== 'ALL' ? <>
                      <p>لا مهام تطابق الفترة والفلاتر الحالية.</p>
                      <button type="button" onClick={() => setPeriod('ALL')} className="min-h-11 px-3 text-xs font-bold text-blue-700 hover:underline">عرض كل المواعيد</button>
                    </> : assignedOnly ? 'لا مهام مسندة إليك تطابق التصفية الحالية.' : tasks.length === 0 ? 'لا مهام بعد.' : mineOnly && !searchQuery && selectedStatus === 'ALL' ? 'لا مهام مسندة إليك الآن. ألغِ «مهامي فقط» لرؤية مهام الفريق.' : 'لا مهام تطابق البحث أو التصفية.'}
                  </td>
                </tr>
              )}
              {taskListPage.visible.map((t) => (
                <tr role="row" key={t.id} data-task-id={t.id} tabIndex={-1} className={`@max-[54rem]/task-list:grid @max-[54rem]/task-list:grid-cols-2 @max-[54rem]/task-list:gap-x-3 @max-[54rem]/task-list:gap-y-2.5 @max-[54rem]/task-list:p-3 hover:bg-slate-50/70 ${focusId === t.id ? 'bg-blue-50' : ''}`}>
                  <td role="cell" className="min-w-0 @max-[54rem]/task-list:col-span-2 @min-[54rem]/task-list:px-4 @min-[54rem]/task-list:py-3 font-bold text-slate-800 wrap-anywhere">
                    <div className="space-y-1">
                      <div className="@max-[54rem]/task-list:text-sm">{t.title}</div>
                      {relatedChip(t)}
                    </div>
                  </td>
                  <td role="cell" className="@min-[54rem]/task-list:p-3">
                    <div aria-hidden="true" className="mb-1 text-slate-500 @min-[54rem]/task-list:hidden">الأولوية</div>
                    <Badge variant={priorityVariant(t.priority)} size="sm">
                      {priorityLabel(t.priority)}
                    </Badge>
                  </td>
                  <td role="cell" className="min-w-0 @min-[54rem]/task-list:p-3 text-slate-700 wrap-anywhere">
                    <div aria-hidden="true" className="mb-1 text-slate-500 @min-[54rem]/task-list:hidden">المسؤول المكلف</div>
                    <span className="font-semibold">{assigneeOf(t)}</span>
                  </td>
                  <td role="cell" className="@max-[54rem]/task-list:col-span-2 @min-[54rem]/task-list:p-3 tabular-nums text-slate-600">
                    <div aria-hidden="true" className="mb-1 text-slate-500 @min-[54rem]/task-list:hidden">تاريخ الاستحقاق</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={overdueDays(t) ? 'text-amber-800 font-semibold' : ''}>{t.dueDate ? new Date(t.dueDate).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' }) : '—'}</span>
                      <OverdueBadge task={t} />
                    </div>
                    <TaskExecution task={t} now={now} />
                  </td>
                  <td role="cell" className="min-w-0 @min-[54rem]/task-list:p-3">
                    <div aria-hidden="true" className="mb-1 text-slate-500 @min-[54rem]/task-list:hidden">الحالة</div>
                    {movementControl(t)}
                  </td>
                  <td role="cell" className="@max-[54rem]/task-list:self-end @min-[54rem]/task-list:px-4 @min-[54rem]/task-list:py-3 text-center">
                    <div className="flex items-center justify-end @min-[54rem]/task-list:justify-center gap-1">
                      {canManage(t) && (
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
                      {canManage(t) && (
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
        onClose={() => { if (saving) return false; setIsModalOpen(false); }}
        title={editingTask ? 'تعديل المهمة التحريرية' : 'إسناد وتكليف بمهمة صحفية'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} aria-busy={saving} className="space-y-4">
          {saveError && <p role="alert" className="text-sm font-semibold text-rose-700">{saveError}</p>}
          <fieldset disabled={saving} className="space-y-4">
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
                  className="min-h-11 text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2 rounded-lg transition-colors"
                >
                  {tmpl}
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
              {!assignableUsers.some(user => user.id === assigneeId) && <option value={assigneeId} disabled>{allUsers.find(user => user.id === assigneeId)?.fullName || 'اختر مسؤولًا نشطًا'}</option>}
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
                {(editingTask ? optionsFor(editingTask, true) : INITIAL_STATUS_OPTIONS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {status === 'BLOCKED' && <label className="block space-y-1 text-xs font-bold text-slate-700">
            سبب التوقف
            <textarea
              value={blockedReason}
              onChange={(event) => setBlockedReason(event.target.value)}
              maxLength={BLOCKED_REASON_LIMIT}
              required={workflow?.requireBlockedReason && (normalizeTaskStatus(editingTask?.status) !== 'BLOCKED' || !!editingTask?.blockedReason)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              rows={3}
            />
          </label>}

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
            {pastDueOpenTask && <p role="status" className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">موعد التسليم الذي اخترته مضى، والمهمة ما زالت مفتوحة.</p>}
          </div>

          <WorkReminderFields value={reminderOptions} onChange={setReminderOptions} />
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
              {saving ? 'بانتظار تأكيد الخادم…' : 'حفظ المهمة'}
            </button>
          </div>
          </fieldset>
        </form>
      </FormPage>
    </div>
  );
};
