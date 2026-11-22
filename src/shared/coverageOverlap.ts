import type { Episode, NewsItem, User } from '../types';
import { normalizeArabic } from './search';
import { bookingStatusOf, episodeGuestList, guestKey } from './episodePlan';

const DAY = 86_400_000;
const filler = new Set(['على', 'الى', 'عن', 'هذا', 'هذه', 'بعد', 'قبل', 'خلال', 'ذلك', 'الذي', 'التي', 'هناك']);
const terms = (value: string) => new Set(normalizeArabic(value).split(/[^\p{L}\p{N}]+/u)
  .map(word => word.length >= 6 && word.startsWith('ال') ? word.slice(2) : word)
  .filter(word => word.length >= 3 && !filler.has(word)));
const recent = (value: string | undefined, now: number) => {
  const time = Date.parse(value || '');
  return time <= now && time >= now - DAY;
};

export function overlappingNews(title: string, items: NewsItem[], users: Pick<User, 'id' | 'stationId'>[],
  stationId?: string, currentId?: string, now = Date.now()) {
  const wanted = terms(title);
  if (!stationId || wanted.size < 3) return [];
  const stations = new Map(users.map(user => [user.id, user.stationId]));
  return items.flatMap(item => {
    const other = stations.get(item.authorId);
    if (item.id === currentId || item.deletedAt || item.status === 'REJECTED' || !other || other === stationId ||
      !recent(item.createdAt, now) || (item.embargoUntil && Date.parse(item.embargoUntil) > now)) return [];
    const existing = terms(item.title);
    const shared = [...wanted].filter(word => existing.has(word)).length;
    const score = 2 * shared / (wanted.size + existing.size);
    return shared >= 3 && score >= 0.55 ? [{ item, stationId: other, score }] : [];
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function overlappingGuestBookings(guestId: string, currentShowId: string, episodes: (Episode & { kind?: 'episode' | 'bulletin' })[],
  users: Pick<User, 'id' | 'stationId'>[], stationId?: string, now = Date.now()) {
  if (!guestId || !stationId) return [];
  const stations = new Map(users.map(user => [user.id, user.stationId]));
  return episodes.flatMap(other => {
    const otherStation = stations.get(other.producerId || '');
    if (other.id === currentShowId || other.deletedAt || ['CANCELLED', 'ARCHIVED', 'BROADCASTED'].includes(other.status) ||
      !otherStation || otherStation === stationId) return [];
    const booking = episodeGuestList(other).find(guest =>
      guestKey(guest) === guestId && ['CONFIRMED', 'ARRIVED'].includes(bookingStatusOf(guest)));
    const bookedAt = booking?.bookingChangedAt || other.createdAt;
    return booking && recent(bookedAt, now) ? [{ episode: other, stationId: otherStation, bookedAt }] : [];
  }).sort((a, b) => (b.bookedAt || '').localeCompare(a.bookedAt || '')).slice(0, 3);
}

export function stampGuestBookingTimes(before: Episode | undefined, after: Episode, now: string): Episode {
  if (!Array.isArray(after.guests)) return after;
  const previous = new Map(episodeGuestList(before).map(guest => [guestKey(guest), guest]));
  return {
    ...after,
    guests: after.guests.map(guest => {
      const prior = previous.get(guestKey(guest));
      const status = bookingStatusOf(guest);
      const continuing = prior && ['CONFIRMED', 'ARRIVED'].includes(bookingStatusOf(prior));
      const bookingChangedAt = ['CONFIRMED', 'ARRIVED'].includes(status) ? (continuing ? prior.bookingChangedAt : now) : undefined;
      return { ...guest, bookingChangedAt };
    }),
  };
}
