import React from 'react';
import { TimeRange } from '../../services/api';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

/**
 * Time range selector with preset options.
 */
export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  const ranges: { value: TimeRange; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
    { value: 'all', label: 'All Time' },
  ];

  return (
    <div className="flex gap-1 bg-stone-800 rounded-lg p-1">
      {ranges.map(range => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            value === range.value
              ? 'bg-stone-700 text-white'
              : 'text-stone-400 hover:text-white'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
