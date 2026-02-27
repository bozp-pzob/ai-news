/**
 * RSS Feed configuration component for the graph UI.
 * 
 * Renders a dynamic list of RSS feed entries, each with:
 * - Feed URL (required)
 * - Cookie URL (optional, for auth-protected feeds)
 * - Content type (optional, defaults to "rss")
 * - TypeScript schema for AI extraction (optional, collapsible)
 * - Topics to exclude (optional, collapsible)
 * 
 * Used by PluginParamDialog when configuring an RSSSource node.
 */

import React, { useState } from 'react';

interface RSSFeed {
  url: string;
  cookieUrl?: string;
  type?: string;
  objectTypeString?: string;
  excludeTopics?: string;
}

interface RSSFeedConfigProps {
  feeds: RSSFeed[];
  onChange: (feeds: RSSFeed[]) => void;
}

export const RSSFeedConfig: React.FC<RSSFeedConfigProps> = ({ feeds, onChange }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleAddFeed = () => {
    onChange([...feeds, { url: '' }]);
    setExpandedIndex(feeds.length);
  };

  const handleRemoveFeed = (index: number) => {
    const updated = feeds.filter((_, i) => i !== index);
    onChange(updated);
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const handleUpdateFeed = (index: number, field: keyof RSSFeed, value: string) => {
    const updated = [...feeds];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const inputClasses = "p-2 w-full rounded-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 text-sm";

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-stone-600 mb-2">
        RSS Feeds
        <span className="text-red-500 ml-1">*</span>
      </label>

      <div className="space-y-3">
        {feeds.map((feed, index) => (
          <div
            key={index}
            className="border border-stone-200 rounded-lg overflow-hidden"
          >
            {/* Feed header row */}
            <div className="flex items-center gap-2 p-3 bg-stone-50">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={feed.url}
                  onChange={(e) => handleUpdateFeed(index, 'url', e.target.value)}
                  className={inputClasses}
                  placeholder="https://example.com/feed.xml"
                />
              </div>

              {/* Expand/collapse button */}
              <button
                type="button"
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                className="p-1.5 text-stone-400 hover:text-stone-600 rounded focus:outline-none"
                title={expandedIndex === index ? 'Collapse options' : 'Expand options'}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${expandedIndex === index ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => handleRemoveFeed(index)}
                className="p-1.5 text-red-400 hover:text-red-600 rounded focus:outline-none"
                title="Remove feed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Expanded options */}
            {expandedIndex === index && (
              <div className="p-3 space-y-3 border-t border-stone-200">
                {/* Cookie URL */}
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">
                    Cookie URL
                  </label>
                  <input
                    type="text"
                    value={feed.cookieUrl || ''}
                    onChange={(e) => handleUpdateFeed(index, 'cookieUrl', e.target.value)}
                    className={inputClasses}
                    placeholder="URL to visit for cookie capture (for auth-protected feeds)"
                  />
                </div>

                {/* Content type */}
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">
                    Content Type
                  </label>
                  <input
                    type="text"
                    value={feed.type || ''}
                    onChange={(e) => handleUpdateFeed(index, 'type', e.target.value)}
                    className={inputClasses}
                    placeholder="Content type identifier (default: rss)"
                  />
                </div>

                {/* Object type string (for AI extraction) */}
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">
                    TypeScript Schema (for AI extraction)
                  </label>
                  <textarea
                    value={feed.objectTypeString || ''}
                    onChange={(e) => handleUpdateFeed(index, 'objectTypeString', e.target.value)}
                    className={`${inputClasses} min-h-[60px] font-mono text-xs`}
                    placeholder={'interface Article {\n  title: string;\n  author: string;\n  summary: string;\n}'}
                    rows={3}
                  />
                </div>

                {/* Exclude topics */}
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">
                    Exclude Topics
                  </label>
                  <input
                    type="text"
                    value={feed.excludeTopics || ''}
                    onChange={(e) => handleUpdateFeed(index, 'excludeTopics', e.target.value)}
                    className={inputClasses}
                    placeholder="Comma-separated topics to exclude"
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add feed button */}
        <button
          type="button"
          onClick={handleAddFeed}
          className="w-full px-3 py-2 text-sm text-emerald-600 hover:text-emerald-500 border border-dashed border-emerald-300 hover:border-emerald-400 rounded-lg focus:outline-none transition-colors"
        >
          + Add Feed
        </button>
      </div>

      <p className="mt-2 text-xs text-stone-400">
        Add RSS or Atom feed URLs. Expand each feed for advanced options like cookie capture and AI extraction schema.
      </p>
    </div>
  );
};
