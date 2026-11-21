import { ArrowUpLeft } from 'lucide-react';

interface DashboardMetric {
  label: string;
  period: string;
  value: number;
  note: string;
  tone: string;
  onSelect?: () => void;
}

/** A ruled overview whose columns fit the available workspace, including a collapsed rail. */
export function DashboardMetrics({ label, metrics }: { label: string; metrics: DashboardMetric[] }) {
  if (!metrics.length) return null;
  const columns = metrics.length === 3
    ? '@[21rem]/metrics:grid-cols-2 @[33rem]/metrics:grid-cols-3'
    : metrics.length > 1 ? '@[21rem]/metrics:grid-cols-2 @[43rem]/metrics:grid-cols-4' : '';
  return (
    <section aria-label={label} className="@container/metrics">
      <ul className={`grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 ${metrics.length === 2 ? '@[21rem]/metrics:grid-cols-2' : columns}`}>
        {metrics.map((metric) => {
          const Cell = metric.onSelect ? 'button' : 'div';
          return (
            <li key={metric.label} className={`min-w-0 ${metrics.length === 3 ? 'last:@[21rem]/metrics:col-span-2 last:@[33rem]/metrics:col-span-1' : ''}`}>
              <Cell
                type={metric.onSelect ? 'button' : undefined}
                onClick={metric.onSelect}
                className={`print-text h-full w-full min-w-0 bg-white px-4 py-3 text-start ${metric.onSelect ? 'hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-offset-[-2px]' : ''}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-xs font-semibold text-slate-800">
                    {metric.label} <span className="font-normal text-slate-600">({metric.period})</span>
                  </span>
                  {metric.onSelect && <ArrowUpLeft className="mt-0.5 size-3.5 shrink-0 text-blue-700" aria-hidden="true" />}
                </span>
                <span className={`mt-1 block font-mono text-2xl font-semibold tabular-nums leading-tight ${metric.tone}`}>{metric.value}</span>
                <span className="mt-1 block text-2xs leading-relaxed text-slate-600">{metric.note}</span>
              </Cell>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
