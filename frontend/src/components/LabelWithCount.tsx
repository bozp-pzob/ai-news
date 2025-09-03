import React from 'react';

interface LabelWithCountProps {
  label: string;
  count: number;
  colorClass?: string;
  labelClassName?: string;
  countClassName?: string;
  title?: string;
}

export const LabelWithCount: React.FC<LabelWithCountProps> = ({
  label,
  count,
  colorClass = 'bg-stone-500',
  labelClassName = '',
  countClassName = '',
  title,
}) => {
  return (
    <div 
      className={`${colorClass} inline-flex items-center bg-muted/10 rounded-full overflow-hidden hover:bg-muted/15 transition-colors`}
      title={title}
    >
      <div className={`py-1 p-2 text-xs font-medium ${labelClassName}`}>
        {label}
      </div>
      <span className={`${colorClass ? colorClass.replace('bg-', 'bg-') + '-200' : 'bg-stone-700'} py-1 pl-2 pr-3 font-mono font-semibold text-xs ${countClassName}`}>
        {count}
      </span>
    </div>
  );
};

// Preview component for demonstration
export const LabelWithCountPreview: React.FC = () => {
  const examples = [
    { label: 'Reddit', count: 85 },
    { label: 'Hacker News', count: 42 },
    { label: 'Product Hunt', count: 19 },
    { label: 'GitHub', count: 63 },
  ];

  return (
    <div className="space-y-2 max-w-xs">
      <h3 className="text-sm font-medium mb-2">Label With Count Examples</h3>
      <div className="flex flex-wrap gap-2">
        {examples.map((example, index) => (
          <LabelWithCount 
            key={index}
            label={example.label}
            count={example.count}
          />
        ))}
      </div>
    </div>
  );
}; 