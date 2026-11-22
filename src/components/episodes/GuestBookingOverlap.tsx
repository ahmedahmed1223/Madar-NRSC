import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { navigateTo } from '../../services/uiEvents';
import { overlappingGuestBookings } from '../../shared/coverageOverlap';
import { stationName, stationsOf } from '../../shared/stations';

export function GuestBookingOverlap({ guestId, showId, producerId }: { guestId: string; showId: string; producerId?: string }) {
  useLiveData(['episodes', 'bulletins', 'bulletinStories', 'users'], 30_000);
  const directory = apiService.getUsers();
  const stationId = directory.find(user => user.id === producerId)?.stationId || apiService.getCurrentUser().stationId;
  const stations = stationsOf(apiService.getSettings());
  const overlapping = overlappingGuestBookings(guestId, showId, apiService.getAirShows(), directory, stationId);
  if (!overlapping.length) return null;
  return (
    <aside aria-label="حجز الضيف في محطة أخرى" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p>أكّدت محطات أخرى حجز الضيف خلال آخر 24 ساعة.</p>
      <ul>{overlapping.map(({ episode: other, stationId: otherStation }) => (
        <li key={other.id}><button type="button" className="min-h-11 text-start font-semibold underline" onClick={() => navigateTo.emit(`/${other.kind === 'bulletin' ? 'bulletins' : 'episodes'}/${encodeURIComponent(other.id)}`)}>{other.title} · {stationName(stations, otherStation)}</button></li>
      ))}</ul>
    </aside>
  );
}
