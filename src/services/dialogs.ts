/**
 * In-app replacements for window.confirm / alert / prompt: styled, accessible, RTL, and
 * testable. Each call returns a promise; <DialogHost /> (mounted once) shows them in order.
 */

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (delete, end broadcast…). */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Refuse an empty answer. */
  required?: boolean;
  multiline?: boolean;
  /** Show a value to copy (e.g. a temporary password): no cancel, a copy button instead. */
  copyOnly?: boolean;
}

export type DialogRequest =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'alert'; options: ConfirmOptions; resolve: (v: void) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void };

type Listener = (queue: DialogRequest[]) => void;
let queue: DialogRequest[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(queue));

export function onDialogs(l: Listener): () => void {
  listeners.add(l);
  l(queue);
  return () => listeners.delete(l);
}

/** Called by the host when the user answers the front dialog. */
export function settleDialog(id: number, value: unknown) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  (req.resolve as (v: unknown) => void)(value);
}

/** Destructive wording gets a red confirm button unless the caller says otherwise. */
const DANGER = /حذف|إنهاء|إلغاء|إعادة تهيئة|استعادة|استبدال|تولي|نهائي/;
const asOptions = (o: string | ConfirmOptions): ConfirmOptions => (typeof o === 'string' ? { message: o, danger: DANGER.test(o) } : o);

/** Resolves true when confirmed, false when cancelled (Esc, backdrop, «إلغاء»). */
export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, kind: 'confirm', options: asOptions(options), resolve }];
    emit();
  });
}

/** A message that needs acknowledging (use notify() for ordinary errors). */
export function alertDialog(options: string | ConfirmOptions): Promise<void> {
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, kind: 'alert', options: asOptions(options), resolve }];
    emit();
  });
}

/** Resolves the typed text, or null when cancelled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, kind: 'prompt', options, resolve }];
    emit();
  });
}
