import type { WorkSectionPreferences } from './workContext';

export interface WorkspacePreferences {
  id: string;
  ownerId: string;
  workSections: WorkSectionPreferences;
  updatedAt: string;
}

export interface PersonalNote {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const PERSONAL_NOTE_TITLE_LIMIT = 160;
export const PERSONAL_NOTE_BODY_LIMIT = 12000;
