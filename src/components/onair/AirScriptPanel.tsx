import { useEffect, useRef, useState } from 'react';
import { AArrowDown, AArrowUp } from 'lucide-react';
import { plainText } from '../../shared/bulletins';

const sizes = [24, 28, 32, 40, 48];
export function AirScriptPanel({ segmentId, script, live }: { segmentId?: string; script?: string; live: boolean }) {
  const [sizeIndex, setSizeIndex] = useState(2);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [segmentId]);
  const text = plainText(script || '').trim();
  return <section aria-label="نص المذيع على الهواء" className="space-y-3 border-t border-slate-700 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>{live ? 'نص القصة الحالية' : 'معاينة النص قبل البث'}</span>
      <div role="group" aria-label="حجم نص المذيع" className="flex items-center gap-2">
        <button type="button" title="تصغير نص المذيع" aria-label="تصغير نص المذيع" disabled={sizeIndex === 0} onClick={() => setSizeIndex(i => Math.max(0, i - 1))} className="w-11 h-11 inline-flex items-center justify-center border border-slate-600 rounded-lg disabled:opacity-40"><AArrowDown className="w-5 h-5" /></button>
        <span className="w-12 text-center font-mono" dir="ltr">{sizes[sizeIndex]}px</span>
        <button type="button" title="تكبير نص المذيع" aria-label="تكبير نص المذيع" disabled={sizeIndex === sizes.length - 1} onClick={() => setSizeIndex(i => Math.min(sizes.length - 1, i + 1))} className="w-11 h-11 inline-flex items-center justify-center border border-slate-600 rounded-lg disabled:opacity-40"><AArrowUp className="w-5 h-5" /></button>
      </div>
    </div>
    <div ref={ref} tabIndex={0} aria-label="قراءة نص المذيع" dir="rtl" style={{ fontSize: sizes[sizeIndex], overflowWrap: 'anywhere' }} className="max-h-[55vh] overflow-y-auto leading-relaxed whitespace-pre-wrap text-right focus:outline-none focus:ring-2 focus:ring-sky-400 rounded p-1">
      {text || (segmentId ? 'لا يوجد نص قراءة لهذه الفقرة' : 'لا توجد قصة للعرض')}
    </div>
  </section>;
}
