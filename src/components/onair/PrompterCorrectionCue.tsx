import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { isCueActive, isCueForUser } from '../../shared/onair';
import type { User } from '../../types';

export function PrompterCorrectionCue({ showId, user }: { showId: string; user: User }) {
  useLiveData(['cues'], 1000);
  const latest = apiService.getCues()
    .filter(cue => cue.purpose === 'PROMPTER_CORRECTION' && cue.episodeId === showId && isCueActive(cue) &&
      isCueForUser(cue, user) && !cue.acks.some(ack => ack.userId === user.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p role="alert">{latest.message}</p>
      <button type="button" className="min-h-11 rounded-lg border border-amber-300 px-3 font-bold" onClick={() => apiService.ackCue(latest.id)}>
        تم إبلاغ المذيع
      </button>
    </div>
  );
}
