// frontend/src/components/auth/UserMenu.tsx

import React, { useState, useRef, useEffect } from 'react';
import { useAuth, PlatformUser } from '../../context/AuthContext';
import { useLicense } from '../../hooks/useLicense';

/**
 * User avatar component
 */
function UserAvatar({ user }: { user: PlatformUser }) {
  const initial = user.email?.[0]?.toUpperCase() || 
                  user.walletAddress?.slice(2, 4)?.toUpperCase() || 
                  'U';
  
  // Generate a color based on the user ID
  const colors = [
    'bg-emerald-500',
    'bg-blue-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-orange-500',
    'bg-teal-500',
  ];
  const colorIndex = user.id.charCodeAt(0) % colors.length;
  const bgColor = colors[colorIndex];

  return (
    <div className={`w-8 h-8 rounded-full ${bgColor} flex items-center justify-center text-white font-medium text-sm`}>
      {initial}
    </div>
  );
}

/**
 * Tier badge component
 */
function TierBadge({ tier }: { tier: PlatformUser['tier'] }) {
  const config = {
    free: { label: 'Free', className: 'bg-stone-200 text-stone-600' },
    paid: { label: 'Pro', className: 'bg-emerald-100 text-emerald-700' },
    admin: { label: 'Admin', className: 'bg-purple-100 text-purple-700' },
  };

  const { label, className } = config[tier];

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

/**
 * Format wallet address for display
 */
function formatWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * User menu dropdown component
 */
export function UserMenu() {
  const { user, isLoading, logout, isFreeUser, isAdmin } = useAuth();
  const { isActive, daysRemaining, hoursRemaining, timeRemainingText } = useLicense();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menu on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  if (isLoading) {
    return (
      <div className="w-8 h-8 rounded-full bg-stone-200 animate-pulse" />
    );
  }

  if (!user) {
    return null;
  }

  const displayName = user.email || 
                      (user.walletAddress ? formatWallet(user.walletAddress) : 'User');

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-lg hover:bg-stone-100 transition-colors"
        aria-label="User menu"
        aria-expanded={isOpen}
      >
        <UserAvatar user={user} />
        <span className="text-sm text-stone-600 hidden sm:block max-w-[150px] truncate">
          {displayName}
        </span>
        <svg 
          className={`w-4 h-4 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-stone-200 rounded-lg shadow-xl z-50">
          {/* User info section */}
          <div className="p-4 border-b border-stone-200">
            <div className="flex items-center gap-3">
              <UserAvatar user={user} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-stone-800 truncate">
                  {displayName}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <TierBadge tier={user.tier} />
                  {/* Show subscription expiry for Pro users */}
                  {isActive && timeRemainingText && (
                    <span className={`text-xs ${(daysRemaining !== null && daysRemaining <= 7) || (hoursRemaining !== null && hoursRemaining < 24) ? 'text-emerald-600' : 'text-stone-400'}`}>
                      {hoursRemaining !== null && hoursRemaining < 24 
                        ? `${hoursRemaining}h left` 
                        : daysRemaining !== null 
                          ? `${daysRemaining}d left`
                          : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Wallet address if different from display name */}
            {user.email && user.walletAddress && (
              <div className="mt-3 text-xs text-stone-400">
                <span className="font-medium">Wallet:</span>{' '}
                {formatWallet(user.walletAddress)}
              </div>
            )}
          </div>

          {/* Menu items */}
          <div className="py-2">
            {/* Dashboard link */}
            <a
              href="/dashboard"
              className="flex items-center gap-3 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Dashboard
            </a>

            {/* My Configs link */}
            <a
              href="/configs"
              className="flex items-center gap-3 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              My Configs
            </a>

            {/* Admin link - only visible to admins */}
            {isAdmin && (
              <a
                href="/admin"
                className="flex items-center gap-3 px-4 py-2 text-sm text-purple-600 hover:bg-stone-50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Admin Dashboard
              </a>
            )}

            {/* Upgrade/Renew prompt */}
            {isFreeUser ? (
              <a
                href="/upgrade"
                className="flex items-center gap-3 px-4 py-2 text-sm text-emerald-600 hover:bg-stone-50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Upgrade to Pro
              </a>
            ) : isActive && daysRemaining !== null && daysRemaining <= 7 ? (
              <a
                href="/upgrade"
                className="flex items-center gap-3 px-4 py-2 text-sm text-emerald-600 hover:bg-stone-50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Renew Subscription
              </a>
            ) : null}

            {/* Settings link */}
            <a
              href="/settings"
              className="flex items-center gap-3 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Settings
            </a>
          </div>

          {/* Logout section */}
          <div className="border-t border-stone-200 py-2">
            <button
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-500 hover:bg-stone-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
