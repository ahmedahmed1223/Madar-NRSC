import type { SyncOpResult } from '../shared/collections';
import { newId } from '../shared/ids';
import { dataStore } from './dataStore';
import { apiFetch } from './http';

/** A live failure notice is sent immediately, outside the offline write queue. */
export async function sendBulletinPlaybackFailure(episodeId: string, storyTitle: string) {
  const id = newId('cue');
  const d = {
    id, episodeId, level: 'urgent', targetDepartmentIds: ['direction', 'control', 'studio', 'presenters'],
    message: `تعذّر تشغيل مادة «${storyTitle}».`.slice(0, 300),
  };
  const response = await apiFetch<{ results: SyncOpResult[] }>('/api/v1/data/sync', {
    method: 'POST', json: { ops: [{ c: 'cues', op: 'upsert', id, d }] }, signal: AbortSignal.timeout(5000),
  });
  const result = response.results[0];
  if (result?.ok === false) throw new Error(result.message || 'تعذر إرسال تنبيه التشغيل');
  if (!result?.ok) throw new Error('لم يؤكد الخادم إرسال التنبيه');
  void dataStore.pull();
}
