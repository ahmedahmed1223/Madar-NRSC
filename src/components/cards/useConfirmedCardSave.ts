import { useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { dataStore } from '../../services/dataStore';
import { newId } from '../../shared/ids';
import type { ProductionCard } from '../../shared/productionCards';

export function useConfirmedCardSave() {
  const draftId = useRef<string | null>(null);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    draftId.current = null;
    setError(null);
  };

  const save = async (build: (id: string) => ProductionCard) => {
    if (pending.current) return null;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = apiService.saveCard(build(draftId.current ??= newId('crd')));
      const result = await dataStore.awaitWrite('productionCards', saved.id);
      if (result.ok) return saved;
      setError(result.message || 'لم يؤكد الخادم حفظ التكليف بعد. يمكنك إعادة المحاولة من هذه المسودة.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذر حفظ التكليف');
    } finally {
      pending.current = false;
      setSaving(false);
    }
    return null;
  };

  return { save, saving, error, reset, pending };
}
