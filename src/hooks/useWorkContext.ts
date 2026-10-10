import { useCallback, useMemo, useRef } from 'react';
import { readWorkContext, sanitizeWorkContext, workContextKey, writeWorkContext, type WorkContext } from '../shared/workContext';
import { notify } from '../services/notify';

export function useWorkContext(userId: string, scope: string) {
  const warned = useRef(false);
  const context = useMemo(() => {
    try { return readWorkContext(sessionStorage, userId, scope); }
    catch { return sanitizeWorkContext({ schemaVersion: 1, definition: { activeTab: scope } }); }
  }, [userId, scope]);
  const save = useCallback((value: WorkContext) => {
    let ok = false;
    try { ok = writeWorkContext(sessionStorage, userId, scope, value); } catch { /* Access itself can fail. */ }
    if (!ok && !warned.current) {
      warned.current = true;
      notify({ type: 'warning', message: 'تعذر حفظ موضع القائمة على الجهاز؛ يمكنك متابعة العمل في هذه الزيارة.' });
    }
    return ok;
  }, [userId, scope]);
  const clear = useCallback(() => {
    try { sessionStorage.removeItem(workContextKey(userId, scope)); } catch { /* Navigation stays available. */ }
  }, [userId, scope]);
  return { context, save, clear };
}
