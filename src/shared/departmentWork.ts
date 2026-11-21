import type { CardState, StepStatus } from './productionCards';
import type { TaskStatus } from '../types';

export interface DepartmentWorkMember {
  id: string;
  name: string;
  departmentName: string;
  stationId?: string;
}

export interface DepartmentWorkItem {
  id: string;
  kind: 'task' | 'card' | 'step';
  title: string;
  detail?: string;
  assigneeId: string;
  status: TaskStatus | CardState | StepStatus;
  dueAt?: string;
  activeSeconds?: number | null;
  blockedReason?: string;
  entityId: string;
}

export interface DepartmentWork {
  departments: string[];
  members: DepartmentWorkMember[];
  items: DepartmentWorkItem[];
}
