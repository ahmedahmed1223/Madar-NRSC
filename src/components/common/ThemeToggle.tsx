import React, { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun, Waves } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { reducedMotion, setReducedMotion, setTextScale, TEXT_SCALES, textScale, type ThemePreference } from '../../services/theme';

const OPTIONS: { id: ThemePreference; label: string; hint: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'نهاري', hint: 'خلفية فاتحة', icon: Sun },
  { id: 'dark', label: 'ليلي', hint: 'مريح في الاستوديو والمناوبات الليلية', icon: Moon },
  { id: 'system', label: 'حسب الجهاز', hint: 'يتبع إعداد النظام تلقائياً', icon: Monitor },
];

/** Day, night, or follow the device (remembered on this device). */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { mode, preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const [calm, setCalm] = useState(reducedMotion);
  const [scale, setScale] = useState(textScale);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const label = `المظهر: ${OPTIONS.find((o) => o.id === preference)?.label}`;
  return (
    <div ref={ref} className={`relative ${className}`} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
      >
        {mode === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="المظهر" className="theme-options absolute top-full mt-2 left-0 z-50 w-60 bg-white border border-slate-200 rounded-2xl shadow-xl p-1.5 text-right" onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            button.current?.focus();
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const step = event.key === 'ArrowUp' ? -1 : 1;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
          event.preventDefault();
          items[next]?.focus();
        }}>
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = preference === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setPreference(o.id);
                  setOpen(false);
                  button.current?.focus();
                }}
                className={`w-full min-h-[44px] flex items-center gap-2.5 p-2 rounded-xl text-right ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-500'}`} />
                <span className="flex-1 min-w-0">
                  <span className={`block text-xs font-bold ${active ? 'text-blue-700' : 'text-slate-700'}`}>{o.label}</span>
                  <span className="block text-2xs text-slate-500">{o.hint}</span>
                </span>
                {active && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
              </button>
            );
          })}
          <div className="border-t border-slate-100 mt-1 pt-1">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={calm}
              onClick={() => {
                setReducedMotion(!calm);
                setCalm(!calm);
              }}
              className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-right ${calm ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
            >
              <Waves className={`w-4 h-4 shrink-0 ${calm ? 'text-blue-600' : 'text-slate-500'}`} />
              <span className="flex-1 min-w-0">
                <span className={`block text-xs font-bold ${calm ? 'text-blue-700' : 'text-slate-700'}`}>تقليل الحركة</span>
                <span className="block text-2xs text-slate-500">إيقاف الوميض والنبض والانتقالات المتحركة</span>
              </span>
              {calm && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
            </button>
          </div>
          <div className="border-t border-slate-100 mt-1 pt-2 px-2 pb-1" role="group" aria-label="حجم الخط">
            <span className="block text-xs font-bold text-slate-700 mb-1.5">حجم الخط</span>
            <div className="grid grid-cols-4 gap-1">
              {TEXT_SCALES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={scale === option.id}
                  title={option.hint}
                  onClick={() => {
                    setTextScale(option.id);
                    setScale(option.id);
                  }}
                  className={`min-h-9 rounded-lg border text-2xs font-bold ${scale === option.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
