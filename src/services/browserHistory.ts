/** A preview frame may disable history writes. Its controls still update React state. */
export function writeBrowserHistory(mode: 'push' | 'replace', state: unknown, address?: string) {
  try {
    if (mode === 'push') window.history.pushState(state, '', address);
    else window.history.replaceState(state, '', address);
  } catch {
    // The address bar is optional when the host restricts it.
  }
}

export function browserAddress(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}
