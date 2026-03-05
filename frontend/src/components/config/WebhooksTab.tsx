// frontend/src/components/config/WebhooksTab.tsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  webhookApi,
  OutboundWebhook,
  WebhookEventType,
} from '../../services/api';

interface WebhooksTabProps {
  configId: string;
  authToken: string;
}

const EVENT_OPTIONS: { value: WebhookEventType; label: string }[] = [
  { value: 'job.completed', label: 'Job Completed' },
  { value: 'job.failed', label: 'Job Failed' },
  { value: 'job.started', label: 'Job Started' },
  { value: 'job.cancelled', label: 'Job Cancelled' },
];

/**
 * Webhooks management tab for a config.
 * Manages outbound webhook subscriptions (notify external URLs on events).
 */
export function WebhooksTab({ configId, authToken }: WebhooksTabProps) {
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newEvents, setNewEvents] = useState<WebhookEventType[]>(['job.completed', 'job.failed']);
  const [isCreating, setIsCreating] = useState(false);

  // Test result state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    success: boolean;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
  } | null>(null);

  const loadWebhooks = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await webhookApi.listOutbound(authToken);
      // Filter to only webhooks for this config (or global ones with no config)
      const filtered = data.webhooks.filter(
        (wh) => wh.configId === configId || wh.configId === null
      );
      setWebhooks(filtered);
    } catch (err: any) {
      setError(err.message || 'Failed to load webhooks');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, configId]);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  const handleCreate = async () => {
    if (!newUrl.trim()) return;
    setIsCreating(true);
    try {
      await webhookApi.createOutbound(authToken, {
        url: newUrl.trim(),
        configId,
        events: newEvents,
        description: newDescription.trim() || undefined,
      });
      setNewUrl('');
      setNewDescription('');
      setNewEvents(['job.completed', 'job.failed']);
      setShowCreate(false);
      await loadWebhooks();
    } catch (err: any) {
      setError(err.message || 'Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook? This cannot be undone.')) return;
    try {
      await webhookApi.deleteOutbound(authToken, id);
      setWebhooks((prev) => prev.filter((wh) => wh.id !== id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete webhook');
    }
  };

  const handleToggle = async (webhook: OutboundWebhook) => {
    try {
      const { webhook: updated } = await webhookApi.updateOutbound(authToken, webhook.id, {
        isActive: !webhook.isActive,
      });
      setWebhooks((prev) => prev.map((wh) => (wh.id === updated.id ? updated : wh)));
    } catch (err: any) {
      setError(err.message || 'Failed to update webhook');
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await webhookApi.testOutbound(authToken, id);
      setTestResult({ id, ...result });
    } catch (err: any) {
      setTestResult({ id, success: false, statusCode: null, error: err.message, durationMs: 0 });
    } finally {
      setTestingId(null);
    }
  };

  const toggleEvent = (event: WebhookEventType) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-stone-800">Outbound Webhooks</h3>
          <p className="text-sm text-stone-500 mt-1">
            Get notified at an external URL when jobs complete, fail, or other events occur.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
        >
          {showCreate ? 'Cancel' : 'Add Webhook'}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white rounded-lg p-6 border border-stone-200 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">
              Endpoint URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/webhooks/my-endpoint"
              className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="e.g. Notify Slack on completion"
              className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-600 mb-2">
              Events
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => toggleEvent(opt.value)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    newEvents.includes(opt.value)
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-white border-stone-300 text-stone-500 hover:border-stone-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={isCreating || !newUrl.trim() || newEvents.length === 0}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCreating ? 'Creating...' : 'Create Webhook'}
          </button>
        </div>
      )}

      {/* Webhook List */}
      {webhooks.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg p-8 border border-stone-200 text-center">
          <div className="text-stone-400 mb-2">
            <svg className="w-10 h-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <p className="text-stone-500 text-sm">
            No webhooks configured. Add one to get notified when jobs complete.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <WebhookCard
              key={wh.id}
              webhook={wh}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onTest={handleTest}
              isTesting={testingId === wh.id}
              testResult={testResult?.id === wh.id ? testResult : null}
            />
          ))}
        </div>
      )}

      {/* Signing info */}
      <div className="bg-stone-50 rounded-lg p-4 border border-stone-200">
        <h4 className="text-sm font-medium text-stone-700 mb-1">Verifying Webhook Signatures</h4>
        <p className="text-xs text-stone-500">
          Each webhook delivery includes an <code className="bg-stone-200 px-1 rounded">X-Webhook-Signature</code> header
          with format <code className="bg-stone-200 px-1 rounded">sha256=&lt;hex&gt;</code>.
          Verify it by computing <code className="bg-stone-200 px-1 rounded">HMAC-SHA256(signing_secret, body)</code> and
          comparing the result using a timing-safe comparison.
        </p>
      </div>
    </div>
  );
}

