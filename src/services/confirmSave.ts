import type { CollectionName } from '../shared/collections';
import { dataStore } from './dataStore';
import { notify } from './notify';

/**
 * Waits for the server to accept a write before telling the user it is saved.
 * A refusal is already announced by the sync layer (with the server's reason); a slow server
 * gets a clear "not confirmed yet" notice while the change keeps retrying in the background.
 */
export async function confirmSaved(collection: CollectionName, id: string, success: string): Promise<boolean> {
  const outcome = await dataStore.awaitWrite(collection, id);
  if (outcome.ok) {
    notify({ type: 'success', message: success });
    return true;
  }
  if (outcome.pending) notify({ type: 'warning', title: 'لم يؤكد الخادم الحفظ بعد', message: outcome.message || '' });
  return false;
}
