/**
 * Small app-wide UI signals between components that do not share a parent state:
 * the screen changed (close floating panels), and the team chat drawer's toggle/unread count.
 */

type Handler<T> = (value: T) => void;

function channel<T>() {
  const handlers = new Set<Handler<T>>();
  let last: T | undefined;
  return {
    emit(value: T) {
      last = value;
      handlers.forEach((h) => h(value));
    },
    on(h: Handler<T>) {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
    get last() {
      return last;
    },
  };
}

/** Fired whenever the visible screen (address) changes. */
export const routeChanged = channel<string>();
/** Asks the app to open an address ("/messages", "/cards/<id>") from a component outside the screen tree. */
export const navigateTo = channel<string>();
/** Asks the chat drawer to open, close or toggle. */
export const intercomCommand = channel<'open' | 'close' | 'toggle'>();
/** The chat drawer reports whether it is open and how many messages are unread. */
export const intercomState = channel<{ open: boolean; unread: number }>();

/** Starts an interactive tour by id (see src/content/tours.ts). */
export const tourCommand = channel<string>();
/** Opens the administrator's quick-setup wizard. */
export type SetupCommand = 'open' | 'review' | { reviewId: string };
export const setupCommand = channel<SetupCommand>();
