import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { assignmentScope } from '../../shared/assignmentScope';
import { supportRecipient } from '../../shared/trackSupport';
import type { WorkflowTrack } from '../../shared/workflowTracks';
import type { User } from '../../types';

export function supportDestinations(actor: User, track: WorkflowTrack, managerOnly: boolean, requesterId: string) {
  const { stations } = assignmentScope(actor, apiService.getSettings());
  return apiService.getUsers().filter(user => user.id !== actor.id && user.id !== requesterId &&
    (!user.stationId || stations.has(user.stationId)) && supportRecipient(user, track, managerOnly) &&
    ['requests.create', 'requests.manage'].some(permission => RbacService.hasPermission(user, permission)));
}
