import React from 'react';
import { ChevronLeft, Home, ArrowRight } from 'lucide-react';
import { Badge } from '../common/Badge';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  statusBadge?: {
    label: string;
    variant: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  };
  onBack?: () => void;
  backLabel?: string;
  actions?: React.ReactNode;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  statusBadge,
  onBack,
  backLabel = 'رجوع',
  actions,
}) => {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white border border-slate-200/80 px-4 py-2.5 rounded-2xl shadow-2xs mb-4">
      {/* Navigation Breadcrumb Trail */}
      <div className="flex items-center flex-wrap gap-2 text-xs">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold rounded-lg transition-colors cursor-pointer border border-slate-200"
            title="العودة للشاشة السابقة"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>{backLabel}</span>
          </button>
        )}

        <div className="flex items-center gap-1.5 text-slate-500">
          <Home className="w-3.5 h-3.5 text-slate-500" />
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <React.Fragment key={index}>
                <ChevronLeft className="w-3.5 h-3.5 text-slate-300 rtl:rotate-180" />
                {isLast ? (
                  <span className="font-bold text-slate-900 truncate max-w-[200px] sm:max-w-xs flex items-center gap-1">
                    {item.icon}
                    {item.label}
                  </span>
                ) : item.onClick ? (
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="hover:text-blue-600 transition-colors font-medium cursor-pointer flex items-center gap-1"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ) : (
                  <span className="font-medium flex items-center gap-1">
                    {item.icon}
                    {item.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {statusBadge && (
          <Badge variant={statusBadge.variant} className="mr-1">
            {statusBadge.label}
          </Badge>
        )}
      </div>

      {/* Optional action buttons on the left (RTL) */}
      {actions && <div className="flex items-center gap-2 self-end sm:self-auto">{actions}</div>}
    </div>
  );
};
