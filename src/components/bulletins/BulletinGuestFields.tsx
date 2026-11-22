import { apiService } from '../../services/api';
import type { BulletinRemoteGuest, BulletinStory } from '../../shared/bulletins';
import { ExternalLinkPanel } from '../common/ExternalLinkPanel';
import { GuestBookingOverlap } from '../episodes/GuestBookingOverlap';

export function BulletinGuestFields({ value, onChange, story, bulletinId, editorId, disabled }: {
  value?: BulletinRemoteGuest;
  onChange: (value?: BulletinRemoteGuest) => void;
  story: Partial<BulletinStory>;
  bulletinId: string;
  editorId?: string;
  disabled: boolean;
}) {
  const canInvite = !disabled && !!story.id && !!story.remoteGuest?.confirmed && !!value?.confirmed && story.remoteGuest.guestId === value.guestId;
  return (
    <fieldset className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3">
      <legend className="px-1 font-bold">ضيف النشرة عبر الإنترنت</legend>
      <label className="block">
        الضيف
        <select disabled={disabled} value={value?.guestId || ''} onChange={event => onChange(event.target.value ? { guestId: event.target.value, confirmed: false } : undefined)}
          className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2">
          <option value="">دون ضيف</option>
          {apiService.getGuests().map(guest => <option key={guest.id} value={guest.id}>{guest.fullName}</option>)}
        </select>
      </label>
      {value && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={disabled} checked={value.confirmed} onChange={event => onChange({ ...value, confirmed: event.target.checked })} /> تأكيد مشاركته عبر الإنترنت</label>}
      {value && <GuestBookingOverlap guestId={value.guestId} showId={bulletinId} producerId={editorId} />}
      {canInvite && <ExternalLinkPanel kind="guest" bulletinStoryId={story.id} guestId={story.remoteGuest!.guestId} />}
      {canInvite && story.remoteGuest?.check?.status === 'PASSED' && <p className="font-semibold text-emerald-800">جاهز تقنيًا</p>}
      {canInvite && story.remoteGuest?.check?.status === 'FAILED' && <p className="text-amber-900">{story.remoteGuest.check.note}</p>}
    </fieldset>
  );
}
