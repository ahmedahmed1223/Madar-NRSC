import { Router } from 'express';
import { createHash } from 'crypto';
import type { AuthContext } from './auth';
import { requireAuth } from './auth';
import type { NewsroomDatabase } from './db';
import type { EntityRow } from '../shared/collections';
import { ENTITY_ID_PATTERN } from '../shared/collections';
import { isDepartmentId } from '../shared/departments';
import { handoverDraftError, handoverPlainText, type HandoverDraftInput, type HandoverReference, type HandoverRow, type ShiftHandover } from '../shared/shiftHandovers';
import { canRead } from './policy';

class HandoverError extends Error {
  constructor(public status: number, message: string, public current?: HandoverRow) { super(message); }
}
const deny = () => { throw new HandoverError(403, 'صلاحياتك لا تسمح بهذا الإجراء'); };
const notFound = () => { throw new HandoverError(404, 'التسليم غير متاح'); };

export function handoverRosterMembers(db: NewsroomDatabase, handover: HandoverDraftInput, source = false): string[] {
  const date = source ? handover.sourceDate : handover.recipientDate;
  const shift = source ? handover.sourceShift : handover.recipientShift;
  return [...new Set(db.listCollection('roster').map(row => row.d).filter(entry => !entry.deletedAt && entry.departmentId === handover.departmentId && entry.date === date && entry.shift === shift).map(entry => entry.userId as string))];
}
export function handoverVisible(db: NewsroomDatabase, auth: AuthContext, handover: ShiftHandover): boolean {
  if (!auth.can('handover.view')) return false;
  if (handover.state === 'DRAFT') return handover.authorId === auth.user.id;
  return auth.can('handover.manage') || (isDepartmentId(auth.user.departmentId) && auth.user.departmentId === handover.departmentId) || handoverRosterMembers(db, handover).includes(auth.user.id);
}
const canSource = (db: NewsroomDatabase, auth: AuthContext, draft: HandoverDraftInput) =>
  (isDepartmentId(auth.user.departmentId) && auth.user.departmentId === draft.departmentId) || handoverRosterMembers(db, draft, true).includes(auth.user.id);

export function handoverTarget(db: NewsroomDatabase, auth: AuthContext, reference: HandoverReference): any | null {
  const target = db.getRow(reference.collection, reference.id)?.d;
  const permission = reference.collection === 'news' ? auth.can('news.view')
    : reference.collection === 'bulletins' || reference.collection === 'bulletinStories' ? auth.can('rundown.view') || auth.can('bulletins.edit') || auth.can('bulletins.manage')
    : reference.collection === 'episodes' ? auth.can('programs.view') || auth.can('episodes.view')
    : auth.can('tasks.view');
  return target && !target.deletedAt && permission && canRead(auth, reference.collection, target, (c, id) => db.getRow(c, id)?.d) ? target : null;
}
export function projectHandover(db: NewsroomDatabase, auth: AuthContext, row: EntityRow): HandoverRow {
  const { references, lastRemindedAt: _private, ...record } = row.d as ShiftHandover;
  const receipts = record.state === 'PUBLISHED' ? db.listCollection('handoverReceipts').map(r => r.d).filter(r => r.publicationId === row.id) : [];
  const recipients = record.state === 'PUBLISHED' ? handoverRosterMembers(db, row.d).map(id => db.getRow('users', id)?.d).filter(u => u && u.isActive && !u.deletedAt).map(u => ({ userId: u.id, userName: u.fullName, received: receipts.some(r => r.userId === u.id) })) : [];
  return { ...row, d: { ...record, references: references.map(ref => {
    const target = handoverTarget(db, auth, ref);
    return target ? { ...ref, available: true as const, title: String(target.title || target.slug || target.name || 'مرجع') } : { available: false as const };
  }) }, receipts, recipients,
    canAcknowledge: record.state === 'PUBLISHED' && record.authorId !== auth.user.id && handoverRosterMembers(db, row.d).includes(auth.user.id),
    canPublish: record.state === 'DRAFT' && record.authorId === auth.user.id && auth.can('handover.publish') && (canSource(db, auth, row.d) || !!record.supersedesId && auth.can('handover.manage')),
    canRemind: record.state === 'PUBLISHED' && auth.can('handover.manage'),
  };
}
export function accessibleHandover(db: NewsroomDatabase, auth: AuthContext, id: string): EntityRow {
  if (!auth.can('handover.view')) deny();
  if (!ENTITY_ID_PATTERN.test(id)) notFound();
  const row = db.getRow('shiftHandovers', id);
  if (!row || !handoverVisible(db, auth, row.d)) notFound();
  return row!;
}
function checkVersion(db: NewsroomDatabase, auth: AuthContext, row: EntityRow, baseV: unknown) {
  if (!Number.isInteger(baseV) || baseV !== row.v) throw new HandoverError(409, 'تغير التسليم؛ راجع النسخة الحالية', projectHandover(db, auth, row));
}
function checkDraftAuthority(db: NewsroomDatabase, auth: AuthContext, draft: HandoverDraftInput) {
  if (!auth.can('handover.view') || !auth.can('handover.publish')) deny();
  if (draft.supersedesId) {
    const previous = accessibleHandover(db, auth, draft.supersedesId);
    if (previous.d.state !== 'PUBLISHED' || previous.d.departmentId !== draft.departmentId) deny();
    if (!auth.can('handover.manage') && previous.d.authorId !== auth.user.id) deny();
    if (!auth.can('handover.manage') && !canSource(db, auth, draft)) deny();
  } else if (!canSource(db, auth, draft)) deny();
}

