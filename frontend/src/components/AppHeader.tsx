// frontend/src/components/AppHeader.tsx

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserLimits } from '../services/api';
import { ProfileDropdown } from './ProfileDropdown';
import { CreateConfigDialog } from './CreateConfigDialog';
import { MobileBottomNav } from './MobileBottomNav';

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
            <a href="/" className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="h-10 w-10" aria-label="Digital Gardener" role="img">
                <g transform="translate(32,32)">
                  <ellipse cx="0" cy="-14" rx="7" ry="12" fill="#CF70FF" transform="rotate(0)" />
                  <ellipse cx="0" cy="-14" rx="7" ry="12" fill="#DD98FF" transform="rotate(60)" />
                  <ellipse cx="0" cy="-14" rx="7" ry="12" fill="#CF70FF" transform="rotate(120)" />
                  <ellipse cx="0" cy="-14" rx="7" ry="12" fill="#DD98FF" transform="rotate(180)" />
                  <ellipse cx="0" cy="-14" rx="7" ry="12" fill="#CF70FF" transform="rotate(240)" />
                  <ellipse cx="0" cy="-14" rx="7" ry="12" fill="#DD98FF" transform="rotate(300)" />
                  <circle r="8" fill="#ffee9a" />
                </g>
              </svg>
            </a>
            {adminBadge && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded font-medium">
                Admin
              </span>
            )}
          </div>

          {/* Right: Nav */}
          <nav className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => navigate('/explore')}
              className={`hidden md:inline-flex text-sm transition-colors ${
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
                className="hidden md:inline-flex text-stone-500 hover:text-stone-800 text-sm transition-colors"
              >
                Dashboard
              </button>
            )}

            {/* New Config button - hidden on mobile (available in bottom nav) */}
            <button
              onClick={() => {
                if (!isAuthenticated) {
                  setShowCreateDialog(true);
                } else {
                  setShowCreateDialog(true);
                }
              }}
              className="hidden md:flex px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-medium transition-colors items-center gap-1.5"
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

      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
    </>
  );
}

export default AppHeader;
