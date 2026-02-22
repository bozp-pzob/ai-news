import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, AdminConfig } from '../../services/api';

interface ConfigsTabProps {
  authToken: string;
}

/**
 * Admin configs tab with search, filtering, featured toggle, and navigation.
 */
export function ConfigsTab({ authToken }: ConfigsTabProps) {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<AdminConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('');
  const [featuredFilter, setFeaturedFilter] = useState<boolean | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 20;

  const loadConfigs = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await adminApi.getConfigs(authToken, {
        page,
        limit,
        search: search || undefined,
        visibility: visibilityFilter || undefined,
        isFeatured: featuredFilter === '' ? undefined : featuredFilter,
      });
      setConfigs(result.configs);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configs');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, page, search, visibilityFilter, featuredFilter]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleToggleFeatured = async (config: AdminConfig) => {
    try {
      await adminApi.setConfigFeatured(authToken, config.id, !config.isFeatured);
      loadConfigs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update featured status');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="Search by name, slug, or description..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-[200px] px-4 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-500 focus:outline-none focus:border-amber-500"
        />
        <select
          value={visibilityFilter}
          onChange={(e) => { setVisibilityFilter(e.target.value); setPage(1); }}
          className="px-4 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white focus:outline-none focus:border-amber-500"
        >
          <option value="">All Visibility</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
          <option value="shared">Shared</option>
        </select>
        <select
          value={featuredFilter === '' ? '' : featuredFilter ? 'true' : 'false'}
          onChange={(e) => { 
            setFeaturedFilter(e.target.value === '' ? '' : e.target.value === 'true'); 
            setPage(1); 
          }}
          className="px-4 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white focus:outline-none focus:border-amber-500"
        >
          <option value="">All Configs</option>
          <option value="true">Featured Only</option>
          <option value="false">Not Featured</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-20 text-red-400">{error}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-stone-400 text-sm border-b border-stone-700">
                  <th className="pb-3 font-medium">Config</th>
                  <th className="pb-3 font-medium">Owner</th>
                  <th className="pb-3 font-medium">Visibility</th>
                  <th className="pb-3 font-medium">Items</th>
                  <th className="pb-3 font-medium">Featured</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800">
                {configs.map(config => (
                  <tr key={config.id} className="hover:bg-stone-800/50">
                    <td className="py-3">
                      <div>
                        <p className="text-white font-medium">{config.name}</p>
                        <p className="text-stone-500 text-xs mt-0.5">/{config.slug}</p>
                      </div>
                    </td>
                    <td className="py-3">
                      <p className="text-stone-400 text-sm">{config.ownerEmail || '(no email)'}</p>
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        config.visibility === 'public' ? 'bg-green-900/50 text-green-400' :
                        config.visibility === 'private' ? 'bg-stone-700 text-stone-400' :
                        config.visibility === 'unlisted' ? 'bg-blue-900/50 text-blue-400' :
                        'bg-purple-900/50 text-purple-400'
                      }`}>
                        {config.visibility}
                      </span>
                    </td>
                    <td className="py-3 text-stone-400">{config.totalItems.toLocaleString()}</td>
                    <td className="py-3">
                      <button
                        onClick={() => handleToggleFeatured(config)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                          config.isFeatured
                            ? 'bg-amber-500 text-white'
                            : 'bg-stone-700 text-stone-400 hover:bg-stone-600'
                        }`}
                      >
                        <svg className="w-4 h-4" fill={config.isFeatured ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => navigate(`/configs/${config.id}`)}
                          className="px-3 py-1 text-sm bg-stone-700 hover:bg-stone-600 text-white rounded"
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-stone-400 text-sm">
                Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
