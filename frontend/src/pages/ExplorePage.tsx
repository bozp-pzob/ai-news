// frontend/src/pages/ExplorePage.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { configApi, PlatformConfig } from '../services/api';
import { AppHeader } from '../components/AppHeader';

type SortOption = 'trending' | 'popular' | 'newest' | 'revenue';

const SORT_OPTIONS: { value: SortOption; label: string; description: string }[] = [
  { value: 'trending', label: 'Trending', description: 'Ranked by queries, data volume, and revenue' },
  { value: 'popular', label: 'Most Popular', description: 'Most queried configs' },
  { value: 'newest', label: 'Newest', description: 'Recently created' },
  { value: 'revenue', label: 'Top Revenue', description: 'Highest earning configs' },
];

const PAGE_SIZE = 12;

/**
 * Formats a number with abbreviated suffixes (1.2k, 3.4M)
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return num.toString();
}

/**
 * Formats a date string to a relative time (e.g. "2 hours ago", "3 days ago")
 */
function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ─── Featured Config Card ──────────────────────────────────────────

function FeaturedCard({ config }: { config: PlatformConfig }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/configs/${config.id}`)}
      className="flex-shrink-0 w-72 bg-gradient-to-br from-emerald-50 to-white rounded-xl border border-emerald-200 p-5 hover:border-emerald-300 transition-all hover:shadow-lg hover:shadow-black/5 text-left group"
    >
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 24 24">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span className="text-emerald-600 text-xs font-semibold uppercase tracking-wider">Featured</span>
      </div>
      <h3 className="font-semibold text-stone-800 truncate group-hover:text-emerald-600 transition-colors">
        {config.name}
      </h3>
      {config.description && (
        <p className="text-stone-500 text-sm mt-1.5 line-clamp-2">{config.description}</p>
      )}
      <div className="flex items-center gap-3 mt-4 text-xs text-stone-400">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {formatNumber(config.totalQueries)} queries
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {formatNumber(config.totalItems)} items
        </span>
      </div>
    </button>
  );
}

// ─── Explore Config Card ───────────────────────────────────────────

function ExploreConfigCard({ config }: { config: PlatformConfig }) {
  const navigate = useNavigate();

  const statusColors: Record<string, string> = {
    idle: 'bg-stone-600',
    running: 'bg-emerald-500 animate-pulse',
    error: 'bg-red-500',
    paused: 'bg-yellow-500',
  };

  return (
    <button
      onClick={() => navigate(`/configs/${config.id}`)}
      className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-300 hover:bg-stone-50 transition-all text-left group w-full shadow-sm"
    >
      {/* Header: Name + Status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-stone-800 truncate group-hover:text-emerald-600 transition-colors">
              {config.name}
            </h3>
            {config.status && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[config.status] || statusColors.idle}`} />
            )}
          </div>
          {config.description && (
            <p className="text-stone-500 text-sm mt-1 line-clamp-2">{config.description}</p>
          )}
        </div>
        {config.monetizationEnabled && (
          <span className="flex-shrink-0 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs rounded-md font-medium">
            ${config.pricePerQuery?.toFixed(4)}/q
          </span>
        )}
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-stone-200">
        {/* Queries */}
        <div className="flex items-center gap-1.5 text-sm">
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-stone-800 font-medium">{formatNumber(config.totalQueries)}</span>
          <span className="text-stone-400 text-xs">queries</span>
        </div>

        {/* Items */}
        <div className="flex items-center gap-1.5 text-sm">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-stone-800 font-medium">{formatNumber(config.totalItems)}</span>
          <span className="text-stone-400 text-xs">items</span>
        </div>

        {/* Revenue (only if > 0) */}
        {config.totalRevenue !== undefined && config.totalRevenue > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-emerald-600 font-medium">${config.totalRevenue.toFixed(2)}</span>
          </div>
        )}

        {/* Last Run */}
        <div className="ml-auto text-xs text-stone-400">
          {formatRelativeTime(config.lastRunAt)}
        </div>
      </div>
    </button>
  );
}

// ─── Sort Dropdown ─────────────────────────────────────────────────

