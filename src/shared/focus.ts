const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]';

export function canFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return !!element?.isConnected && !element.matches(':disabled') &&
    !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible';
}

export function tabStops(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.tabIndex >= 0 && canFocus(element));
}

/** Keeps browser Tab navigation within a modal or a mobile navigation drawer. */
export function trapTab(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'defaultPrevented' | 'preventDefault'>, container: HTMLElement) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const stops = tabStops(container);
  const index = stops.indexOf(document.activeElement as HTMLElement);
  if (index >= 0 && (event.shiftKey ? index > 0 : index < stops.length - 1)) return;
  event.preventDefault();
  (stops[event.shiftKey ? stops.length - 1 : 0] || container).focus();
}
