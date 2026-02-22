// frontend/src/pages/AdminPage.tsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthGuard } from '../components/auth/AuthGuard';
import { AppHeader } from '../components/AppHeader';
import { OverviewTab } from '../components/admin/OverviewTab';
import { UsersTab } from '../components/admin/UsersTab';
import { ConfigsTab } from '../components/admin/ConfigsTab';

// ============================================================================
// MAIN ADMIN PAGE
// ============================================================================

type TabId = 'overview' | 'users' | 'configs';

function AdminContent() {
  const { authToken, user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'users',
      label: 'Users',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      id: 'configs',
      label: 'Configs',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
  ];

  if (!authToken || !user) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-stone-400 mt-1">Manage users, configs, and system settings</p>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg text-sm"
        >
          Back to Dashboard
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-700 mb-6">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-amber-500 text-white'
                  : 'border-transparent text-stone-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab authToken={authToken} />}
      {activeTab === 'users' && <UsersTab authToken={authToken} currentUserId={user.id} />}
      {activeTab === 'configs' && <ConfigsTab authToken={authToken} />}
    </div>
  );
}

/**
 * Admin page with auth guard
 */
export default function AdminPage() {
  return (
    <div className="min-h-screen bg-stone-950">
      <AppHeader adminBadge maxWidth="max-w-7xl" />

      {/* Main content with auth guard - requires admin tier */}
      <AuthGuard requiredTier="admin">
        <AdminContent />
      </AuthGuard>
    </div>
  );
}