function SortDropdown({ value, onChange }: { value: SortOption; onChange: (v: SortOption) => void }) {
  const [open, setOpen] = useState(false);
  const selected = SORT_OPTIONS.find(o => o.value === value)!;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-800 hover:border-stone-400 transition-colors"
      >
        <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        {selected.label}
        <svg className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 mt-1 w-56 bg-white border border-stone-200 rounded-lg shadow-lg z-20 py-1">
            {SORT_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  option.value === value
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'text-stone-800 hover:bg-stone-50'
                }`}
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-xs text-stone-400 mt-0.5">{option.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Search Input ──────────────────────────────────────────────────

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1 max-w-md">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        placeholder="Search configs..."
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full pl-10 pr-4 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/50 transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Skeleton Loader ───────────────────────────────────────────────

function ConfigCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 animate-pulse shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="h-5 bg-stone-200 rounded w-2/3" />
          <div className="h-4 bg-stone-100 rounded w-full mt-2" />
        </div>
      </div>
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-stone-200">
        <div className="h-4 bg-stone-100 rounded w-16" />
        <div className="h-4 bg-stone-100 rounded w-16" />
        <div className="ml-auto h-3 bg-stone-100 rounded w-12" />
      </div>
    </div>
  );
}

function FeaturedCardSkeleton() {
  return (
    <div className="flex-shrink-0 w-72 bg-white rounded-xl border border-stone-200 p-5 animate-pulse shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 bg-stone-200 rounded" />
        <div className="h-3 bg-stone-200 rounded w-16" />
      </div>
      <div className="h-5 bg-stone-200 rounded w-3/4" />
      <div className="h-4 bg-stone-100 rounded w-full mt-2" />
      <div className="flex gap-3 mt-4">
        <div className="h-3 bg-stone-100 rounded w-16" />
        <div className="h-3 bg-stone-100 rounded w-16" />
      </div>
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────

function EmptyState({ search }: { search: string }) {
  return (
    <div className="text-center py-16">
      <svg className="w-16 h-16 mx-auto text-stone-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <h3 className="text-lg font-medium text-stone-800 mb-2">
        {search ? 'No configs found' : 'No public configs yet'}
      </h3>
      <p className="text-stone-500 max-w-sm mx-auto">
        {search
          ? `No configs match "${search}". Try a different search term.`
          : 'Be the first to create a public config and share your data pipeline with the community.'}
      </p>
    </div>
  );
}

// ─── Main Explore Page ─────────────────────────────────────────────

function ExploreContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // State from URL params
  const initialSort = (searchParams.get('sort') as SortOption) || 'trending';
  const initialSearch = searchParams.get('q') || '';
  const initialPage = parseInt(searchParams.get('page') || '1');

  const [sort, setSort] = useState<SortOption>(initialSort);
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [page, setPage] = useState(initialPage);

  // Data state
  const [configs, setConfigs] = useState<PlatformConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Featured configs
  const [featuredConfigs, setFeaturedConfigs] = useState<PlatformConfig[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync state to URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (sort !== 'trending') params.set('sort', sort);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (page > 1) params.set('page', page.toString());
    setSearchParams(params, { replace: true });
  }, [sort, debouncedSearch, page, setSearchParams]);

  // Fetch featured configs (once)
  useEffect(() => {
    async function loadFeatured() {
      try {
        const result = await configApi.listFeatured(6);
        setFeaturedConfigs(result.configs);
      } catch (err) {
        // Non-critical — just don't show featured section
        console.error('Error loading featured configs:', err);
      } finally {
        setFeaturedLoading(false);
      }
    }
    loadFeatured();
  }, []);

  // Fetch public configs
  const loadConfigs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await configApi.listPublic({
        sort,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setConfigs(result.configs);
      setTotal(result.total);
    } catch (err) {
      console.error('Error loading public configs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load configs');
    } finally {
      setIsLoading(false);
    }
  }, [sort, debouncedSearch, page]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800">Explore Configs</h1>
        <p className="text-stone-500 mt-2">
          Discover public data pipelines created by the community. Ranked by usage, data volume, and revenue.
        </p>
      </div>

      {/* Featured Section */}
      {!featuredLoading && featuredConfigs.length > 0 && !debouncedSearch && (
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <h2 className="text-lg font-semibold text-stone-800">Featured</h2>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-thin scrollbar-thumb-stone-300">
            {featuredLoading
              ? Array.from({ length: 3 }).map((_, i) => <FeaturedCardSkeleton key={i} />)
              : featuredConfigs.map(config => (
                  <FeaturedCard key={config.id} config={config} />
                ))}
          </div>
        </div>
      )}

      {/* Search + Sort Controls */}
      <div className="flex items-center gap-3 mb-6">
        <SearchInput value={search} onChange={setSearch} />
        <SortDropdown value={sort} onChange={v => { setSort(v); setPage(1); }} />
      </div>

      {/* Results count */}
      {!isLoading && !error && total > 0 && (
        <p className="text-sm text-stone-400 mb-4">
          {total} config{total !== 1 ? 's' : ''} found
          {debouncedSearch && <> matching "<span className="text-stone-700">{debouncedSearch}</span>"</>}
        </p>
      )}

      {/* Config Grid */}
      {error ? (
        <div className="text-center py-12">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={loadConfigs}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ConfigCardSkeleton key={i} />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <EmptyState search={debouncedSearch} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {configs.map(config => (
            <ExploreConfigCard key={config.id} config={config} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .map((p, idx, arr) => (
                <React.Fragment key={p}>
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="text-stone-400 px-1">...</span>
                  )}
                  <button
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      p === page
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-stone-500 hover:bg-stone-50 hover:text-stone-800'
                    }`}
                  >
                    {p}
                  </button>
                </React.Fragment>
              ))}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Explore page - public config discovery with ranking
 */
export default function ExplorePage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <AppHeader />
      <ExploreContent />
    </div>
  );
}
