import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import {
  WORKFLOW_DELEGATION_LABEL, WORKFLOW_DELEGATION_PERMISSIONS, WORKFLOW_ROLE_LABEL, WORKFLOW_TRACK_LABEL, WORKFLOW_TRACKS,
  type WorkflowDelegation, type WorkflowDelegations,
  type WorkflowRole, type WorkflowRoles, type WorkflowTrack,
} from '../../shared/workflowTracks';

interface Props {
  roles: WorkflowRoles | null;
  delegations: WorkflowDelegations;
  onRolesChange: (roles: WorkflowRoles | null) => void;
  onDelegationsChange: (delegations: WorkflowDelegations) => void;
  error?: string;
}

function expiryOf(input: string): string {
  const time = new Date(fromLocalInputValue(input));
  return Number.isFinite(time.getTime()) ? time.toISOString() : '';
}

export function WorkflowAccessFields({ roles, delegations, onRolesChange, onDelegationsChange, error }: Props) {
  function setRole(track: WorkflowTrack, role: WorkflowRole | '') {
    const next = { ...roles };
    if (role) next[track] = role;
    else delete next[track];
    onRolesChange(next);
  }

  function setDelegation(track: WorkflowTrack, grant?: WorkflowDelegation) {
    const next = { ...delegations };
    if (grant) next[track] = grant;
    else delete next[track];
    onDelegationsChange(next);
  }

  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <legend className="px-1 text-xs font-bold text-slate-900">أدوار مساري الإعداد والتفويض</legend>
      <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={roles !== null} onChange={event => onRolesChange(event.target.checked ? {} : null)} />
        تخصيص دور مستقل لكل مسار
      </label>
      {roles === null && <p className="text-xs text-slate-600">يستمر الحساب بصلاحيات دوره الحالي في الإعداد.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {WORKFLOW_TRACKS.map(track => {
          const label = WORKFLOW_TRACK_LABEL[track];
          const grant = delegations[track];
          return (
            <fieldset key={track} className="min-w-0 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <legend className="px-1 text-xs font-bold text-slate-900">مسار {label}</legend>
              {roles !== null && (
                <label className="block text-xs font-semibold">
                  دور مسار {label}
                  <select
                    value={roles[track] || ''}
                    onChange={event => setRole(track, event.target.value as WorkflowRole | '')}
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2"
                  >
                    <option value="">بلا دور إعداد</option>
                    <option value="MANAGER">{WORKFLOW_ROLE_LABEL[track].MANAGER}</option>
                    <option value="PREPARER">{WORKFLOW_ROLE_LABEL[track].PREPARER}</option>
                  </select>
                </label>
              )}
              <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={!!grant}
                  onChange={event => setDelegation(track, event.target.checked ? { expiresAt: '', permissions: ['manageAssignments'] } : undefined)}
                />
                تفويض محرّر مؤقت في مسار {label}
              </label>
              {grant && <>
                <label className="block text-xs font-semibold">
                  انتهاء تفويض {label}
                  <input
                    type="datetime-local"
                    value={toLocalInputValue(grant.expiresAt)}
                    onChange={event => setDelegation(track, { ...grant, expiresAt: expiryOf(event.target.value) })}
                    required
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2"
                  />
                </label>
                {Date.parse(grant.expiresAt) <= Date.now() && <p className="text-xs text-slate-600">انتهى التفويض</p>}
                {WORKFLOW_DELEGATION_PERMISSIONS.map(permission => (
                  <label key={permission} className="flex min-h-11 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={grant.permissions.includes(permission)}
                      onChange={event => setDelegation(track, {
                        ...grant,
                        permissions: event.target.checked ? [...grant.permissions, permission] : grant.permissions.filter(item => item !== permission),
                      })}
                    />
                    {WORKFLOW_DELEGATION_LABEL[permission]}
                  </label>
                ))}
              </>}
            </fieldset>
          );
        })}
      </div>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </fieldset>
  );
}
