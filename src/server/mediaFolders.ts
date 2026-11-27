import { assignedWorkOnly } from '../shared/assignedWork';
import {
  isMediaFolderId, mayChangeMediaFolder, mediaFolderInScope, mediaFolderNameError, mediaFolderNameKey, type MediaFolder,
} from '../shared/mediaFolders';
import { stationsOf, stationGroupsOf, stationScope } from '../shared/stations';
import { moduleAllowed } from './moduleAccess';
import type { PolicyInput } from './policy';

const DENIED = 'صلاحياتك لا تسمح بإدارة مجلد الوسائط';
const UNAVAILABLE = 'مجلد الوسائط غير موجود أو خارج نطاقك';
const folderRows = (list: PolicyInput['list']) => (list?.('mediaFolders') || []) as MediaFolder[];

function scopeFor({ auth, list }: PolicyInput) {
  const settings = list?.('settings')[0];
  return stationScope(stationsOf(settings), auth.user, stationGroupsOf(settings));
}

export function mediaFolderChangeError(input: PolicyInput): string | null {
  const { auth, before, after, kind, list } = input;
  const folders = folderRows(list);
  const scope = scopeFor(input);
  if (assignedWorkOnly(auth.can)) return DENIED;
  if (before && !mayChangeMediaFolder(before, auth.user.id, scope, auth.can('media.upload'), auth.can('media.delete'))) return DENIED;
  if (!before && !auth.can('media.upload')) return DENIED;
  if (before && after && (before.ownerId !== after.ownerId || (before.stationId ?? null) !== (after.stationId ?? null))) {
    return 'لا يمكن تغيير مالك مجلد الوسائط أو محطته';
  }

  if (kind === 'delete' || (before && !before.deletedAt && after?.deletedAt)) {
    if (folders.some(folder => !folder.deletedAt && folder.parentId === before?.id) ||
      (list?.('media') || []).some(media => media.folderId === before?.id)) return 'انقل وسائط المجلد ومجلداته الفرعية قبل حذفه';
    return null;
  }
  if (!after || !isMediaFolderId(after.id) || (after.parentId != null && !isMediaFolderId(after.parentId))) return 'معرّف المجلد أو المجلد الأعلى غير صالح';
  const invalidName = mediaFolderNameError(after.name);
  if (invalidName) return invalidName;
  if (!before && after.deletedAt) return 'أنشئ المجلد في مكتبة الوسائط أولًا';
  const parent = after.parentId ? folders.find(folder => folder.id === after.parentId) : undefined;
  if (after.parentId && (!parent || parent.deletedAt || !mediaFolderInScope(parent, scope) ||
    !moduleAllowed(auth, 'media', parent.stationId || undefined))) return UNAVAILABLE;

  const station = after.stationId ?? null;
  const expectedStation = before ? before.stationId ?? null : parent?.stationId || auth.user.stationId || null;
  if (after.ownerId !== (before?.ownerId ?? auth.user.id) || station !== expectedStation ||
    !mediaFolderInScope(after, scope)) return 'لا يمكن تغيير مالك مجلد الوسائط أو محطته';
  if (parent?.stationId && parent.stationId !== station) return 'اختر مجلدًا أعلى من المحطة نفسها';

  const ancestors = new Set<string>([after.id]);
  for (let ancestor = parent; ancestor; ancestor = folders.find(folder => folder.id === ancestor.parentId)) {
    if (ancestors.has(ancestor.id)) return 'لا يمكن نقل المجلد إلى نفسه أو إلى مجلد فرعي منه';
    ancestors.add(ancestor.id);
  }
  const key = mediaFolderNameKey(after.name);
  if (folders.some(folder => folder.id !== after.id && !folder.deletedAt && (folder.parentId ?? null) === (after.parentId ?? null) &&
    (folder.stationId ?? null) === station && mediaFolderNameKey(folder.name) === key)) return 'يوجد مجلد بهذا الاسم في المكان المحدد';
  return null;
}

export function mediaPlacementError(input: PolicyInput): string | null {
  const { auth, before, after, list } = input;
  if ((before?.folderId ?? null) === (after?.folderId ?? null)) return null;
  if (assignedWorkOnly(auth.can) || before?.privateMessageMedia) return DENIED;
  if (before && !auth.can('media.delete') && ![before.ownerId, before.uploadedById].includes(auth.user.id)) {
    return 'نقل الملف بين المجلدات لمالكه أو لمسؤولي الوسائط';
  }
  const scope = scopeFor(input);
  const folders = folderRows(list);
  const source = folders.find(folder => folder.id === before?.folderId);
  if (source && (!mediaFolderInScope(source, scope) || !moduleAllowed(auth, 'media', source.stationId || undefined))) return UNAVAILABLE;
  if (after?.folderId == null) return null;

  const destination = isMediaFolderId(after.folderId) && folders.find(folder => folder.id === after.folderId);
  if (!destination || destination.deletedAt || !mediaFolderInScope(destination, scope) ||
    !moduleAllowed(auth, 'media', destination.stationId || undefined)) return UNAVAILABLE;
  const owner = before ? (list?.('users') || []).find(user => user.id === (before.ownerId || before.uploadedById)) : auth.user;
  if (destination.stationId && destination.stationId !== owner?.stationId) return 'اختر مجلدًا عامًا أو مجلدًا في محطة مالك الملف';
  return null;
}
