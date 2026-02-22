import React, { useState, useEffect } from 'react';
import { configApi, SummaryItem } from '../../services/api';
import { PreviewPaywall } from './PreviewPaywall';

interface ContentTabProps {
  configId: string;
  authToken: string | null;
}

/**
 * Content tab showing a paginated, expandable list of generated content (summaries/reports).
 * Works for both authenticated owners and unauthenticated public viewers.
 * For monetized configs, shows a preview with a paywall banner.
 */
export function ContentTab({ configId, authToken }: ContentTabProps) {
  const [entries, setEntries] = useState<SummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, limit: 10, offset: 0, hasMore: false });
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ preview: boolean; previewLimit: number; payment: any } | null>(null);

  const loadContent = async (offset = 0) => {
    setIsLoading(true);
    try {
      const result = await configApi.getContent(authToken, configId, {
        limit: 10,
        offset,
      });
      setEntries(result.content);
      setPagination(result.pagination);
      // Check for preview mode in response
      const r = result as any;
      if (r.preview) {
        setPreview({ preview: true, previewLimit: r.previewLimit, payment: r.payment });
      } else {
        setPreview(null);
      }
    } catch (err) {
      console.error('Error loading content:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadContent(0);
  }, [configId, authToken]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (isLoading && entries.length === 0) {
    return <div className="text-center py-8 text-stone-400">Loading content...</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-stone-400">
        No content found. Run aggregation to generate content.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-stone-400 text-sm">
        {pagination.total.toLocaleString()} total entries{preview ? ' — showing preview' : ''}
      </div>

      {/* Content List */}
      <div className="space-y-4">
        {entries.map((entry) => (
          <div key={entry.id} className="bg-stone-800 rounded-lg border border-stone-700 overflow-hidden">
            <div 
              className="p-4 cursor-pointer flex items-center justify-between"
              onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-amber-900/50 rounded text-xs text-amber-400">
                    {entry.type}
                  </span>
                </div>
                <p className="text-white font-medium">
                  {entry.title || formatDate(entry.date)}
                </p>
                <p className="text-stone-500 text-xs mt-1">
                  Created: {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
              <svg 
                className={`w-5 h-5 text-stone-400 transition-transform ${expandedEntry === entry.id ? 'rotate-180' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            
            {/* Expanded Content */}
            {expandedEntry === entry.id && (
              <div className="px-4 pb-4 border-t border-stone-700 pt-4">
                {entry.markdown ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-stone-300 text-sm bg-stone-900 p-4 rounded-lg overflow-auto max-h-96">
                      {entry.markdown}
                    </pre>
                  </div>
                ) : entry.categories ? (
                  <div>
                    <p className="text-stone-400 text-xs mb-2">Categories</p>
                    <pre className="text-stone-400 text-xs bg-stone-900 p-4 rounded-lg overflow-auto max-h-96">
                      {typeof entry.categories === 'string' 
                        ? entry.categories 
                        : JSON.stringify(entry.categories, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-stone-500">No content available</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Preview paywall or pagination */}
      {preview ? (
        <PreviewPaywall
          configId={configId}
          contentType="content"
          total={pagination.total}
          previewLimit={preview.previewLimit}
          payment={preview.payment}
          onAccessGranted={() => loadContent(0)}
        />
      ) : (
        <div className="flex items-center justify-between">
          <button
            onClick={() => loadContent(pagination.offset - pagination.limit)}
            disabled={pagination.offset === 0}
            className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-600 text-white rounded-lg text-sm transition-colors"
          >
            Previous
          </button>
          <span className="text-stone-400 text-sm">
            Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <button
            onClick={() => loadContent(pagination.offset + pagination.limit)}
            disabled={!pagination.hasMore}
            className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-600 text-white rounded-lg text-sm transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
