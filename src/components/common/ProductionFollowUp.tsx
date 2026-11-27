import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { navigateTo } from '../../services/uiEvents';
import { RbacService } from '../../services/rbacService';
import { useLiveData } from '../../hooks/useLiveData';
import { appLocale, formatDay, zoneOptions } from '../../shared/dateFormat';
import { departmentName } from '../../shared/departments';
import { statusLabel } from '../../shared/labels';
import { isRequestClosed, requestStatusName } from '../../shared/production';
import { isTaskClosed } from '../../shared/taskWorkflow';
import type { User } from '../../types';

interface Props {
  entityId: string;
  kind: 'EPISODE' | 'BULLETIN';
  storyIds?: ReadonlySet<string>;
  user: User;
}

function deadline(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'بلا موعد';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDay(value);
  return new Date(value).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' });
}

export function ProductionFollowUp({ entityId, kind, storyIds, user }: Props) {
  useLiveData(['tasks', 'requests']);
  const canOpenTasks = RbacService.canOpenScreen(user, 'tasks');
  const canOpenRequests = RbacService.canOpenScreen(user, 'requests');
  const tasks = canOpenTasks ? apiService.getTasks().filter(task =>
    (task.relatedEntityType === kind && task.relatedEntityId === entityId)
    || (kind === 'BULLETIN' && task.relatedEntityType === 'BULLETIN_STORY' && storyIds?.has(task.relatedEntityId || ''))
  ) : [];
  const requests = canOpenRequests ? apiService.getRequests().filter(request => request.link?.episodeId === entityId) : [];
  const rows = [
    ...tasks.map(task => ({
      id: task.id, collection: 'tasks' as const, title: task.title,
      owner: task.assigneeName || task.assignedToName || 'بلا مسؤول محدد',
      due: task.dueDate, status: statusLabel(task.status, 'task'),
      closed: isTaskClosed(task.status),
    })),
    ...requests.map(request => ({
      id: request.id, collection: 'requests' as const, title: request.title,
      owner: request.assigneeName || request.addressedToName || departmentName(request.departmentId),
      due: request.dueAt, status: requestStatusName(request.status), closed: isRequestClosed(request.status),
    })),
  ].sort((left, right) => Number(left.closed) - Number(right.closed) || (left.due || '9999').localeCompare(right.due || '9999'));

  if (!rows.length) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <summary className="cursor-pointer font-bold text-sm text-slate-800">
        متابعة التكليفات والطلبات · {rows.filter(row => !row.closed).length} قيد المتابعة
      </summary>
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map(row => (
          <li key={`${row.collection}/${row.id}`} className="flex flex-wrap items-center gap-x-3 px-1 py-2 text-xs text-slate-600">
            <button type="button" className="min-h-11 text-start font-bold text-blue-700 hover:underline" onClick={() => navigateTo.emit(`/${row.collection}/${encodeURIComponent(row.id)}`)}>
              {row.title}
            </button>
            <span>{row.owner}</span>
            <span>{deadline(row.due)}</span>
            <span>{dataStore.hasPendingWrite(row.collection, row.id) ? 'بانتظار تأكيد الخادم' : row.status}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
