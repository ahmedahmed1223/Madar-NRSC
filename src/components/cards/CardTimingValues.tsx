import { cardExecutionTiming } from '../../shared/cardExecutionTiming';
import type { ProductionCard } from '../../shared/productionCards';
import { minutesLabel } from '../../shared/workload';

function duration(minutes: number | null) {
  if (minutes === null) return 'غير مسجل';
  if (minutes === 0) return '0 د';
  if (minutes > 0 && minutes < 1) return 'أقل من دقيقة';
  return minutesLabel(Math.floor(minutes));
}

export function CardTimingValues({ card, now }: { card: ProductionCard; now: number }) {
  const { laborMinutes, elapsedMinutes, waitingMinutes } = cardExecutionTiming(card, now);
  return <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
    <span>العمل المسجل <strong className="tabular-nums">{duration(laborMinutes)}</strong></span>
    <span>الزمن منذ البدء <strong className="tabular-nums">{duration(elapsedMinutes)}</strong></span>
    <span>الانتظار المرصود <strong className="tabular-nums">{duration(waitingMinutes)}</strong></span>
  </span>;
}
