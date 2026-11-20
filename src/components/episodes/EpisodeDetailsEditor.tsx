import React, { useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { Episode, User } from '../../types';
import { FormPage } from '../common/FormPage';
import { confirmDialog } from '../../services/dialogs';
import { apiService } from '../../services/api';
import { useFormDraft } from '../../hooks/useFormDraft';
import { useEditLock, type EditLockStatus } from '../../hooks/useNewsEditLock';
import { studioConflictsFor } from '../../shared/schedule';
import { bulletinSlotsAround } from './airSlots';
import { EpisodeDetailsFields } from './EpisodeDetailsFields';
import {
  episodeDetailsBlock,
  episodeDetailsError,
  episodeDetailsOf,
  episodeDetailsPatch,
  patchMovesSlot,
  type EpisodeDetailsValues,
} from './episodeDetails';

interface EpisodeDetailsEditorProps {
  episode: Episode;
  /** Other episodes, to warn about studio clashes when the slot moves. */
  episodes: Episode[];
  currentUser: User;
  onClose: () => void;
  onSaveEpisode: (episode: Partial<Episode>) => boolean | Promise<boolean>;
  /**
   * The edit lock the caller already holds (the episode workspace). Without it the form takes
   * the episode's lock itself while it is open, as the workspace does.
   */
  lock?: { status: EditLockStatus; holderName?: string | null };
}

/**
 * «تعديل بيانات الحلقة»: title, numbering, air slot and crew of an existing episode. Mount it
 * only while open; it saves just the changed fields and closes once the server confirms.
 */
export const EpisodeDetailsEditor: React.FC<EpisodeDetailsEditorProps> = ({ episode, episodes, currentUser, onClose, onSaveEpisode, lock }) => {
  const ownLock = useEditLock('episodes', episode.id, !lock);
  const lockStatus = lock ? lock.status : ownLock.status;
  const holderName = lock ? lock.holderName : ownLock.holder?.userName;
  const [values, setValues] = useState<EpisodeDetailsValues>(() => episodeDetailsOf(episode));
  const draft = useFormDraft(`episode-details:${currentUser.id}:${episode.id}`, true, values, setValues);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const block = episodeDetailsBlock({
    mayEdit: true, // the caller only offers the form to people with episodes.edit
    lockedByName: lockStatus === 'locked' ? holderName || 'زميل آخر' : null,
    liveLock: apiService.getBroadcastState().liveLock,
    status: episode.status,
  });
  const acquiring = lockStatus === 'acquiring';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current || block || acquiring) return;
    const invalid = episodeDetailsError(values);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    const patch = episodeDetailsPatch(episode, values);
    if (!patch) {
      draft.clearDraft();
      onClose();
      return;
    }
    if (patchMovesSlot(patch)) {
      const moved = { ...episode, ...patch, id: episode.id };
      // Bulletins in the same studio count too, not only other episodes.
      const clashes = studioConflictsFor(moved, [...episodes, ...bulletinSlotsAround(moved.broadcastDate)]);
      if (
        clashes.length > 0 &&
        !(await confirmDialog(
          `تنبيه تعارض استوديو: الموعد يتداخل مع ${clashes
            .map((c) => `«${c.programName} – ${c.title}» (${c.startTime}–${c.endTime})`)
            .join('، ')}. هل تريد الحفظ رغم ذلك؟`
        ))
      ) {
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (await onSaveEpisode(patch)) {
        draft.clearDraft();
        onClose();
      } else {
        setError('لم يؤكد الخادم حفظ بيانات الحلقة؛ تعديلاتك باقية في النموذج، أعد المحاولة.');
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ بيانات الحلقة.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <FormPage
      isOpen
      draft={draft}
      onClose={onClose}
      title="تعديل بيانات الحلقة"
      subtitle={`${episode.programName} — حلقة #${episode.episodeNumber}`}
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {block && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>{block} يمكنك الاطلاع على البيانات فقط.</span>
          </div>
        )}
        <EpisodeDetailsFields
          idPrefix="episode-edit"
          values={values}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          disabled={!!block || saving}
        />
        {error && (
          <p role="alert" className="text-xs font-bold text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => void draft.close(onClose)}
            className="min-h-11 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            إلغاء
          </button>
          {!block && (
            <button
              type="submit"
              disabled={saving || acquiring}
              className="min-h-11 px-5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'جارٍ الحفظ على الخادم…' : acquiring ? 'جارٍ حجز الحلقة للتحرير…' : 'حفظ بيانات الحلقة'}
            </button>
          )}
        </div>
      </form>
    </FormPage>
  );
};
