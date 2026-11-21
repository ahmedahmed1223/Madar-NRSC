import { useEffect, useRef, type RefObject } from 'react';
import { canFocus, tabStops, trapTab } from '../shared/focus';

interface ModalFocusOptions {
  close: () => void;
  initialFocus?: () => HTMLElement | null | undefined;
  /** Global prompts appear above any view-owned modal. */
  global?: boolean;
}

const openLayers: { element: HTMLElement; global: boolean }[] = [];
let previousOverflow = '';

function topLayer() {
  return openLayers.filter(layer => layer.global).at(-1) || openLayers.at(-1);
}

export function useModalFocus(open: boolean, ref: RefObject<HTMLElement | null>, options: ModalFocusOptions) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!open || !ref.current) return;
    const element = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const layer = { element, global: !!latest.current.global };
    if (!openLayers.length) previousOverflow = document.body.style.overflow;
    openLayers.push(layer);
    document.body.style.overflow = 'hidden';

    function focusInside() {
      const preferred = latest.current.initialFocus?.();
      if (canFocus(preferred)) preferred.focus({ preventScroll: true });
      if (!element.contains(document.activeElement)) (tabStops(element)[0] || element).focus({ preventScroll: true });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (topLayer() !== layer || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latest.current.close();
      } else trapTab(event, element);
    }

    if (topLayer() === layer) focusInside();
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const wasTop = topLayer() === layer;
      openLayers.splice(openLayers.indexOf(layer), 1);
      const next = topLayer();
      if (!next) document.body.style.overflow = previousOverflow;
      if (!wasTop) return;
      if (canFocus(opener) && (!next || next.element.contains(opener))) opener.focus({ preventScroll: true });
      else if (next && !next.element.contains(document.activeElement)) (tabStops(next.element)[0] || next.element).focus({ preventScroll: true });
    };
  }, [open, ref]);
}
