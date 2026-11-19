/**
 * One way to write a duration across the programme screens:
 *   - a segment (or a topic of segments) as a clock, «03:30» (mm:ss; «1:02:05» past an hour);
 *   - a programme total, a slot or a gap in minutes, «34 د» («33 د 30 ث» when not a whole minute).
 * Neither form needs dir="ltr": a clock is digits only, and «34 د من 50 د» reads correctly in RTL.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const whole = (seconds: number) => Math.round(Math.abs(Number(seconds) || 0));

/** Segment length as a clock: 210 → «03:30», 3725 → «1:02:05». Always positive. */
export function segmentClock(seconds: number): string {
  const s = whole(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Programme totals in minutes: 2040 → «34 د», 2010 → «33 د 30 ث», 0 → «0 د». Always positive. */
export function minutesLabel(seconds: number): string {
  const s = whole(seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (!rest) return `${m} د`;
  return m ? `${m} د ${rest} ث` : `${rest} ث`;
}

/** «34 د من 50 د» — planned against the slot. */
export function minutesOf(part: number, total: number): string {
  return `${minutesLabel(part)} من ${minutesLabel(total)}`;
}

/** How a plan compares with its slot, in words (no signs that flip in RTL). */
export function minutesGap(planned: number, slot: number): { state: 'EXACT' | 'OVER' | 'SHORT'; text: string } {
  const gap = Math.round((Number(planned) || 0) - (Number(slot) || 0));
  if (gap === 0) return { state: 'EXACT', text: 'مطابق للمدة' };
  return gap > 0 ? { state: 'OVER', text: `يزيد ${minutesLabel(gap)}` } : { state: 'SHORT', text: `ينقص ${minutesLabel(gap)}` };
}
