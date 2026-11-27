import { ENTITY_ID_PATTERN } from './collections';

export interface MediaFolder {
  id: string;
  name: string;
  parentId?: string | null;
  ownerId: string;
  stationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export const MEDIA_FOLDER_NAME_LIMIT = 120;
export const mediaFolderNameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase();

export function isMediaFolderId(id: unknown): id is string {
  return typeof id === 'string' && id !== '.' && id !== '..' && ENTITY_ID_PATTERN.test(id);
}

export function mediaFolderNameError(name: unknown): string | null {
  if (typeof name !== 'string' || !name || name !== name.trim() || name.length > MEDIA_FOLDER_NAME_LIMIT) {
    return `اكتب اسمًا للمجلد لا يتجاوز ${MEDIA_FOLDER_NAME_LIMIT} حرفًا، بلا مسافات في بدايته أو نهايته`;
  }
  const key = mediaFolderNameKey(name);
  if (key === '.' || key === '..' || /[/\\<>:"|?*\p{Cc}]/u.test(key)) return 'اسم المجلد يحتوي على محارف غير مسموحة';
  return null;
}

export function mediaFolderInScope(folder: Pick<MediaFolder, 'stationId'> | null | undefined, scope: ReadonlySet<string>): boolean {
  return !!folder && (!folder.stationId || scope.has(folder.stationId));
}

export function mayChangeMediaFolder(
  folder: Pick<MediaFolder, 'ownerId' | 'stationId'>,
  userId: string,
  scope: ReadonlySet<string>,
  canUpload: boolean,
  canDelete: boolean,
): boolean {
  return mediaFolderInScope(folder, scope) && (canDelete || (canUpload && folder.ownerId === userId));
}
