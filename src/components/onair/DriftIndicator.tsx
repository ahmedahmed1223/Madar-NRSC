import React from 'react';
import { formatClock } from '../../shared/onair';
import { driftStatus, type DriftLevel } from '../../shared/stationTime';

/** Solid fills that keep their contrast on the black studio wall and the dark on-air panel. */
const TONE: Record<DriftLevel, string> = {
  ok: 'bg-emerald-500 text-black',
  warn: 'bg-amber-400 text-black',
  alert: 'bg-red-600 text-white',
};

/** A glyph next to the words, so the state never rests on colour alone. */
const GLYPH: Record<string, string> = { ON_TIME: '●', AHEAD: '▲', BEHIND: '▼' };

/**
 * «متأخر 01:43» / «متقدم 00:40» / «في الموعد» for the director: large, coloured and worded.
 * `panel` sits in the on-air control panel; `wall` fills a 1920×1080 studio display.
 */
export const DriftIndicator: React.FC<{ drift: number; size?: 'panel' | 'wall'; className?: string }> = ({ drift, size = 'panel', className = '' }) => {
  const st = driftStatus(drift);
  const amount = st.amount ? formatClock(st.amount) : '';
  const big = size === 'wall';
  return (
    <div
      role="status"
      aria-live="off"
      aria-label={`التوقيت: ${st.label}${amount ? ` ${amount}` : ''}`}
      data-drift={st.kind}
      className={`theme-fixed inline-flex items-center justify-center gap-3 rounded-2xl font-black leading-none ${TONE[st.level]} ${
        big ? 'px-8 py-5 text-5xl xl:text-7xl' : 'px-5 py-3 text-2xl sm:text-3xl'
      } ${className}`}
    >
      <span aria-hidden="true" className={big ? 'text-4xl xl:text-5xl' : 'text-xl'}>
        {GLYPH[st.kind]}
      </span>
      <span>{st.label}</span>
      {amount && <span className="tabular-nums">{amount}</span>}
    </div>
  );
};
