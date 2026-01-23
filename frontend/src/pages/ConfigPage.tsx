// frontend/src/pages/ConfigPage.tsx

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthGuard } from '../components/auth/AuthGuard';
import { 
  configApi,
  runApi,
  PlatformConfig, 
  ConfigStats,
  TopicCount,
  ConfigVisibility,
  ContentItem,
  SummaryItem,
} from '../services/api';

/**
 * Tab navigation
 */
function Tabs({ 
  tabs, 
  activeTab, 
  onChange 
}: { 
  tabs: { id: string; label: string }[];
  activeTab: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 p-1 bg-stone-800 rounded-lg">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? 'bg-stone-700 text-white'
              : 'text-stone-400 hover:text-white'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Overview tab content
 */
function OverviewTab({ 
  config, 
  stats 
}: { 
  config: PlatformConfig; 
  stats: ConfigStats | null;
}) {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Total Items</p>
          <p className="text-2xl font-bold text-white mt-1">
            {config.totalItems.toLocaleString()}
          </p>
        </div>
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Total Queries</p>
          <p className="text-2xl font-bold text-white mt-1">
            {config.totalQueries.toLocaleString()}
          </p>
        </div>
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Revenue</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">
            ${(config.totalRevenue || 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Status</p>
          <p className={`text-2xl font-bold mt-1 ${
            config.status === 'running' ? 'text-amber-400' :
            config.status === 'error' ? 'text-red-400' :
            'text-stone-300'
          }`}>
            {config.status.charAt(0).toUpperCase() + config.status.slice(1)}
          </p>
        </div>
      </div>

      {/* Date Range */}
      {stats?.dateRange && (
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <h3 className="font-medium text-white mb-2">Data Range</h3>
          <p className="text-stone-400">
            {new Date(stats.dateRange.from).toLocaleDateString()} - {new Date(stats.dateRange.to).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Sources */}
      {stats?.sources && stats.sources.length > 0 && (
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <h3 className="font-medium text-white mb-4">Sources</h3>
          <div className="space-y-2">
            {stats.sources.map((source, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-stone-700 last:border-0">
                <span className="text-stone-300">{source.source}</span>
                <div className="flex items-center gap-4">
                  <span className="text-stone-400 text-sm">{source.count.toLocaleString()} items</span>
                  <span className="text-stone-500 text-xs">
                    Last: {new Date(source.latestDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Error */}
      {config.lastError && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
          <h3 className="font-medium text-red-400 mb-2">Last Error</h3>
          <p className="text-red-300 text-sm font-mono">{config.lastError}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Topics tab content
 */
function TopicsTab({ configId, authToken }: { configId: string; authToken: string | null }) {
  const [topics, setTopics] = useState<TopicCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadTopics() {
      try {
        const result = await configApi.getTopics(configId, { limit: 50 }, authToken || undefined);
        setTopics(result.topics);
      } catch (err) {
        console.error('Error loading topics:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadTopics();
  }, [configId, authToken]);

  if (isLoading) {
    return <div className="text-center py-8 text-stone-400">Loading topics...</div>;
  }

  if (topics.length === 0) {
    return <div className="text-center py-8 text-stone-400">No topics found</div>;
  }

  const maxCount = Math.max(...topics.map(t => t.count));

  return (
    <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
      <h3 className="font-medium text-white mb-4">Top Topics</h3>
      <div className="space-y-2">
        {topics.map((topic, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-32 text-stone-300 truncate">{topic.topic}</div>
            <div className="flex-1 bg-stone-700 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-amber-500 h-full rounded-full"
                style={{ width: `${(topic.count / maxCount) * 100}%` }}
              />
            </div>
            <div className="w-16 text-right text-stone-400 text-sm">
              {topic.count.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Items tab content
 */
function ItemsTab({ configId, authToken }: { configId: string; authToken: string | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, limit: 20, offset: 0, hasMore: false });
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const loadItems = async (offset = 0) => {
    if (!authToken) return;
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
      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
        >
          <option value="">All Sources</option>
          {sources.map(source => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
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

      {/* Items List */}
      <div className="bg-stone-800 rounded-lg border border-stone-700 overflow-hidden">
        <div className="divide-y divide-stone-700">
          {items.map((item) => (
            <div key={item.id} className="p-4">
              <div 
                className="flex items-start justify-between cursor-pointer"
                onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-stone-700 rounded text-xs text-stone-300">
                      {item.type}
                    </span>
                    <span className="px-2 py-0.5 bg-amber-900/50 rounded text-xs text-amber-400">
                      {item.source}
                    </span>
                  </div>
                  <p className="text-white font-medium truncate">
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
                <div className="mt-4 pt-4 border-t border-stone-700">
                  {item.text && (
                    <div className="mb-3">
                      <p className="text-stone-400 text-xs mb-1">Content</p>
                      <p className="text-stone-300 text-sm whitespace-pre-wrap">{item.text}</p>
                    </div>
                  )}
                  {item.topics && item.topics.length > 0 && (
                    <div className="mb-3">
                      <p className="text-stone-400 text-xs mb-1">Topics</p>
                      <div className="flex flex-wrap gap-1">
                        {item.topics.map((topic, i) => (
                          <span key={i} className="px-2 py-0.5 bg-stone-700 rounded-full text-xs text-stone-300">
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
                        className="text-amber-400 hover:text-amber-300 text-sm break-all"
                      >
                        {item.link}
                      </a>
                    </div>
                  )}
                  {item.metadata && (
                    <div>
                      <p className="text-stone-400 text-xs mb-1">Metadata</p>
                      <pre className="text-stone-400 text-xs bg-stone-900 p-2 rounded overflow-auto max-h-40">
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

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => loadItems(pagination.offset - pagination.limit)}
          disabled={pagination.offset === 0}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-600 text-white rounded-lg text-sm transition-colors"
        >
          Previous
        </button>
        <span className="text-stone-400 text-sm">
          Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
        </span>
        <button
          onClick={() => loadItems(pagination.offset + pagination.limit)}
          disabled={!pagination.hasMore}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-600 text-white rounded-lg text-sm transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Summaries tab content
 */
function SummariesTab({ configId, authToken }: { configId: string; authToken: string | null }) {
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, limit: 10, offset: 0, hasMore: false });
  const [expandedSummary, setExpandedSummary] = useState<number | null>(null);

  const loadSummaries = async (offset = 0) => {
    if (!authToken) return;
    setIsLoading(true);
    try {
      const result = await configApi.getSummaries(authToken, configId, {
        limit: 10,
        offset,
      });
      setSummaries(result.summaries);
      setPagination(result.pagination);
    } catch (err) {
      console.error('Error loading summaries:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummaries(0);
  }, [configId, authToken]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (isLoading && summaries.length === 0) {
    return <div className="text-center py-8 text-stone-400">Loading summaries...</div>;
  }

  if (summaries.length === 0) {
    return (
      <div className="text-center py-8 text-stone-400">
        No summaries found. Run aggregation to generate summaries.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-stone-400 text-sm">
        {pagination.total.toLocaleString()} total summaries
      </div>

      {/* Summaries List */}
      <div className="space-y-4">
        {summaries.map((summary) => (
          <div key={summary.id} className="bg-stone-800 rounded-lg border border-stone-700 overflow-hidden">
            <div 
              className="p-4 cursor-pointer flex items-center justify-between"
              onClick={() => setExpandedSummary(expandedSummary === summary.id ? null : summary.id)}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-amber-900/50 rounded text-xs text-amber-400">
                    {summary.type}
                  </span>
                </div>
                <p className="text-white font-medium">
                  {summary.title || formatDate(summary.date)}
                </p>
                <p className="text-stone-500 text-xs mt-1">
                  Created: {new Date(summary.created_at).toLocaleString()}
                </p>
              </div>
              <svg 
                className={`w-5 h-5 text-stone-400 transition-transform ${expandedSummary === summary.id ? 'rotate-180' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            
            {/* Expanded Content */}
            {expandedSummary === summary.id && (
              <div className="px-4 pb-4 border-t border-stone-700 pt-4">
                {summary.markdown ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-stone-300 text-sm bg-stone-900 p-4 rounded-lg overflow-auto max-h-96">
                      {summary.markdown}
                    </pre>
                  </div>
                ) : summary.categories ? (
                  <div>
                    <p className="text-stone-400 text-xs mb-2">Categories</p>
                    <pre className="text-stone-400 text-xs bg-stone-900 p-4 rounded-lg overflow-auto max-h-96">
                      {typeof summary.categories === 'string' 
                        ? summary.categories 
                        : JSON.stringify(summary.categories, null, 2)}
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

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => loadSummaries(pagination.offset - pagination.limit)}
          disabled={pagination.offset === 0}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-600 text-white rounded-lg text-sm transition-colors"
        >
          Previous
        </button>
        <span className="text-stone-400 text-sm">
          Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
        </span>
        <button
          onClick={() => loadSummaries(pagination.offset + pagination.limit)}
          disabled={!pagination.hasMore}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-600 text-white rounded-lg text-sm transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Settings tab content
 */
function SettingsTab({ 
  config, 
  authToken,
  onUpdate,
  onDelete,
}: { 
  config: PlatformConfig;
  authToken: string;
  onUpdate: (updates: Partial<PlatformConfig>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(config.name);
  const [description, setDescription] = useState(config.description || '');
  const [visibility, setVisibility] = useState<ConfigVisibility>(config.visibility);
  const [monetizationEnabled, setMonetizationEnabled] = useState(config.monetizationEnabled);
  const [pricePerQuery, setPricePerQuery] = useState(config.pricePerQuery?.toString() || '0.001');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate({
        name,
        description,
        visibility,
        monetizationEnabled,
        pricePerQuery: parseFloat(pricePerQuery),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* General Settings */}
      <div className="bg-stone-800 rounded-lg p-6 border border-stone-700">
        <h3 className="font-medium text-white mb-4">General</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as ConfigVisibility)}
              className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="private">Private - Only you can access</option>
              <option value="unlisted">Unlisted - Anyone with the link</option>
              <option value="public">Public - Discoverable by everyone</option>
            </select>
          </div>
        </div>
      </div>

      {/* Monetization */}
      <div className="bg-stone-800 rounded-lg p-6 border border-stone-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-white">Monetization</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={monetizationEnabled}
              onChange={(e) => setMonetizationEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-stone-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-stone-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white" />
          </label>
        </div>
        
        {monetizationEnabled && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1">
                Price per Query (USDC)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">$</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={pricePerQuery}
                  onChange={(e) => setPricePerQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
              <p className="text-stone-500 text-xs mt-1">
                Platform takes 10% fee. You receive ${(parseFloat(pricePerQuery || '0') * 0.9).toFixed(4)} per query.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-700 text-white rounded-lg font-medium transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
        
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="px-4 py-2 text-red-400 hover:text-red-300 transition-colors"
        >
          Delete Config
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-stone-800 rounded-lg p-6 max-w-md w-full mx-4 border border-stone-700">
            <h3 className="text-lg font-medium text-white mb-2">Delete Config</h3>
            <p className="text-stone-400 mb-6">
              Are you sure you want to delete "{config.name}"? This action cannot be undone and all data will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-stone-700 text-white rounded-lg font-medium transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Config page content
 */
function ConfigPageContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authToken } = useAuth();
  
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [stats, setStats] = useState<ConfigStats | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load config data
  useEffect(() => {
    async function loadConfig() {
      if (!id) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const [configRes, statsRes] = await Promise.all([
          configApi.get(id, authToken || undefined),
          configApi.getStats(id, authToken || undefined),
        ]);
        
        setConfig(configRes);
        setStats(statsRes);
      } catch (err) {
        console.error('Error loading config:', err);
        setError(err instanceof Error ? err.message : 'Failed to load config');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadConfig();
  }, [id, authToken]);

  // Handle update
  const handleUpdate = async (updates: Partial<PlatformConfig>) => {
    if (!id || !authToken || !config) return;
    
    try {
      const updated = await configApi.update(authToken, id, updates as any);
      setConfig({ ...config, ...updated });
    } catch (err) {
      console.error('Error updating config:', err);
      throw err;
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!id || !authToken) return;
    
    try {
      await configApi.delete(authToken, id);
      navigate('/dashboard');
    } catch (err) {
      console.error('Error deleting config:', err);
      throw err;
    }
  };

  // Handle run
  const handleRun = async () => {
    if (!id || !authToken || !config) return;
    
    try {
      const result = await configApi.run(authToken, id);
      setConfig({ ...config, status: 'running' });
      
      // Poll for job completion
      const pollInterval = setInterval(async () => {
        try {
          const jobStatus = await runApi.getJobStatus(result.jobId);
          if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
            clearInterval(pollInterval);
            setConfig(prev => prev ? { 
              ...prev, 
              status: jobStatus.status === 'completed' ? 'idle' : 'error' 
            } : prev);
          }
        } catch (err) {
          // Job might not exist anymore, stop polling
          clearInterval(pollInterval);
          setConfig(prev => prev ? { ...prev, status: 'idle' } : prev);
        }
      }, 2000); // Poll every 2 seconds
      
      // Stop polling after 10 minutes max
      setTimeout(() => clearInterval(pollInterval), 600000);
    } catch (err) {
      console.error('Error running config:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error || 'Config not found'}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'items', label: 'Items' },
    { id: 'summaries', label: 'Summaries' },
    { id: 'topics', label: 'Topics' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-stone-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-white">{config.name}</h1>
          </div>
          <p className="text-stone-400">/{config.slug}</p>
        </div>
        <button
          onClick={handleRun}
          disabled={config.status === 'running'}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            config.status === 'running'
              ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
              : 'bg-amber-600 hover:bg-amber-700 text-white'
          }`}
        >
          {config.status === 'running' ? 'Running...' : 'Run Aggregation'}
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab config={config} stats={stats} />}
      {activeTab === 'items' && <ItemsTab configId={config.id} authToken={authToken} />}
      {activeTab === 'summaries' && <SummariesTab configId={config.id} authToken={authToken} />}
      {activeTab === 'topics' && <TopicsTab configId={config.id} authToken={authToken} />}
      {activeTab === 'settings' && authToken && (
        <SettingsTab 
          config={config} 
          authToken={authToken}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

/**
 * Config page with auth guard
 */
export default function ConfigPage() {
  return (
    <div className="min-h-screen bg-stone-950">
      {/* Header */}
      <header className="bg-stone-900 border-b border-stone-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-bold text-white">
            AI News
          </a>
          <nav className="flex items-center gap-4">
            <a href="/dashboard" className="text-stone-400 hover:text-white transition-colors">
              Dashboard
            </a>
            <a href="/docs" className="text-stone-400 hover:text-white transition-colors">
              Docs
            </a>
          </nav>
        </div>
      </header>

      {/* Main content with auth guard */}
      <AuthGuard>
        <ConfigPageContent />
      </AuthGuard>
    </div>
  );
}
