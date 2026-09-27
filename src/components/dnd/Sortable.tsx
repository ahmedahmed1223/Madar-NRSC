/**
 * Drag to arrange, built on pointer events so it works with a mouse, a touch screen or a pen,
 * plus keyboard moves for accessibility.
 *
 *   <SortableScope onDrop={({ id, from, to, index }) => ...}>
 *     <List id="topic-1">  (useSortableContainer)
 *       <Row>              (useSortableItem + <DragHandle/>)
 *
 * Items can move within a container or between containers (e.g. a segment to another topic,
 * a task to another column). While dragging, a line shows where the item will land and a
 * label follows the pointer; the page scrolls near the edges; Escape cancels.
 * Keyboard: focus the handle and press ↑ / ↓ to move one place.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';

export interface DropEvent {
  id: string;
  /** Container the item came from. */
  from: string;
  /** Container it was dropped in. */
  to: string;
  /** Position among the target container's items, not counting the dragged item. */
  index: number;
}

interface DragState {
  id: string;
  from: string;
  label: string;
  x: number;
  y: number;
  target: { container: string; index: number } | null;
  line: { top: number; left: number; width: number } | null;
}

interface Ctx {
  registerItem: (id: string, container: string, el: HTMLElement | null) => void;
  registerContainer: (id: string, el: HTMLElement | null, accept?: string) => void;
  begin: (id: string, container: string, label: string, e: React.PointerEvent, type?: string) => void;
  keyMove: (id: string, container: string, label: string, delta: -1 | 1) => void;
  draggingId: string | null;
  overContainer: string | null;
  disabled: boolean;
}

const SortableContext = createContext<Ctx | null>(null);

const DRAG_THRESHOLD = 5;
const EDGE = 70;

