import { createHash } from 'node:crypto';
import { bulletinAsShow, type BulletinStory } from '../shared/bulletins';
import { BULLETIN_SOURCE_CORRECTION, type NewsCorrection } from '../shared/newsCorrections';
import { canControlOnAir, type OnAirState } from '../shared/onair';
import { buildAuthContext } from './auth';
import type { NewsroomDatabase } from './db';
import { writeNotification } from './notifications';
import { canRead } from './policy';

/** Call within the correction or rundown write so the notice shares its revision. */
export function notifyBulletinSourceCorrections(db: NewsroomDatabase, state: OnAirState, correction?: NewsCorrection) {
  if (state.status !== 'LIVE' || !state.operatorId) return;
  const bulletin = db.getRow('bulletins', state.episodeId)?.d;
  const user = db.getRow('users', state.operatorId)?.d;
  if (!bulletin || bulletin.deletedAt || !user || user.deletedAt || user.isActive === false) return;
  const operator = buildAuthContext(db, user, '');
  const lookup = (collection: Parameters<typeof db.getRow>[0], id: string) => db.getRow(collection, id)?.d;
  if (!canControlOnAir(user, operator.can) || !canRead(operator, 'onAir', state, lookup)) return;

  const stories: BulletinStory[] = db.listCollection('bulletinStories').map(row => row.d)
    .filter(story => story.bulletinId === bulletin.id && !story.deletedAt);
  const { rundown } = bulletinAsShow(bulletin, stories, state.currentSegmentId);
  const index = rundown.findIndex(segment => segment.id === state.currentSegmentId);
  if (index < 0) return;
  const nearby = rundown.slice(index, index + 2).flatMap(segment => {
    const story = stories.find(item => item.id === segment.id);
    if (!story?.newsId || (correction && story.newsId !== correction.newsId)) return [];
    return [story];
  });
  if (nearby.length === 0) return;
  const records: NewsCorrection[] = correction ? [correction] : db.listCollection('newsCorrections').map(row => row.d);
  for (const record of records) {
    const story = nearby.find(item => item.newsId === record.newsId && record.createdAt >= (item.newsUpdatedAt || state.startedAt));
    if (!story) continue;
    const digest = createHash('sha256').update(JSON.stringify([bulletin.id, state.startedAt, record.id, user.id])).digest('hex');
    const id = `bulletin-source-${digest}`;
    if (db.getRow('notifications', id, true)) continue;
    const source = lookup('news', record.newsId);
    const detail = source && canRead(operator, 'newsCorrections', record, lookup) ? ` ${record.summary}` : '';
    writeNotification(db, {
      userId: user.id, title: 'تصحيح في مصدر مادة النشرة',
      message: `ورد تصحيح لمصدر «${story.slug}». راجع الفقرة قبل مواصلة البث.${detail}`,
      type: BULLETIN_SOURCE_CORRECTION, category: 'bulletin', urgent: true,
      linkUrl: `/bulletins/${encodeURIComponent(bulletin.id)}`,
    }, { id, createdAt: new Date().toISOString() });
  }
}
