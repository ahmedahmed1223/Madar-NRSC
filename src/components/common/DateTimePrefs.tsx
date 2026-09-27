import React, { useEffect, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import {
  DEFAULT_DATE_SETTINGS,
  DateTimeSettings,
  appLocale,
  formatDay,
  getDateSettings,
  onDateFormat,
  sanitizeDateSettings,
  validZone,
} from '../../shared/dateFormat';
import { apiService } from '../../services/api';
import { confirmSaved } from '../../services/confirmSave';
import { SINGLETON_ID } from '../../shared/collections';

type Option<V> = { value: V; label: string; hint?: string };

function Choice<K extends keyof DateTimeSettings>({
  field,
  title,
  options,
  draft,
  onPick,
  disabled,
}: {
  field: K;
  title: string;
  options: Option<DateTimeSettings[K]>[];
  draft: DateTimeSettings;
  onPick: (patch: Partial<DateTimeSettings>) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-xs font-bold text-slate-700 mb-1">{title}</legend>
      <div role="radiogroup" aria-label={title} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = draft[field] === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick({ [field]: o.value } as Partial<DateTimeSettings>)}
              className={`px-3 py-1.5 rounded-xl border text-xs text-right disabled:opacity-60 ${
                on ? 'border-blue-500 bg-blue-50 text-blue-800 font-bold ring-1 ring-blue-200' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="block">{o.label}</span>
              {o.hint && <span className="block text-[10px] font-normal text-slate-500 tabular-nums">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * «التاريخ والوقت» for the whole station: digits, calendar, clock, date style and whether
 * everyone works in the station's time zone. Saved on the server; applies to every colleague.
 */
export const StationDateTimeSettings: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const settings = apiService.getSettings() as any;
  const [draft, setDraft] = useState<DateTimeSettings>(() => sanitizeDateSettings(settings?.dateTime));
  const [now, setNow] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  useEffect(() => onDateFormat(() => setDraft(getDateSettings())), []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const zone = validZone(settings?.defaultTimezone);
  const pick = (patch: Partial<DateTimeSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const time = (p: DateTimeSettings, withSeconds = p.clockSeconds) =>
    now.toLocaleTimeString(appLocale(p), {
      ...(p.timeBasis === 'station' && zone ? { timeZone: zone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
    });
  const day = (p: DateTimeSettings) =>
    now.toLocaleDateString(appLocale(p), {
      ...(p.timeBasis === 'station' && zone ? { timeZone: zone } : {}),
      weekday: 'long',
      ...(p.dateStyle === 'numeric' ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' }),
    });
  const dirty = JSON.stringify(draft) !== JSON.stringify(sanitizeDateSettings(settings?.dateTime));

  const save = async () => {
    setSaving(true);
    try {
      apiService.saveSettings({ dateTime: draft } as any);
      await confirmSaved('settings', SINGLETON_ID, 'حُفظت إعدادات التاريخ والوقت وتُطبَّق على كل الزملاء');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200" aria-live="polite">
        <p className="text-[11px] font-bold text-slate-500 mb-1">معاينة كما سيراها الجميع</p>
        <p className="text-lg font-black text-slate-900 tabular-nums">{time(draft)}</p>
        <p className="text-sm font-bold text-slate-700">{day(draft)}</p>
        <p className="text-xs text-slate-500 tabular-nums mt-0.5">
          آخر تحديث: {now.toLocaleString(appLocale(draft), { ...(draft.timeBasis === 'station' && zone ? { timeZone: zone } : {}), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      <Choice
        field="timeBasis"
        title="التوقيت المعتمد"
        draft={draft}
        onPick={pick}
        disabled={!canEdit}
        options={[
          { value: 'station', label: 'توقيت المحطة الموحد', hint: zone ? `كل الأجهزة تعرض وتُدخل الأوقات بتوقيت ${zone}` : 'حدد المنطقة الزمنية للمحطة أولاً' },
          { value: 'device', label: 'توقيت جهاز كل زميل', hint: 'مع تنبيه عند اختلافه عن المحطة' },
        ]}
      />
      <Choice
        field="calendar"
        title="التقويم"
        draft={draft}
        onPick={pick}
        disabled={!canEdit}
        options={[
          { value: 'gregory', label: 'ميلادي', hint: formatDay(now, { ...draft, calendar: 'gregory' }) },
          { value: 'islamic-umalqura', label: 'هجري (أم القرى)', hint: formatDay(now, { ...draft, calendar: 'islamic-umalqura' }) },
        ]}
      />
      <Choice
        field="dateStyle"
        title="صيغة التاريخ"
        draft={draft}
        onPick={pick}
        disabled={!canEdit}
        options={[
          { value: 'long', label: 'اسم الشهر', hint: formatDay(now, { ...draft, dateStyle: 'long' }) },
          { value: 'numeric', label: 'أرقام', hint: formatDay(now, { ...draft, dateStyle: 'numeric' }) },
        ]}
      />
      <Choice
        field="hourCycle"
        title="نظام الساعة"
        draft={draft}
        onPick={pick}
        disabled={!canEdit}
        options={[
          { value: 'h23', label: '24 ساعة', hint: time({ ...draft, hourCycle: 'h23' }, false) },
          { value: 'h12', label: '12 ساعة (ص/م)', hint: time({ ...draft, hourCycle: 'h12' }, false) },
        ]}
      />
      <Choice
        field="digits"
        title="الأرقام"
        draft={draft}
        onPick={pick}
        disabled={!canEdit}
        options={[
          { value: 'latn', label: 'لاتينية', hint: '0123456789' },
          { value: 'arab', label: 'عربية مشرقية', hint: '٠١٢٣٤٥٦٧٨٩' },
        ]}
      />
      <Choice
        field="clockSeconds"
        title="الثواني في الساعة"
        draft={draft}
        onPick={pick}
        disabled={!canEdit}
        options={[
          { value: true, label: 'إظهار الثواني' },
          { value: false, label: 'ساعات ودقائق فقط' },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
          إعداد مركزي للمحطة: يُطبَّق على كل الزملاء والشاشات والطباعة. المنطقة الزمنية للمحطة تُضبط في «المؤسسة والفريق».
          {!canEdit && ' يعدّله مدير النظام فقط.'}
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft({ ...DEFAULT_DATE_SETTINGS })}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="w-3.5 h-3.5" /> الافتراضي
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={save}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> حفظ للجميع
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