/** Items of a container in on-screen order. */
function itemsOf(items: Map<string, { container: string; el: HTMLElement }>, container: string, exclude?: string) {
  return [...items.entries()]
    .filter(([id, v]) => v.container === container && id !== exclude && v.el.isConnected)
    .map(([id, v]) => ({ id, el: v.el, rect: v.el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
}

export const SortableScope: React.FC<{ onDrop: (e: DropEvent) => void; disabled?: boolean; children: React.ReactNode }> = ({ onDrop, disabled = false, children }) => {
  const items = useRef(new Map<string, { container: string; el: HTMLElement }>());
  /** Each list accepts one kind of item (e.g. topics vs segments on the same screen). */
  const containers = useRef(new Map<string, { el: HTMLElement; accept: string }>());
  const dragType = useRef('item');
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pending = useRef<{ id: string; container: string; label: string; x: number; y: number; pointerId: number; handle: HTMLElement } | null>(null);
  const scrollRaf = useRef<number>(0);
  const [announcement, setAnnouncement] = useState('');
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const registerItem = useCallback((id: string, container: string, el: HTMLElement | null) => {
    if (el) items.current.set(id, { container, el });
    else if (items.current.get(id)?.container === container) items.current.delete(id);
  }, []);
  const registerContainer = useCallback((id: string, el: HTMLElement | null, accept = 'item') => {
    if (el) containers.current.set(id, { el, accept });
    else containers.current.delete(id);
  }, []);

  const update = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** Where the pointer would drop the item, and where to draw the line. */
  const locate = (x: number, y: number, id: string, current: DragState['target']): Pick<DragState, 'target' | 'line'> => {
    let container: string | null = null;
    for (const [cid, { el, accept }] of containers.current) {
      if (!el.isConnected || accept !== dragType.current) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 8 && y <= r.bottom + 8) {
        container = cid;
        break;
      }
    }
    container = container || current?.container || null;
    if (!container) return { target: null, line: null };
    const box = containers.current.get(container)!.el.getBoundingClientRect();
    const list = itemsOf(items.current, container, id);
    let index = list.findIndex((it) => y < it.rect.top + it.rect.height / 2);
    if (index === -1) index = list.length;
    const ref = list[index] || list[list.length - 1];
    const top = !ref ? box.top + 6 : index < list.length ? ref.rect.top - 1 : ref.rect.bottom + 1;
    const left = ref ? ref.rect.left : box.left + 6;
    const width = ref ? ref.rect.width : box.width - 12;
    return { target: { container, index }, line: { top, left, width } };
  };

  const autoScroll = () => {
    const d = dragRef.current;
    if (!d) return;
    const speed = d.y < EDGE ? -Math.ceil((EDGE - d.y) / 4) : d.y > window.innerHeight - EDGE ? Math.ceil((d.y - (window.innerHeight - EDGE)) / 4) : 0;
    if (speed) {
      window.scrollBy(0, speed);
      update({ ...d, ...locate(d.x, d.y, d.id, d.target) });
    }
    scrollRaf.current = requestAnimationFrame(autoScroll);
  };

  const finish = (commit: boolean) => {
    cancelAnimationFrame(scrollRaf.current);
    document.body.classList.remove('dnd-dragging');
    const d = dragRef.current;
    pending.current = null;
    update(null);
    if (!commit || !d?.target) return;
    const original = itemsOf(items.current, d.from).findIndex((it) => it.id === d.id);
    if (d.target.container === d.from && d.target.index === original) return;
    onDropRef.current({ id: d.id, from: d.from, to: d.target.container, index: d.target.index });
    setAnnouncement(`نُقل «${d.label}» إلى الموضع ${d.target.index + 1}`);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        document.body.classList.add('dnd-dragging');
        update({ id: p.id, from: p.container, label: p.label, x: e.clientX, y: e.clientY, target: null, line: null });
        scrollRaf.current = requestAnimationFrame(autoScroll);
      }
      e.preventDefault();
      const d = dragRef.current!;
      update({ ...d, x: e.clientX, y: e.clientY, ...locate(e.clientX, e.clientY, d.id, d.target) });
    };
    const up = (e: PointerEvent) => {
      if (!pending.current || e.pointerId !== pending.current.pointerId) return;
      finish(!!dragRef.current);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault();
        finish(false);
        setAnnouncement('أُلغي السحب');
      }
    };
    const cancel = () => dragRef.current && finish(false);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      cancelAnimationFrame(scrollRaf.current);
      document.body.classList.remove('dnd-dragging');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = useCallback(
    (id: string, container: string, label: string, e: React.PointerEvent, type = 'item') => {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.stopPropagation();
      dragType.current = type;
      pending.current = { id, container, label, x: e.clientX, y: e.clientY, pointerId: e.pointerId, handle: e.currentTarget as HTMLElement };
    },
    [disabled]
  );

  const keyMove = useCallback(
    (id: string, container: string, label: string, delta: -1 | 1) => {
      if (disabled) return;
      const list = itemsOf(items.current, container);
      const at = list.findIndex((it) => it.id === id);
      const index = at + delta;
      if (at === -1 || index < 0 || index >= list.length) return;
      onDropRef.current({ id, from: container, to: container, index });
      setAnnouncement(`نُقل «${label}» إلى الموضع ${index + 1} من ${list.length}`);
    },
    [disabled]
  );

  const value = useMemo<Ctx>(
    () => ({ registerItem, registerContainer, begin, keyMove, draggingId: drag?.id || null, overContainer: drag?.target?.container || null, disabled }),
    [registerItem, registerContainer, begin, keyMove, drag?.id, drag?.target?.container, disabled]
  );

  return (
    <SortableContext.Provider value={value}>
      {children}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {drag &&
        createPortal(
          <>
            {drag.line && (
              <div
                aria-hidden
                className="fixed z-[80] h-[3px] rounded-full bg-blue-600 pointer-events-none shadow-[0_0_0_2px_rgba(37,99,235,0.2)]"
                style={{ top: drag.line.top - 1, left: drag.line.left, width: drag.line.width }}
              >
                <span className="absolute -top-[3px] -right-1 w-2.5 h-2.5 rounded-full bg-blue-600" />
              </div>
            )}
            <div
              aria-hidden
              className="fixed z-[81] pointer-events-none px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold shadow-xl max-w-[16rem] truncate"
              style={{ top: drag.y + 12, left: drag.x + 12 }}
            >
              {drag.label}
            </div>
          </>,
          document.body
        )}
    </SortableContext.Provider>
  );
};

