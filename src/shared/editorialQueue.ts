import { isApprover, type Bulletin, type BulletinStory } from './bulletins';
import type { EditorialTask, User } from '../types';
import type { ReadinessIssue } from './bulletinReadiness';

export interface ManagerQueueRow { id: string; bulletinId: string; storyId?: string; taskId?: string; title: string; action: string; overdue: boolean; unassigned: boolean; waitingApproval: boolean; blocked: boolean; airAt: string; dueDate?: string; assigneeId?: string }
export function managerQueue(input: { user: User; bulletins: Bulletin[]; stories: BulletinStory[]; tasks: EditorialTask[]; readiness: ReadinessIssue[]; now: Date; teamScope: boolean; can?: (permission: string) => boolean }): ManagerQueueRow[] {
  const { user, now } = input;
  const can = input.can || (() => false);
  const team = input.teamScope && can('bulletins.manage');
  const rows: ManagerQueueRow[] = [];
  for (const b of input.bulletins.filter(b => !b.deletedAt && b.status !== 'DONE')) {
    for (const s of input.stories.filter(s => s.bulletinId === b.id && !s.killed && !s.floated && !s.deletedAt)) {
      const waitingApproval = (s.status === 'READY' || (s.status === 'APPROVED' && !!b.approvalSteps?.length)) && isApprover(b, { id: user.id, role: user.role, canApprove: can('bulletins.approve'), canEdit: can('bulletins.edit') }, s);
      const tasks = input.tasks.filter(t => t.relatedEntityType === 'BULLETIN_STORY' && t.relatedEntityId === s.id && !['DONE', 'COMPLETED', 'CANCELLED'].includes(t.status));
      if (!(team || waitingApproval || s.writerId === user.id || b.editorId === user.id || tasks.some(t => t.assigneeId === user.id))) continue;
      const personal = team ? tasks : tasks.filter(t => t.assigneeId === user.id);
      const task = personal.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
      rows.push({ id: s.id, bulletinId: b.id, storyId: s.id, taskId: task?.id, title: s.slug, action: waitingApproval ? 'بانتظار اعتمادك' : task?.title || 'إعداد القصة', overdue: personal.some(t => !!t.dueDate && Date.parse(t.dueDate) < now.getTime()), unassigned: !tasks.length || tasks.some(t => !t.assigneeId), waitingApproval, blocked: input.readiness.some(i => i.storyId === s.id && i.severity === 'blocker'), airAt: `${b.date}T${b.startTime}`, dueDate: task?.dueDate, assigneeId: task?.assigneeId || s.writerId });
    }
    for (const t of input.tasks.filter(t => t.relatedEntityType === 'BULLETIN' && t.relatedEntityId === b.id && !['DONE', 'COMPLETED', 'CANCELLED'].includes(t.status) && (team || t.assigneeId === user.id))) {
      rows.push({ id: t.id, taskId: t.id, bulletinId: b.id, title: t.title, action: 'تكليف النشرة', overdue: !!t.dueDate && Date.parse(t.dueDate) < now.getTime(), unassigned: !t.assigneeId, waitingApproval: false, blocked: t.status === 'BLOCKED', airAt: `${b.date}T${b.startTime}`, dueDate: t.dueDate, assigneeId: t.assigneeId });
    }
  }
  return rows.sort((a, b) => a.airAt.localeCompare(b.airAt) || (a.dueDate || '').localeCompare(b.dueDate || '') || a.id.localeCompare(b.id));
}
