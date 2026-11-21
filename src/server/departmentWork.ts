import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { assignedWorkOnly } from '../shared/assignedWork';
import { departmentsOf, departmentWorkScope } from '../shared/departments';
import type { DepartmentWork, DepartmentWorkItem, DepartmentWorkMember } from '../shared/departmentWork';
import { cardState, type ProductionCard } from '../shared/productionCards';
import { stepLaborMinutes } from '../shared/cardExecutionTiming';
import { normalizeTaskStatus, taskTiming } from '../shared/taskWorkflow';
import type { EditorialTask, User } from '../types';

interface WorkSnapshot {
  rev: number;
  generation: number;
  users: User[];
  tasks: Map<string, EditorialTask[]>;
  cards: Map<string, ProductionCard[]>;
}

const snapshots = new WeakMap<NewsroomDatabase, WorkSnapshot>();

function addWork<T>(index: Map<string, T[]>, assigneeId: string, item: T) {
  const items = index.get(assigneeId);
  if (items) items.push(item);
  else index.set(assigneeId, [item]);
}

function departmentWorkSnapshot(db: NewsroomDatabase) {
  const rev = db.currentRev();
  const cached = snapshots.get(db);
  if (cached?.rev === rev && cached.generation === db.generation) return cached;
  const users = db.listCollection('users').map(row => row.d as User);
  const tasks = new Map<string, EditorialTask[]>();
  const cards = new Map<string, ProductionCard[]>();
  for (const { id, d } of db.listCollection('tasks')) {
    const assignee = d.assigneeId || d.assignedToId;
    if (assignee && !d.deletedAt) addWork(tasks, assignee, { ...d, id });
  }
  for (const { id, d } of db.listCollection('productionCards')) {
    const card: ProductionCard = { ...d, id };
    if (card.deletedAt) continue;
    const assignees = new Set([card.ownerId, ...(card.steps || []).filter(step => step.status !== 'SKIPPED').map(step => step.assigneeId)]);
    for (const assignee of assignees) if (assignee) addWork(cards, assignee, card);
  }
  const snapshot = { rev, generation: db.generation, users, tasks, cards };
  snapshots.set(db, snapshot);
  return snapshot;
}

export function departmentTaskIds(db: NewsroomDatabase, userId: string, team: ReadonlySet<string>): string[] {
  const { tasks } = departmentWorkSnapshot(db);
  return [...new Set([...team, userId])].flatMap(id => (tasks.get(id) || []).map(task => task.id)).sort();
}

export function readDepartmentWork(db: NewsroomDatabase, auth: AuthContext, now = Date.now()): DepartmentWork | null {
  if (assignedWorkOnly(auth.can)) return null;
  const departments = departmentsOf(db.getRow('settings', 'singleton')?.d);
  const { led, departmentFor } = departmentWorkScope(auth.user.id, departments);
  if (!led.length) return null;
  const members = new Map<string, DepartmentWorkMember>();
  const snapshot = departmentWorkSnapshot(db);
  for (const user of snapshot.users) {
    const department = departmentFor(user);
    if (!department) continue;
    members.set(user.id, { id: user.id, name: user.fullName, departmentName: department.name, stationId: user.stationId });
  }

  const items: DepartmentWorkItem[] = [];
  for (const assigneeId of members.keys()) for (const task of snapshot.tasks.get(assigneeId) || []) {
    const id = task.id;
    items.push({ id, kind: 'task', title: task.title, assigneeId, status: normalizeTaskStatus(task.status), dueAt: task.dueDate,
      activeSeconds: task.execution?.startedAt ? taskTiming(task, now).activeSeconds : null, blockedReason: task.blockedReason, entityId: id });
  }
  const teamCards = new Set(Array.from(members.keys()).flatMap(id => snapshot.cards.get(id) || []));
  for (const card of teamCards) {
    const id = card.id;
    for (const step of card.steps || []) {
      if (!step.assigneeId || !members.has(step.assigneeId) || step.status === 'SKIPPED') continue;
      const laborMinutes = stepLaborMinutes(step);
      items.push({ id: `${id}:${step.id}`, kind: 'step', title: card.title, detail: step.title, assigneeId: step.assigneeId,
        status: step.status === 'DONE' || card.status === 'OPEN' ? step.status : card.status, dueAt: step.dueAt || card.dueAt || card.airAt,
        activeSeconds: laborMinutes === null ? null : laborMinutes * 60, blockedReason: step.blockedReason, entityId: id });
    }
    if (card.ownerId && members.has(card.ownerId) && !card.steps?.some(step => step.assigneeId === card.ownerId && step.status !== 'SKIPPED')) {
      items.push({ id, kind: 'card', title: card.title, assigneeId: card.ownerId, status: cardState(card, now), dueAt: card.dueAt || card.airAt, entityId: id });
    }
  }
  return { departments: led.map(department => department.name), members: [...members.values()], items };
}
