import React, { useState, useEffect } from 'react';
import { configApi, ContentItem } from '../../services/api';
import { PreviewPaywall } from './PreviewPaywall';

interface ItemsTabProps {
  configId: string;
  authToken: string | null;
}

/**
 * Items tab showing a filterable, paginated, expandable list of content items.
 * Works for both authenticated owners and unauthenticated public viewers.
 * For monetized configs, shows a preview with a paywall banner.
 */
export function ItemsTab({ configId, authToken }: ItemsTabProps) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, limit: 20, offset: 0, hasMore: false });
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ preview: boolean; previewLimit: number; payment: any } | null>(null);

  const loadItems = async (offset = 0) => {
    setIsLoading(true);
    try {
      const result = await configApi.getItems(authToken, configId, {
        limit: 20,
        offset,
        source: sourceFilter || undefined,
        type: typeFilter || undefined,
      });
      setItems(result.items);
      setPagination(result.pagination);
      // Check for preview mode in response
      const r = result as any;
      if (r.preview) {
        setPreview({ preview: true, previewLimit: r.previewLimit, payment: r.payment });
      } else {
        setPreview(null);
      }
    } catch (err) {
      console.error('Error loading items:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems(0);
  }, [configId, authToken, sourceFilter, typeFilter]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (isLoading && items.length === 0) {
    return <div className="text-center py-8 text-stone-400">Loading items...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-stone-400">
        No items found. Run aggregation to collect data.
      </div>
    );
  }

  // Get unique sources and types for filters
  const sources = Array.from(new Set(items.map(i => i.source)));
  const types = Array.from(new Set(items.map(i => i.type)));

  return (
    <div className="space-y-4">
      {/* Filters — hidden in preview mode since you can't paginate/filter */}
      {!preview && (
        <div className="flex gap-4 flex-wrap">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All Sources</option>
            {sources.map(source => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All Types</option>
            {types.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <div className="text-stone-400 text-sm flex items-center">
            {pagination.total.toLocaleString()} total items
          </div>
        </div>
      )}

      {/* Preview header */}
      {preview && (
        <div className="text-stone-400 text-sm">
          {pagination.total.toLocaleString()} total items — showing preview
        </div>
      )}

      {/* Items List */}
      <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
        <div className="divide-y divide-stone-200">
          {items.map((item) => (
            <div key={item.id} className="p-4">
              <div 
                className="flex items-start justify-between cursor-pointer"
                onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-stone-100 rounded text-xs text-stone-600">
                      {item.type}
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-50 rounded text-xs text-emerald-700">
                      {item.source}
                    </span>
                  </div>
                  <p className="text-stone-800 font-medium truncate">
                    {item.title || item.text?.slice(0, 100) || 'No content'}
                  </p>
                  <p className="text-stone-500 text-xs mt-1">
                    {formatDate(item.date)}
                  </p>
                </div>
                <svg 
                  className={`w-5 h-5 text-stone-400 transition-transform ${expandedItem === item.id ? 'rotate-180' : ''}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              
              {/* Expanded Content */}
              {expandedItem === item.id && (
                <div className="mt-4 pt-4 border-t border-stone-200">
                  {item.text && (
                    <div className="mb-3">
                      <p className="text-stone-400 text-xs mb-1">Content</p>
                      <p className="text-stone-600 text-sm whitespace-pre-wrap">{item.text}</p>
                    </div>
                  )}
                  {item.topics && item.topics.length > 0 && (
                    <div className="mb-3">
                      <p className="text-stone-400 text-xs mb-1">Topics</p>
                      <div className="flex flex-wrap gap-1">
                        {item.topics.map((topic, i) => (
                          <span key={i} className="px-2 py-0.5 bg-stone-100 rounded-full text-xs text-stone-600">
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {item.link && (
                    <div className="mb-3">
                      <p className="text-stone-400 text-xs mb-1">Link</p>
                      <a 
                        href={item.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-emerald-600 hover:text-emerald-700 text-sm break-all"
                      >
                        {item.link}
                      </a>
                    </div>
                  )}
                  {item.metadata && (
                    <div>
                      <p className="text-stone-400 text-xs mb-1">Metadata</p>
                      <pre className="text-stone-600 text-xs bg-stone-50 p-2 rounded overflow-auto max-h-40">
                        {JSON.stringify(item.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Preview paywall or pagination */}
      {preview ? (
        <PreviewPaywall
          configId={configId}
          contentType="items"
          total={pagination.total}
          previewLimit={preview.previewLimit}
          payment={preview.payment}
          onAccessGranted={() => loadItems(0)}
        />
      ) : (
        <div className="flex items-center justify-between">
          <button
            onClick={() => loadItems(pagination.offset - pagination.limit)}
            disabled={pagination.offset === 0}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 disabled:bg-stone-50 disabled:text-stone-400 text-stone-800 rounded-lg text-sm transition-colors"
          >
            Previous
          </button>
          <span className="text-stone-400 text-sm">
            Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <button
            onClick={() => loadItems(pagination.offset + pagination.limit)}
            disabled={!pagination.hasMore}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 disabled:bg-stone-50 disabled:text-stone-400 text-stone-800 rounded-lg text-sm transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