export function shiftHandoverRouter(db: NewsroomDatabase, emitRevision: () => void): Router {
  const router = Router();
  router.use(requireAuth);
  const endpoint = (operation: (auth: AuthContext, req: any) => any, mutation = false) => (req: any, res: any, next: any) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const result = mutation ? db.transaction(() => operation(req.auth!, req)) : operation(req.auth!, req);
      if (mutation) emitRevision();
      res.json(result);
    } catch (error) {
      if (error instanceof HandoverError) res.status(error.status).json({ error: error.message, code: error.status === 409 ? 'CONFLICT' : undefined, ...(error.current ? { current: error.current } : {}) });
      else next(error);
    }
  };
  router.get('/', endpoint(auth => {
    if (!auth.can('handover.view')) deny();
    return { rows: db.listCollection('shiftHandovers').filter(row => handoverVisible(db, auth, row.d)).sort((a, b) => b.d.updatedAt.localeCompare(a.d.updatedAt)).map(row => projectHandover(db, auth, row)) };
  }));
  router.get('/:id', endpoint((auth, req) => ({ row: projectHandover(db, auth, accessibleHandover(db, auth, req.params.id)) })));
  router.post('/', endpoint((auth, req) => {
    const error = handoverDraftError(req.body);
    if (error) throw new HandoverError(400, error);
    const draft = req.body as HandoverDraftInput;
    checkDraftAuthority(db, auth, draft);
    if (db.getRow('shiftHandovers', draft.id, true)) throw new HandoverError(409, 'معرّف مستخدم؛ راجع نتيجة الحفظ السابق');
    if (draft.references.some(ref => !handoverTarget(db, auth, ref))) throw new HandoverError(400, 'أحد المراجع غير متاح؛ راجع اختيارك');
    const now = new Date().toISOString();
    const row = db.writeRow('shiftHandovers', draft.id, { ...draft, title: draft.title.trim(), authorId: auth.user.id, authorName: auth.user.fullName, state: 'DRAFT', createdAt: now, updatedAt: now }, db.positionBounds('shiftHandovers').min - 1, auth.user.id);
    return { row: projectHandover(db, auth, row) };
  }, true));
  router.patch('/:id', endpoint((auth, req) => {
    const row = accessibleHandover(db, auth, req.params.id);
    if (row.d.state !== 'DRAFT') throw new HandoverError(409, 'التسليم المنشور لا يعدل؛ أنشئ تصحيحاً');
    if (row.d.authorId !== auth.user.id) deny();
    checkDraftAuthority(db, auth, row.d);
    checkVersion(db, auth, row, req.body?.baseV);
    const draft = req.body?.draft;
    if (Object.keys(req.body || {}).some(k => !['draft', 'baseV'].includes(k)) || handoverDraftError(draft) || draft.id !== row.id || draft.supersedesId !== row.d.supersedesId) throw new HandoverError(400, 'حقول المسودة غير صالحة');
    checkDraftAuthority(db, auth, draft);
    if (draft.references.some((ref: HandoverReference) => !handoverTarget(db, auth, ref))) throw new HandoverError(400, 'أحد المراجع غير متاح؛ راجع اختيارك');
    return { row: projectHandover(db, auth, db.writeRow('shiftHandovers', row.id, { ...row.d, ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() }, row.p, auth.user.id)) };
  }, true));
  router.delete('/:id', endpoint((auth, req) => {
    const row = accessibleHandover(db, auth, req.params.id);
    if (row.d.state !== 'DRAFT') throw new HandoverError(409, 'التسليم المنشور لا يحذف');
    if (row.d.authorId !== auth.user.id) deny();
    checkDraftAuthority(db, auth, row.d);
    checkVersion(db, auth, row, req.body?.baseV);
    db.deleteRow('shiftHandovers', row.id, auth.user.id);
    return { success: true };
  }, true));
  router.post('/:id/publish', endpoint((auth, req) => {
    const row = accessibleHandover(db, auth, req.params.id);
    if (row.d.authorId !== auth.user.id) deny();
    checkDraftAuthority(db, auth, row.d);
    checkVersion(db, auth, row, req.body?.baseV);
    if (row.d.state !== 'DRAFT') throw new HandoverError(409, 'هذا التسليم منشور بالفعل');
    const now = new Date().toISOString();
    const published = db.writeRow('shiftHandovers', row.id, { ...row.d, state: 'PUBLISHED', publishedAt: now, updatedAt: now }, row.p, auth.user.id);
    return { row: projectHandover(db, auth, published) };
  }, true));
  router.post('/:id/acknowledge', endpoint((auth, req) => {
    const row = accessibleHandover(db, auth, req.params.id);
    if (row.d.state !== 'PUBLISHED' || row.d.authorId === auth.user.id || !handoverRosterMembers(db, row.d).includes(auth.user.id)) deny();
    if (Object.keys(req.body || {}).some(k => k !== 'note') || !handoverPlainText(req.body?.note ?? '', 500)) throw new HandoverError(400, 'ملاحظة الاستلام غير صالحة');
    const id = `receipt-${createHash('sha256').update(JSON.stringify([row.id, auth.user.id])).digest('hex')}`;
    const previous = db.getRow('handoverReceipts', id);
    if (previous) return { receipt: previous.d, row: projectHandover(db, auth, row) };
    const receipt = { id, publicationId: row.id, userId: auth.user.id, userName: auth.user.fullName, createdAt: new Date().toISOString(), note: req.body?.note || '' };
    db.writeRow('handoverReceipts', id, receipt, db.positionBounds('handoverReceipts').min - 1, auth.user.id);
    return { receipt, row: projectHandover(db, auth, row) };
  }, true));
  return router;
}
