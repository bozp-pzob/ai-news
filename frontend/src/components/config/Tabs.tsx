import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  /** When true, shows a lock icon next to the label (e.g. for monetized data) */
  locked?: boolean;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
}

/**
 * Generic tab navigation bar.
 */
export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 p-1 bg-stone-800 rounded-lg">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === tab.id
              ? 'bg-stone-700 text-white'
              : 'text-stone-400 hover:text-white'
          }`}
        >
          {tab.label}
          {tab.locked && (
            <svg className="w-3.5 h-3.5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
