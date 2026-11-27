import type { User } from '../types';
import type { DeptRequest } from './production';
import { mayManageWorkflowTrack, type WorkflowTrack } from './workflowTracks';

export const supportTrack = (type: string): WorkflowTrack | undefined =>
  type === 'SUPPORT_NEWS' ? 'news' : type === 'SUPPORT_PROGRAMMES' ? 'programmes' : undefined;

export function supportRecipient(user: User | undefined, track: WorkflowTrack, managerOnly: boolean): boolean {
  if (!user || user.deletedAt || user.isActive === false) return false;
  return mayManageWorkflowTrack(user, track) || (!managerOnly && user.workflowRoles?.[track] === 'PREPARER');
}

export function handlesSupport(request: DeptRequest, user: User): boolean {
  const track = supportTrack(request.type);
  return !!track && request.addressedToId === user.id && supportRecipient(user, track, false);
}
