import React from 'react';
import { ProductionNameField } from '../common/ProductionNameField';
import { EPISODE_DURATION_PRESETS, episodeEndTime, episodeEndsNextDay, type EpisodeDetailsValues } from './episodeDetails';

interface EpisodeDetailsFieldsProps {
  values: EpisodeDetailsValues;
  onChange: (patch: Partial<EpisodeDetailsValues>) => void;
  /** Prefix for the inputs' ids (each form on screen needs its own). */
  idPrefix?: string;
  /** Shown beside the title (the program picker when creating). */
  programField?: React.ReactNode;
  disabled?: boolean;
}

const inputClass =
  'w-full min-h-11 px-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500';
const labelClass = 'block text-xs font-bold text-slate-700 mb-1';

/** The episode's title, numbering, air slot and crew: one set of fields for creating and editing. */
export const EpisodeDetailsFields: React.FC<EpisodeDetailsFieldsProps> = ({ values, onChange, idPrefix = 'episode', programField, disabled }) => {
  const id = (name: string) => `${idPrefix}-${name}`;
  const endTime = episodeEndTime(values.startTime, values.durationMinutes);
  const nextDay = episodeEndsNextDay(values.startTime, values.durationMinutes);
  return (
    <fieldset disabled={disabled} className="space-y-4 min-w-0">
      <div className={`grid grid-cols-1 ${programField ? 'sm:grid-cols-2' : ''} gap-3`}>
        {programField}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={id('title-input')} className="block text-xs font-bold text-slate-700">عنوان موضوع الحلقة *</label>
            {values.title && !disabled && (
              <button type="button" onClick={() => onChange({ title: '' })} className="text-2xs text-slate-500 hover:text-slate-800">
                مسح
              </button>
            )}
          </div>
          <input
            id={id('title-input')}
            type="text"
            required
            value={values.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="مثال: مستقبل الطاقة المتجددة في الشرق الأوسط"
            className={`${inputClass} font-bold`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label htmlFor={id('number-input')} className={labelClass}>رقم الحلقة</label>
          <input id={id('number-input')} type="number" min="1" inputMode="numeric" value={values.episodeNumber}
            onChange={(e) => onChange({ episodeNumber: Number(e.target.value) })} className={`${inputClass} font-mono text-center`} />
        </div>
        <div>
          <label htmlFor={id('season-input')} className={labelClass}>الموسم</label>
          <input id={id('season-input')} type="number" min="1" inputMode="numeric" value={values.seasonNumber}
            onChange={(e) => onChange({ seasonNumber: Number(e.target.value) })} className={`${inputClass} font-mono text-center`} />
        </div>
        <div>
          <label htmlFor={id('start-time-input')} className={labelClass}>وقت البدء</label>
          <input id={id('start-time-input')} type="time" required value={values.startTime}
            onChange={(e) => onChange({ startTime: e.target.value })} className={`${inputClass} font-mono text-center`} />
        </div>
        <div>
          <label htmlFor={id('duration-input')} className={labelClass}>المدة (دقيقة)</label>
          <input id={id('duration-input')} type="number" min="1" max="480" inputMode="numeric" value={values.durationMinutes}
            onChange={(e) => onChange({ durationMinutes: Number(e.target.value) })} className={`${inputClass} font-mono text-center`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="مدد شائعة">
          <span className="text-2xs text-slate-600 font-bold">مدد شائعة:</span>
          {EPISODE_DURATION_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={values.durationMinutes === m}
              aria-label={`${m} دقيقة`}
              onClick={() => onChange({ durationMinutes: m })}
              className={`min-h-11 min-w-11 px-2 text-2xs rounded-lg tabular-nums ${
                values.durationMinutes === m ? 'bg-blue-600 text-white font-bold' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {m} د
            </button>
          ))}
        </div>
        <p className="text-2xs text-slate-700" aria-live="polite">
          نهاية البث التقديرية: <strong className="font-mono">{endTime || '—'}</strong>
          {nextDay && <span className="text-amber-800 font-bold"> (اليوم التالي)</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('broadcast-date-input')} className={labelClass}>تاريخ البث المقرر</label>
          <input id={id('broadcast-date-input')} type="date" required value={values.broadcastDate}
            onChange={(e) => onChange({ broadcastDate: e.target.value })} className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label htmlFor={id('studio-input')} className={labelClass}>الاستوديو المخصص</label>
          <ProductionNameField kind="STUDIO" label="الاستوديو المخصص" id={id('studio-input')} type="text"
            value={values.studioName} onChange={(v) => onChange({ studioName: v })} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={id('presenter-input')} className={labelClass}>مقدم الحلقة</label>
          <ProductionNameField kind="PRESENTER" label="مقدم الحلقة" id={id('presenter-input')}
            value={values.presenterName} onChange={(v) => onChange({ presenterName: v })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={id('producer-input')} className={labelClass}>منتج الحلقة</label>
          <input id={id('producer-input')} type="text" value={values.producerName}
            onChange={(e) => onChange({ producerName: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={id('director-input')} className={labelClass}>مخرج الحلقة</label>
          <ProductionNameField kind="DIRECTOR" label="مخرج الحلقة" id={id('director-input')}
            value={values.directorName} onChange={(v) => onChange({ directorName: v })} className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor={id('desc-input')} className={labelClass}>مقدمة ووصف الحلقة</label>
        <textarea
          id={id('desc-input')}
          rows={2}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="وصف مختصر لمحاور الحلقة الرئيسية ومسار الحوار..."
          className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50"
        />
      </div>
    </fieldset>
  );
};
