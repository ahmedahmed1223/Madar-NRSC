import type { User } from '../types';
import type { WorkflowTemplate } from './workflowTemplates';
import { mayManageWorkflowTrack, workflowTrackOf, type WorkflowTrack } from './workflowTracks';

export type TemplateScope = WorkflowTrack | 'shared';

export type PublishedWorkflow = Pick<WorkflowTemplate, 'name' | 'kind' | 'description' | 'priority' | 'steps'> & {
  version: number;
  at?: string;
  byId?: string;
};

export function templateScope(template: WorkflowTemplate): TemplateScope {
  return template.track ?? workflowTrackOf(template.kind);
}

export function mayManageTemplate(user: User, template: WorkflowTemplate, legacyManage: boolean) {
  const track = templateScope(template);
  if (track === 'shared') return ['SUPER_ADMIN', 'GENERAL_MANAGER'].includes(user.role);
  return mayManageWorkflowTrack(user, track, legacyManage);
}

export function draftSnapshot(template: WorkflowTemplate, version: number): PublishedWorkflow {
  const { name, kind, description, priority, steps } = template;
  return { version, name: name.trim(), kind, description, priority, steps };
}

export function publishedWorkflow(template: WorkflowTemplate): PublishedWorkflow | undefined {
  if (template.published) return template.published;
  if (!template.drafting) return draftSnapshot(template, 1);
}

export function assignmentTemplate(template: WorkflowTemplate): WorkflowTemplate | undefined {
  const snapshot = publishedWorkflow(template);
  if (template.archived || !snapshot) return undefined;
  return { ...template, ...snapshot, published: snapshot };
}

/** Only the server creates a numbered publication snapshot. Draft saves retain the last published version. */
export function stampWorkflowPublication(before: WorkflowTemplate | null, after: WorkflowTemplate, actor: Pick<User, 'id'>, now: string): WorkflowTemplate {
  const { publishRequested, published: _clientSnapshot, ...fields } = after;
  const previous = before ? publishedWorkflow(before) : undefined;
  if (!after.drafting && !before?.drafting && !publishRequested) return fields;
  const published = publishRequested ? { ...draftSnapshot(after, (previous?.version ?? 0) + 1), at: now, byId: actor.id } : previous;
  return { ...fields, track: before ? templateScope(before) : templateScope(after), drafting: true, published };
}
