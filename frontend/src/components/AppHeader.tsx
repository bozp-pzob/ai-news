// frontend/src/components/AppHeader.tsx

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserLimits } from '../services/api';
import { ProfileDropdown } from './ProfileDropdown';
import { CreateConfigDialog } from './CreateConfigDialog';

interface AppHeaderProps {
  /** Show admin badge next to logo */
  adminBadge?: boolean;
  /** Override max-width class (default: 'max-w-6xl') */
  maxWidth?: string;
  /** User limits for config creation checks */
  limits?: UserLimits | null;
  /** Additional nav items to render before the profile dropdown */
  children?: React.ReactNode;
}

export function AppHeader({ adminBadge, maxWidth = 'max-w-6xl', limits, children }: AppHeaderProps) {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const isOnDashboard = location.pathname === '/dashboard';

  const handleCreateSuccess = (configId: string, isLocal: boolean) => {
    setShowCreateDialog(false);
    if (isLocal) {
      navigate(`/builder?local=${configId}`);
    } else {
      navigate(`/builder/${configId}`);
    }
  };

  return (
    <>
      <header className="bg-white border-b border-stone-200 shadow-sm">
        <div className={`${maxWidth} mx-auto px-4 py-4 flex items-center justify-between`}>
          {/* Left: Logo */}
          <div className="flex items-center gap-3">
            <a href="/" className="text-xl font-bold text-emerald-700">
              Digital Gardener
            </a>
            {adminBadge && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded font-medium">
                Admin
              </span>
            )}
          </div>

          {/* Right: Nav */}
          <nav className="flex items-center gap-4">
            <button
              onClick={() => navigate('/explore')}
              className={`text-sm transition-colors ${
                location.pathname === '/explore'
                  ? 'text-emerald-600 font-medium'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Explore
            </button>
            {!isOnDashboard && (
              <button
                onClick={() => navigate('/dashboard')}
                className="text-stone-500 hover:text-stone-800 text-sm transition-colors"
              >
                Dashboard
              </button>
            )}

            {/* New Config button */}
            <button
              onClick={() => {
                if (!isAuthenticated) {
                  setShowCreateDialog(true);
                } else {
                  setShowCreateDialog(true);
                }
              }}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-medium transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Config
            </button>

            {/* Custom children nav items */}
            {children}

            {/* Profile dropdown for authenticated users */}
            {isAuthenticated ? (
              <ProfileDropdown />
            ) : (
              <button
                onClick={login}
                className="text-stone-500 hover:text-stone-800 text-sm transition-colors"
              >
                Sign In
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Create Config Dialog */}
      <CreateConfigDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSuccess={handleCreateSuccess}
        limits={limits}
      />
    </>
  );
}

export default AppHeader;
