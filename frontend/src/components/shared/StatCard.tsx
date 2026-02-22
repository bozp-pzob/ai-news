import React from 'react';

export type StatCardColor = 'default' | 'muted' | 'amber' | 'blue' | 'purple' | 'red' | 'green';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Color theme for the value and icon. Defaults to 'default' (white value). */
  color?: StatCardColor;
  /** Optional trend indicator (positive = amber, negative = red) */
  trend?: { value: number; label: string };
}

const VALUE_COLORS: Record<StatCardColor, string> = {
  default: 'text-white',
  muted: 'text-stone-400',
  amber: 'text-amber-400',
  blue: 'text-blue-400',
  purple: 'text-purple-400',
  red: 'text-red-400',
  green: 'text-green-400',
};

const ICON_COLORS: Record<StatCardColor, string> = {
  default: 'text-stone-500',
  muted: 'text-stone-400',
  amber: 'text-amber-400',
  blue: 'text-blue-400',
  purple: 'text-purple-400',
  red: 'text-red-400',
  green: 'text-green-400',
};

/**
 * Reusable stat card for dashboard-style metrics.
 * Used on DashboardPage, AdminPage, and ConfigPage.
 */
export const StatCard: React.FC<StatCardProps> = React.memo(({
  title,
  value,
  subtitle,
  icon,
  color = 'default',
  trend,
}) => {
  return (
    <div className="bg-stone-800 rounded-lg p-5 border border-stone-700">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-stone-400 text-sm font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${VALUE_COLORS[color]}`}>{value}</p>
          {subtitle && (
            <p className="text-stone-500 text-xs mt-1">{subtitle}</p>
          )}
          {trend && (
            <p className={`text-xs mt-2 ${trend.value >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </p>
          )}
        </div>
        {icon && (
          <div className={ICON_COLORS[color]}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
});

StatCard.displayName = 'StatCard';
