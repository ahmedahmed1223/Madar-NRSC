import { describe, expect, it, vi } from 'vitest';
import {
  confirmUnsavedDiscard,
  registerBeforeUnloadGuard,
  type BeforeUnloadTarget,
} from '../../src/hooks/useUnsavedChangesGuard';
import { onDialogs, settleDialog } from '../../src/services/dialogs';

describe('unsavedChangesGuard helpers', () => {
  it('registers and unregisters a beforeunload listener that prevents unload and runs callback', () => {
    let registered: ((event: BeforeUnloadEvent) => void) | null = null;
    const target: BeforeUnloadTarget = {
      addEventListener: (_type, listener) => {
        registered = listener;
      },
      removeEventListener: (_type, listener) => {
        if (registered === listener) registered = null;
      },
    };

    const onBeforeUnload = vi.fn();
    const cleanup = registerBeforeUnloadGuard(target, onBeforeUnload);
    expect(registered).not.toBeNull();

    const preventDefault = vi.fn();
    const fakeEvent = { preventDefault, returnValue: 'initial' } as unknown as BeforeUnloadEvent;
    registered!(fakeEvent);

    expect(onBeforeUnload).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fakeEvent.returnValue).toBe('');

    cleanup();
    expect(registered).toBeNull();
  });

  it('resolves true immediately when not dirty without opening a confirmation dialog', async () => {
    const queues: number[] = [];
    const unsub = onDialogs((q) => queues.push(q.length));
    try {
      const allowed = await confirmUnsavedDiscard(false);
      expect(allowed).toBe(true);
      expect(queues).toEqual([0]);
    } finally {
      unsub();
    }
  });

  it('opens a danger confirmation dialog when dirty and resolves with user choice', async () => {
    let seenTitle = '';
    let seenDanger = false;
    const unsub = onDialogs((q) => {
      const req = q[0];
      if (req && req.kind === 'confirm') {
        seenTitle = req.options.title ?? '';
        seenDanger = Boolean(req.options.danger);
        settleDialog(req.id, false);
      }
    });
    try {
      const allowed = await confirmUnsavedDiscard(true, {
        title: 'حفظ التعديلات',
        message: 'هل تريد تجاهل التعديلات؟',
      });
      expect(allowed).toBe(false);
      expect(seenTitle).toBe('حفظ التعديلات');
      expect(seenDanger).toBe(true);
    } finally {
      unsub();
    }
  });
});
