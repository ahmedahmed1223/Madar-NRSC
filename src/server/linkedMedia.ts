import type { CollectionName } from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { moduleAllowed } from './moduleAccess';
import { canRead } from './policy';
import { mediaUploadIsTrashed, uploadIdFromMedia } from './uploads';

const SOURCES = ['news', 'productionCards', 'requests', 'bulletinStories', 'episodes'] as const;
const visibleIds = new WeakMap<AuthContext, Set<string>>();

/** The library switch leaves explicitly attached records available through readable work. */
export function linkedMediaIds(db: NewsroomDatabase, auth: AuthContext): ReadonlySet<string> {
  const cached = visibleIds.get(auth);
  if (cached) return cached;
  const ids = new Set<string>();
  const lookup = (collection: CollectionName, id: string) => db.getRow(collection, id)?.d;
  const add = (value: unknown) => { if (typeof value === 'string' && value) ids.add(value); };
  for (const collection of SOURCES) {
    if (auth.moduleAllowed?.(collection === 'news' ? 'news' : collection === 'productionCards' ? 'assignments'
      : collection === 'requests' ? 'requests' : collection === 'episodes' ? 'programmes' : 'bulletins') === false) continue;
    for (const { d } of db.listCollection(collection)) {
      if (d?.deletedAt || !canRead(auth, collection, d, lookup)) continue;
      if (Array.isArray(d.mediaIds)) d.mediaIds.forEach(add);
      if (collection === 'news' && Array.isArray(d.videos)) {
        for (const video of d.videos) if (video?.kind === 'library') add(video.mediaId);
      }
      if (collection === 'requests') {
        if (Array.isArray(d.sourceMediaIds)) d.sourceMediaIds.forEach(add);
        add(d.resultMediaId);
      }
      if (collection === 'bulletinStories') add(d.clipMediaId);
      if (collection === 'episodes' && Array.isArray(d.rundown)) {
        for (const segment of d.rundown) if (Array.isArray(segment?.mediaIds)) segment.mediaIds.forEach(add);
      }
    }
  }
  visibleIds.set(auth, ids);
  return ids;
}

export function linkedMediaAsset(db: NewsroomDatabase, auth: AuthContext, id: string) {
  if (!auth.can('media.view') || !linkedMediaIds(db, auth).has(id)) return undefined;
  const asset = db.getRow('media', id)?.d;
  // Private chat-origin files retain their independent access checks.
  return asset && !asset.deletedAt && !asset.privateMessageMedia ? asset : undefined;
}

export function canDownloadLinkedMedia(db: NewsroomDatabase, auth: AuthContext, uploadId: string): boolean {
  return [...linkedMediaIds(db, auth)].some(id => {
    const asset = linkedMediaAsset(db, auth, id);
    return asset && uploadIdFromMedia(asset) === uploadId;
  });
}

/** Shared by file download and storage metadata. Callers require media.view. */
export function downloadableMediaUpload(db: NewsroomDatabase, auth: AuthContext, id: unknown) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const upload = db.getUpload(id);
  if (!upload || upload.scope === 'chat' || (upload.scope === 'legacy' && upload.uploadedBy !== auth.user.id)) return null;
  if (mediaUploadIsTrashed(db, id) || (!moduleAllowed(auth, 'media') && !canDownloadLinkedMedia(db, auth, id))) return null;
  return upload;
}
