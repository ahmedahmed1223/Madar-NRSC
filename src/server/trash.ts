import { assignedWorkOnly } from '../shared/assignedWork';
import { ENTITY_ID_PATTERN, type CollectionName } from '../shared/collections';
import { moduleForCollection } from '../shared/moduleAccess';
import { findUserRole } from '../shared/rbac';
import { canOpenScreen } from '../shared/screens';
import { isTrashCollection, TRASH_COLLECTIONS, TRASH_SECTIONS, type TrashCollection, type TrashItem, type TrashPage } from '../shared/trash';
import type { AuthContext } from './auth';
import type { NewsroomDatabase, TrashPagePosition } from './db';
import { moduleAllowed } from './moduleAccess';
import { canRead, POLICIES, type PolicyInput } from './policy';
import type { TrashRetentionPolicy } from './retention';

const PAGE_SIZE = 50;
const SCAN_SIZE = 100;

export function trashScope(auth: AuthContext): TrashCollection[] {
  const role = findUserRole(auth.user, auth.roles);
  return TRASH_COLLECTIONS.filter(collection => {
    if (assignedWorkOnly(auth.can) && collection !== 'productionCards') return false;
    const { screen, permissions } = TRASH_SECTIONS[collection];
    const module = moduleForCollection(collection);
    return permissions.some(auth.can) && (!module || moduleAllowed(auth, module)) &&
      canOpenScreen(screen, role, auth.can, auth.user.role === 'SUPER_ADMIN');
  });
}

export function canRestoreTrashRecord(auth: AuthContext, collection: TrashCollection, data: PolicyInput['before'],
  lookup: (collection: CollectionName, id: string) => unknown, list: NonNullable<PolicyInput['list']>): boolean {
  if (collection === 'media' && data?.privateMessageMedia) return false;
  return canRead(auth, collection, data, lookup) &&
    !POLICIES[collection]({ auth, collection, kind: 'delete', before: data, after: null, list });
}

export function decodeTrashCursor(value: unknown): TrashPagePosition | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 450 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const [deletedAt = '', collection, id = '', ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('~');
  if (rest.length || !Number.isFinite(Date.parse(deletedAt)) || !isTrashCollection(collection) || !ENTITY_ID_PATTERN.test(id)) return undefined;
  return { deletedAt, collection, id };
}

export function readTrashPage(db: NewsroomDatabase, auth: AuthContext, collection: TrashCollection | undefined,
  after: TrashPagePosition | null, retention: TrashRetentionPolicy): TrashPage {
  const collections = trashScope(auth);
  const selected = collection ? collections.filter(item => item === collection) : collections;
  const items: TrashItem[] = [];
  const recordsByCollection = new Map<CollectionName, ReturnType<NonNullable<PolicyInput['list']>>>();
  const list = (target: CollectionName) => {
    let records = recordsByCollection.get(target);
    if (!records) {
      records = db.listCollection(target).map(row => row.d);
      recordsByCollection.set(target, records);
    }
    return records;
  };
  const lookup = (target: CollectionName, id: string) => db.getRow(target, id)?.d;
  let cursor = after;
  while (items.length <= PAGE_SIZE) {
    const rows = db.listTrashPageAfter(selected, cursor, SCAN_SIZE);
    for (const { row, deletedAt } of rows) {
      cursor = { collection: row.c, id: row.id, deletedAt };
      if (!isTrashCollection(row.c) || !Number.isFinite(Date.parse(deletedAt)) || !canRestoreTrashRecord(auth, row.c, row.d, lookup, list)) continue;
      const title = [row.d.title, row.d.name, row.d.fullName, row.d.originalName, row.d.fileName].find(value => typeof value === 'string' && value.trim());
      const { days, activeSince } = retention.byCollection[row.c];
      const retentionDays = activeSince && deletedAt < activeSince ? 0 : days;
      items.push({ collection: row.c, id: row.id, title: title?.trim() || row.id,
        deletedAt, version: row.v, retentionDays });
      if (items.length > PAGE_SIZE) break;
    }
    if (rows.length < SCAN_SIZE) break;
  }
  let nextCursor: string | null = null;
  if (items.length > PAGE_SIZE) {
    items.pop();
    const last = items[items.length - 1];
    nextCursor = Buffer.from(`${last.deletedAt}~${last.collection}~${last.id}`).toString('base64url');
  }
  return { items, collections, nextCursor, retentionDays: retention.defaultDays };
}
