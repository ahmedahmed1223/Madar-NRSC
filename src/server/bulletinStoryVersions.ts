import { isDeepStrictEqual } from 'node:util';
import { isApprover, storyContentChanged, type BulletinStory } from '../shared/bulletins';
import type { CollectionName } from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { canRead } from './policy';

const SERVER_FIELDS = new Set(['id', 'updatedAt', 'createdAt', 'writerId', 'writerName', 'approvals', 'approvedById', 'approvedByName', 'approvedAt', 'mediaReview']);
const RESTORE_FIELDS = ['slug', 'type', 'anchorName', 'script', 'clipMediaId', 'clipSeconds', 'manualSeconds', 'graphics',
  'directorNotes', 'remoteGuest'] as const satisfies readonly (keyof BulletinStory)[];

/** Changes between the form's starting revision and its submitted content. */
export function reconcileBulletinStory(base: Record<string, unknown>, current: Record<string, unknown>, incoming: Record<string, unknown>) {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(incoming)])]
    .filter(key => !SERVER_FIELDS.has(key) && !isDeepStrictEqual(base[key], incoming[key]));
  const conflicts = keys.some(key => !isDeepStrictEqual(base[key], current[key]) && !isDeepStrictEqual(incoming[key], current[key]));
  // An editorial decision is about the script and sign-offs the editor actually reviewed.
  const approvalChanged = keys.includes('status') && (storyContentChanged(base, current) ||
    base.newsUpdatedAt !== current.newsUpdatedAt || !isDeepStrictEqual(base.approvals, current.approvals));
  if (conflicts || approvalChanged || !isDeepStrictEqual(base.deletedAt, current.deletedAt)) return null;
  return { data: { ...current, ...Object.fromEntries(keys.map(key => [key, incoming[key]])) }, rankOnly: keys.length === 1 && keys[0] === 'rank' };
}

export function bulletinStoryVersionAccess(db: NewsroomDatabase, auth: AuthContext, bulletinId: string, storyId: string) {
  const lookup = (collection: CollectionName, id: string) => db.getRow(collection, id)?.d;
  const bulletin = lookup('bulletins', bulletinId);
  const current = db.getRow('bulletinStories', storyId);
  if (!bulletin || bulletin.deletedAt || !current || current.d.deletedAt || current.d.bulletinId !== bulletin.id ||
      !canRead(auth, 'bulletinStories', current.d, lookup)) return null;
  const actor = { id: auth.user.id, canApprove: auth.can('bulletins.approve'), canEdit: auth.can('bulletins.edit'), role: auth.user.role };
  return { current, canRestore: auth.can('bulletins.manage') || bulletin.editorId === actor.id || isApprover(bulletin, actor) };
}

/** Historical material returns through the normal editorial workflow. Keep the live placement and source linkage. */
export function restoreBulletinStoryDraft(current: BulletinStory, historical: BulletinStory): BulletinStory {
  const source = current.newsId === historical.newsId ? { newsUpdatedAt: historical.newsUpdatedAt, newsSourceSnapshot: historical.newsSourceSnapshot } : {};
  return { ...current, ...Object.fromEntries(RESTORE_FIELDS.map(key => [key, historical[key]])), ...source, status: 'DRAFT', returnNote: undefined };
}
