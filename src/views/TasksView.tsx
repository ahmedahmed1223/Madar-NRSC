import { apiService } from '../services/api';
import React, { useState } from 'react';
import {
  Plus,
  CheckSquare,
  Clock,
  User as UserIcon,
  Search,
  Filter,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Trash2,
  Edit2,
  ArrowRight,
  X,
  Sparkles,
  Check,
} from 'lucide-react';
import { EditorialTask, TaskStatus, NewsPriority, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';

interface TasksViewProps {
  tasks: EditorialTask[];
  currentUser: User;
  onSaveTask: (task: Partial<EditorialTask>) => void;
  onDeleteTask: (taskId: string) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks = [],
  currentUser,
  onSaveTask,
  onDeleteTask,
}) => {
  const [activeTab, setActiveTab] = useState<'KANBAN' | 'LIST'>('KANBAN');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<EditorialTask | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<NewsPriority>('NORMAL');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 16));
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  // Tasks are assigned to real accounts so the assignee is notified and can update the task.
  const assignableUsers = apiService.getUsers().filter((u) => u.isActive !== false && !u.deletedAt);
  const [status, setStatus] = useState<TaskStatus>('TODO');

  const TASK_TEMPLATES = [
    'تصوير تقرير ميداني VT مع المقابلات',
    'تغطية المؤتمر الصحفي والبث المباشر',
    'إعداد مادة أوتوكيو لنشرة الثامنة',
    'التنسيق والحجز مع ضيف الاستوديو',
    'تدقيق لغوي وصحفي لملف التغطية',
  ];


  const handleSetDeadlinePreset = (hoursToAdd: number) => {
    const target = new Date(Date.now() + hoursToAdd * 3600 * 1000);
    setDueDate(target.toISOString().slice(0, 16));
  };

  const handleOpenAdd = () => {
    setEditingTask(null);
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setDueDate(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    setAssigneeId(currentUser.id);
    setStatus('TODO');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (t: EditorialTask) => {
    setEditingTask(t);
    setTitle(t.title);
    setDescription(t.description || '');
    setPriority(t.priority);
    setDueDate(t.dueDate ? t.dueDate.slice(0, 16) : new Date().toISOString().slice(0, 16));
    setAssigneeId(t.assigneeId || t.assignedToId || currentUser.id);
    setStatus(t.status);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const assignee = assignableUsers.find((u) => u.id === assigneeId) || currentUser;
    const assignedToName = assignee.fullName;
    onSaveTask({
      id: editingTask?.id,
      title,
      description,
      priority,
      dueDate,
      assignedToName,
      assigneeName: assignedToName,
      status,
      assignedToId: assignee.id,
      assigneeId: assignee.id,
      assigneeAvatar: assignee.avatarUrl,
      ...(editingTask ? {} : { createdById: currentUser.id, createdByName: currentUser.fullName }),
    });
    setIsModalOpen(false);
  };

  const handleQuickStatusChange = (taskId: string, newStatus: TaskStatus) => {
    onSaveTask({ id: taskId, status: newStatus });
  };

  const filteredTasks = (tasks || []).filter((t) => {
    if (selectedStatus !== 'ALL' && t.status !== selectedStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const person = (t.assignedToName || t.assigneeName || '').toLowerCase();
      return t.title.toLowerCase().includes(q) || person.includes(q);
    }
    return true;
  });

  const columns: { status: TaskStatus; label: string; color: string }[] = [
    { status: 'TODO', label: 'المهام المطلوبة (To Do)', color: 'border-slate-300' },
    { status: 'IN_PROGRESS', label: 'قيد التنفيذ (In Progress)', color: 'border-blue-400' },
    { status: 'IN_REVIEW', label: 'قيد المراجعة والتدقيق', color: 'border-amber-400' },
    { status: 'COMPLETED', label: 'مكتملة ومنجزة', color: 'border-emerald-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            المهام التحريرية والإنتاجية
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            متابعة تكليفات المراسلين والمعدين، تواريخ التسليم، وسير العمل الصحفي
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('KANBAN')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'KANBAN' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600'
              }`}
            >
              لوحة كانبان
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('LIST')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'LIST' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600'
              }`}
            >
              جدول قائمة
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            <Plus className="w-4 h-4" />
            تكليف بمهمة
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="tasks-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم أو الشخص المسؤول..."
            className="w-full pr-9 pl-4 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="tasks-status-filter" className="text-xs text-slate-600 font-medium">الحالة:</label>
          <select
            id="tasks-status-filter"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium transition-all"
          >
            <option value="ALL">جميع الحالات</option>
            <option value="TODO">مطلوبة</option>
            <option value="IN_PROGRESS">قيد التنفيذ</option>
            <option value="IN_REVIEW">مراجعة</option>
            <option value="COMPLETED">مكتملة</option>
          </select>
        </div>
      </div>

      {/* KANBAN VIEW */}
      {activeTab === 'KANBAN' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {columns.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status);

            return (
              <div
                key={col.status}
                className="bg-slate-50/80 rounded-2xl p-3 border border-slate-200 flex flex-col min-h-[450px]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData('text/plain');
                  if (taskId) {
                    handleQuickStatusChange(taskId, col.status as TaskStatus);
                  }
                }}
              >
                <div className={`flex items-center justify-between pb-3 mb-3 border-b-2 ${col.color}`}>
                  <h3 className="text-xs font-bold text-slate-700">{col.label}</h3>
                  <span className="w-5 h-5 rounded-full bg-white text-slate-700 text-[11px] font-bold flex items-center justify-center shadow-2xs font-mono">
                    {colTasks.length}
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-all space-y-2.5 cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Badge
                          variant={
                            t.priority === 'URGENT'
                              ? 'danger'
                              : t.priority === 'HIGH'
                              ? 'warning'
                              : 'default'
                          }
                          size="sm"
                        >
                          {t.priority}
                        </Badge>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(t)}
                            className="p-1 text-slate-400 hover:text-slate-600 rounded"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTask(t.id)}
                            className="p-1 text-red-400 hover:text-red-600 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-slate-800 leading-snug">{t.title}</h4>

                      {t.description && (
                        <p className="text-[11px] text-slate-500 line-clamp-2">{t.description}</p>
                      )}

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <div className="flex items-center gap-1">
                          <UserIcon className="w-3 h-3 text-slate-400" />
                          <span className="font-semibold text-slate-700">{t.assignedToName}</span>
                        </div>
                        <div className="flex items-center gap-1 font-mono text-slate-400">
                          <Clock className="w-3 h-3" />
                          <span>{t.dueDate ? t.dueDate.slice(5, 10) : ''}</span>
                        </div>
                      </div>

                      {/* Quick Move Buttons */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-1">
                        {col.status !== 'TODO' && (
                          <button
                            type="button"
                            onClick={() => handleQuickStatusChange(t.id, 'TODO')}
                            className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-semibold"
                          >
                            ← مطلوبة
                          </button>
                        )}
                        {col.status !== 'IN_PROGRESS' && (
                          <button
                            type="button"
                            onClick={() => handleQuickStatusChange(t.id, 'IN_PROGRESS')}
                            className="text-[10px] px-2 py-0.5 bg-blue-50 hover:bg-blue-100 rounded text-blue-700 font-semibold"
                          >
                            قيد التنفيذ
                          </button>
                        )}
                        {col.status !== 'COMPLETED' && (
                          <button
                            type="button"
                            onClick={() => handleQuickStatusChange(t.id, 'COMPLETED')}
                            className="text-[10px] px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 rounded text-emerald-700 font-semibold"
                          >
                            إنجاز ✓
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <th className="py-3 px-4">عنوان المهمة</th>
                <th className="py-3 px-3">الأولوية</th>
                <th className="py-3 px-3">المسؤول المكلف</th>
                <th className="py-3 px-3">تاريخ الاستحقاق</th>
                <th className="py-3 px-3">الحالة</th>
                <th className="py-3 px-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-bold text-slate-800">{t.title}</td>
                  <td className="py-3 px-3">
                    <Badge variant={t.priority === 'URGENT' ? 'danger' : 'default'} size="sm">
                      {t.priority}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-700">{t.assignedToName}</td>
                  <td className="py-3 px-3 font-mono text-slate-600">{t.dueDate}</td>
                  <td className="py-3 px-3">
                    <Badge
                      variant={t.status === 'COMPLETED' ? 'success' : t.status === 'IN_PROGRESS' ? 'primary' : 'warning'}
                      size="sm"
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(t)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTask(t.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
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
                  className="text-[10px] text-slate-400 hover:text-rose-500"
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
              <span className="text-[10px] text-slate-400 font-bold">قوالب مهام:</span>
              {TASK_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl}
                  type="button"
                  onClick={() => setTitle(tmpl)}
                  className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-1.5 py-0.5 rounded transition-colors"
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
                <option value="TODO">مطلوبة (To Do)</option>
                <option value="IN_PROGRESS">قيد التنفيذ</option>
                <option value="IN_REVIEW">مراجعة وتدقيق</option>
                <option value="COMPLETED">مكتملة ومسلمة</option>
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
                  className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100"
                >
                  +2س
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDeadlinePreset(6)}
                  className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200"
                >
                  +6س
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDeadlinePreset(24)}
                  className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200"
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
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              حفظ المهمة
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
