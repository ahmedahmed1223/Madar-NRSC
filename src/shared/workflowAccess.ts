import type { User } from '../types';
import type { ProductionCard } from './productionCards';
import { hasWorkflowDelegation, mayManageWorkflowTrack, mayReadWorkflowTrack, workflowTrackOf, type WorkflowTrack } from './workflowTracks';

interface LegacyCardAccess {
  view: boolean;
  manage: boolean;
  work: boolean;
}

export function workflowAccess(user: User, track: WorkflowTrack, legacy: LegacyCardAccess, existing = true) {
  const ownTrack = !!user.workflowRoles?.[track];
  const delegatedManagement = existing && hasWorkflowDelegation(user, track, 'manageAssignments');
  const manage = mayManageWorkflowTrack(user, track, legacy.manage) || delegatedManagement;
  const canSkipOptionalStep = existing && hasWorkflowDelegation(user, track, 'skipOptionalSteps');
  const readable = mayReadWorkflowTrack(user, track);
  return {
    view: readable && (legacy.view || ownTrack || delegatedManagement || canSkipOptionalStep),
    canManage: manage,
    canWork: readable && (legacy.work || ownTrack || manage || canSkipOptionalStep),
    canSkipOptionalStep,
  };
}

export function cardWorkflowAccess(user: User, card: Pick<ProductionCard, 'kind' | 'target'> & Partial<Pick<ProductionCard, 'steps'>>, legacy: LegacyCardAccess, existing = true) {
  const track = cardWorkflowTrack(card);
  const rights = workflowAccess(user, track, legacy, existing);
  if (rights.view || !existing) return rights;
  const linked = card.steps?.some(step => (step.assigneeId === user.id || step.reviewerId === user.id) && step.executionTrack &&
    step.executionTrack !== track && workflowAccess(user, step.executionTrack, legacy).canWork);
  return linked ? { ...rights, view: true, canWork: true } : rights;
}

export function cardWorkflowTrack(card: Pick<ProductionCard, 'kind' | 'target'>): WorkflowTrack {
  return workflowTrackOf(card.kind, card.target?.kind);
}
