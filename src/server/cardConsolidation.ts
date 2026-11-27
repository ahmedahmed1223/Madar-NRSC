import { newId } from '../shared/ids';
import { canGovernCard, type ProductionCard } from '../shared/productionCards';
import { stationsOf } from '../shared/stations';
import { cardWorkflowTrack, workflowAccess } from '../shared/workflowAccess';
import type { SyncOp, SyncOpResult } from '../shared/collections';
import type { AuthContext } from './auth';
import type { NewsroomDatabase } from './db';

export class CardMergeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function canConsolidate(db: NewsroomDatabase, auth: AuthContext, card: ProductionCard): boolean {
  const access = workflowAccess(auth.user, cardWorkflowTrack(card), { view: auth.can('cards.view'), manage: auth.can('cards.manage'), work: auth.can('cards.work') }, false);
  const settings = db.getRow('settings', 'singleton')?.d;
  const actor = { ...auth.user, ...access };
  return card.status === 'OPEN' && !card.deletedAt && canGovernCard(card, actor, stationsOf(settings));
}

function matches(a: ProductionCard, b: ProductionCard): boolean {
  return a.id !== b.id && a.kind === b.kind && a.target?.kind === b.target?.kind && a.target?.id === b.target?.id;
}

export function cardMergeCandidates(db: NewsroomDatabase, auth: AuthContext, id: string) {
  const destination = db.getRow('productionCards', id);
  if (!destination || !canConsolidate(db, auth, destination.d)) throw new CardMergeError(404, 'التكليف غير متاح للدمج');
  const candidates = db.listCollection('productionCards')
    .filter(row => matches(destination.d, row.d) && canConsolidate(db, auth, row.d))
    .slice(0, 50)
    .map(row => ({ id: row.id, title: row.d.title, version: row.v }));
  return { version: destination.v, candidates };
}

export function mergeCardOutputs(db: NewsroomDatabase, auth: AuthContext, id: string,
  choice: { duplicateId: string; version: number; duplicateVersion: number; reason: string },
  write: (op: SyncOp) => SyncOpResult) {
  return db.transaction(() => {
    const destination = db.getRow('productionCards', id);
    const duplicate = db.getRow('productionCards', choice.duplicateId);
    if (!destination || !duplicate || !canConsolidate(db, auth, destination.d) || !canConsolidate(db, auth, duplicate.d)) {
      throw new CardMergeError(404, 'أحد التكليفين غير متاح للدمج');
    }
    if (!matches(destination.d, duplicate.d)) throw new CardMergeError(400, 'اختر تكليفًا مكررًا للمادة نفسها');
    if (destination.v !== choice.version || duplicate.v !== choice.duplicateVersion) throw new CardMergeError(409, 'تغيّر أحد التكليفين. حدّث القائمة وأعد المحاولة');

    const target: ProductionCard = destination.d;
    const source: ProductionCard = duplicate.d;
    const links = new Map((source.links ?? []).map(link => [link.url, link]));
    for (const link of target.links ?? []) links.set(link.url, link);
    const accepted = write({
      c: 'productionCards', id, baseV: destination.v, op: 'upsert',
      d: {
        ...target, links: [...links.values()], mediaIds: [...new Set([...(target.mediaIds ?? []), ...(source.mediaIds ?? [])])],
        script: target.script || source.script, scriptApproved: target.script ? target.scriptApproved : false,
        log: [...(target.log ?? []), {
          id: newId('log'), kind: 'NOTE', text: `ضُمّت مخرجات «${source.title}» إلى التكليف. ${choice.reason}`,
        }],
      },
    });
    if (accepted.ok === false) throw new CardMergeError(409, accepted.message);
    const archived = write({
      c: 'productionCards', id: duplicate.id, baseV: duplicate.v, op: 'upsert',
      d: { ...source, status: 'CANCELLED', cancellationReason: `تكليف مكرر من «${target.title}». ${choice.reason}` },
    });
    if (archived.ok === false) throw new CardMergeError(409, archived.message);
  });
}