/** Registers a list (or column) that items can be dropped into. */
export function useSortableContainer(id: string, accept = 'item') {
  const ctx = useContext(SortableContext);
  const ref = useCallback((el: HTMLElement | null) => ctx?.registerContainer(id, el, accept), [ctx, id, accept]);
  return { ref, isOver: !!ctx?.draggingId && ctx.overContainer === id };
}

/** Registers a draggable item; spread `handleProps` on its <DragHandle/> (or the whole card). */
export function useSortableItem(id: string, container: string, label: string, opts: { disabled?: boolean; type?: string } = {}) {
  const ctx = useContext(SortableContext);
  const ref = useCallback((el: HTMLElement | null) => ctx?.registerItem(id, container, el), [ctx, id, container]);
  const disabled = !ctx || ctx.disabled || !!opts.disabled;
  const handleProps = disabled
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent) => ctx!.begin(id, container, label, e, opts.type),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            ctx!.keyMove(id, container, label, e.key === 'ArrowUp' ? -1 : 1);
          }
        },
        style: { touchAction: 'none' } as React.CSSProperties,
      };
  return { ref, handleProps, isDragging: ctx?.draggingId === id, enabled: !disabled };
}

/** The grip users drag (or focus and move with the arrow keys). */
export const DragHandle: React.FC<{ label: string; handleProps: Record<string, any>; enabled?: boolean; className?: string }> = ({ label, handleProps, enabled = true, className = '' }) =>
  enabled ? (
    <button
      type="button"
      {...handleProps}
      aria-label={`اسحب لإعادة ترتيب «${label}» — أو استخدم السهمين للأعلى والأسفل`}
      title="اسحب لإعادة الترتيب (أو الأسهم ↑ ↓)"
      className={`p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  ) : null;

/** Moves an element within an array to a new index. */
export function moveInArray<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

type Tag = 'div' | 'li' | 'tr' | 'ul' | 'ol' | 'tbody' | 'section';

/** A drop target list/column; highlights while an item is dragged over it. */
export const SortableList: React.FC<{ id: string; as?: Tag; accept?: string; className?: string; children: React.ReactNode } & Record<string, any>> = ({ id, as = 'div', accept, className = '', children, ...rest }) => {
  const { ref, isOver } = useSortableContainer(id, accept);
  const Comp = as as any;
  return (
    <Comp ref={ref} className={`${className} ${isOver ? 'dnd-over' : ''}`} data-sortable-list={id} {...rest}>
      {children}
    </Comp>
  );
};

/** A draggable row/card; `children` receives the drag handle to place where it fits. */
export function SortableItem({
  id,
  container,
  label,
  as = 'div',
  disabled,
  type,
  className = '',
  children,
  ...rest
}: {
  id: string;
  container: string;
  label: string;
  as?: Tag;
  disabled?: boolean;
  /** Kind of item; it can only be dropped in lists that accept this kind. */
  type?: string;
  className?: string;
  children: (h: { handle: React.ReactNode; handleProps: Record<string, any>; isDragging: boolean }) => React.ReactNode;
} & Record<string, any>) {
  const { ref, handleProps, isDragging, enabled } = useSortableItem(id, container, label, { disabled, type });
  const Comp = as as any;
  return (
    <Comp ref={ref} className={`${className} ${isDragging ? 'dnd-source' : ''}`} data-sortable-item={id} {...rest}>
      {children({ handle: <DragHandle label={label} handleProps={handleProps} enabled={enabled} />, handleProps, isDragging })}
    </Comp>
  );
}
