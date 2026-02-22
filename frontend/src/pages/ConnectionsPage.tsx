/**
 * Connections Page - Manage external platform connections
 * 
 * Route: /connections
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthGuard } from '../components/auth/AuthGuard';
import { ExternalConnectionManager } from '../components/connections';
import { AppHeader } from '../components/AppHeader';

/**
 * Connections page content
 */
function ConnectionsContent() {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6">
        <ol className="flex items-center gap-2 text-sm">
          <li>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-stone-400 hover:text-white transition-colors"
            >
              Dashboard
            </button>
          </li>
          <li className="text-stone-600">/</li>
          <li className="text-white">Connections</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">External Connections</h1>
        <p className="text-stone-400 mt-2">
          Connect external platforms like Discord, Telegram, and Slack to use their channels as data sources in your configs.
        </p>
      </div>

      {/* Connection Manager */}
      <ExternalConnectionManager showChannelCount={true} />

      {/* Help Section */}
      <div className="mt-12 bg-stone-800/50 rounded-lg border border-stone-700 p-6">
        <h2 className="text-lg font-medium text-white mb-4">How it works</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <div className="w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <h3 className="font-medium text-white mb-1">1. Connect a Platform</h3>
            <p className="text-sm text-stone-400">
              Add a Discord server or Telegram group by clicking "Add Connection" and following the authorization flow.
            </p>
          </div>
          <div>
            <div className="w-10 h-10 rounded-lg bg-amber-600/20 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </div>
            <h3 className="font-medium text-white mb-1">2. Select Channels</h3>
            <p className="text-sm text-stone-400">
              Choose which channels to monitor. The bot will collect messages from these channels.
            </p>
          </div>
          <div>
            <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-medium text-white mb-1">3. Use in Configs</h3>
            <p className="text-sm text-stone-400">
              Add a Discord or Telegram source to your config and select from your connected channels.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Connections page with auth guard
 */
export default function ConnectionsPage() {
  return (
    <div className="min-h-screen bg-stone-950">
      <AppHeader />

      {/* Main content with auth guard */}
      <AuthGuard>
        <ConnectionsContent />
      </AuthGuard>
    </div>
  );
}
