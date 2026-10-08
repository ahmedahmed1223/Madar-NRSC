import { useId } from 'react';
import type { AirDisplayMode } from '../../shared/airDisplay';

export function AirDisplayControls({ mode, onChange }: { mode: AirDisplayMode; onChange: (mode: AirDisplayMode) => void }) {
  const name = useId();
  return <fieldset className="flex flex-wrap items-center gap-4 text-sm"><legend className="sr-only">وضع عرض الهواء</legend>
    {([{ id: 'OPERATIONAL', label: 'تشغيلي' }, { id: 'TEXT', label: 'نص المذيع' }] as const).map(item => <label key={item.id} className="inline-flex items-center gap-2 min-h-11 cursor-pointer"><input type="radio" name={name} value={item.id} checked={mode === item.id} onChange={() => onChange(item.id)} />{item.label}</label>)}
  </fieldset>;
}