// ============================================
// Webhook Card Sub-component
// ============================================

interface WebhookCardProps {
  webhook: OutboundWebhook;
  onDelete: (id: string) => void;
  onToggle: (webhook: OutboundWebhook) => void;
  onTest: (id: string) => void;
  isTesting: boolean;
  testResult: {
    success: boolean;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
  } | null;
}

function WebhookCard({ webhook, onDelete, onToggle, onTest, isTesting, testResult }: WebhookCardProps) {
  return (
    <div className={`bg-white rounded-lg p-4 border ${webhook.isActive ? 'border-stone-200' : 'border-stone-200 opacity-60'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* URL */}
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${webhook.isActive ? 'bg-emerald-400' : 'bg-stone-300'}`} />
            <p className="text-sm font-mono text-stone-800 truncate">{webhook.url}</p>
          </div>

          {/* Description */}
          {webhook.description && (
            <p className="text-xs text-stone-500 ml-4 mb-2">{webhook.description}</p>
          )}

          {/* Events */}
          <div className="flex flex-wrap gap-1.5 ml-4 mb-2">
            {webhook.events.map((event) => (
              <span
                key={event}
                className="px-2 py-0.5 bg-stone-100 text-stone-600 text-xs rounded font-medium"
              >
                {event}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 ml-4 text-xs text-stone-400">
            <span>{webhook.totalDeliveries} deliveries</span>
            {webhook.totalFailures > 0 && (
              <span className="text-red-400">{webhook.totalFailures} failed</span>
            )}
            {webhook.lastTriggeredAt && (
              <span>Last: {new Date(webhook.lastTriggeredAt).toLocaleDateString()}</span>
            )}
            {webhook.consecutiveFailures > 0 && (
              <span className="text-amber-500">
                {webhook.consecutiveFailures} consecutive failures
              </span>
            )}
          </div>

          {/* Last Error */}
          {webhook.lastError && webhook.isActive && (
            <div className="ml-4 mt-2 text-xs text-red-500 bg-red-50 rounded px-2 py-1">
              Last error: {webhook.lastError}
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div className={`ml-4 mt-2 text-xs rounded px-2 py-1 ${
              testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {testResult.success
                ? `Test passed (${testResult.statusCode}, ${testResult.durationMs}ms)`
                : `Test failed: ${testResult.error || `HTTP ${testResult.statusCode}`}`
              }
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onTest(webhook.id)}
            disabled={isTesting || !webhook.isActive}
            className="px-3 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-md hover:bg-stone-200 disabled:opacity-50 transition-colors"
            title="Send test ping"
          >
            {isTesting ? 'Testing...' : 'Test'}
          </button>

          <button
            onClick={() => onToggle(webhook)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              webhook.isActive
                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
            }`}
          >
            {webhook.isActive ? 'Pause' : 'Enable'}
          </button>

          <button
            onClick={() => onDelete(webhook.id)}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
