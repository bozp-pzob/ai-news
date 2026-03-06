// frontend/src/components/MobileBottomNav.tsx

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Fixed bottom tab bar for mobile navigation (< md screens).
 * Renders on both landing/public and authenticated pages.
 */
export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login } = useAuth();

  const isActive = (path: string) => location.pathname === path;
  const isActivePrefix = (prefix: string) => location.pathname.startsWith(prefix);

  const handleDashboardClick = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      sessionStorage.setItem('postLoginRedirect', '/dashboard');
      login();
    }
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-stone-200 md:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-14 px-2">
        {/* Home */}
        <button
          onClick={() => navigate('/')}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
            isActive('/') ? 'text-emerald-600' : 'text-stone-400'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive('/') ? 2 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="text-[10px] font-medium">Home</span>
        </button>

        {/* Explore */}
        <button
          onClick={() => navigate('/explore')}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
            isActive('/explore') ? 'text-emerald-600' : 'text-stone-400'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive('/explore') ? 2 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-[10px] font-medium">Explore</span>
        </button>

        {/* New Config (center, accent) */}
        <button
          onClick={() => navigate('/builder')}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5"
        >
          <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
        </button>

        {/* Dashboard */}
        <button
          onClick={handleDashboardClick}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
            isActivePrefix('/dashboard') || isActivePrefix('/configs') ? 'text-emerald-600' : 'text-stone-400'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={(isActivePrefix('/dashboard') || isActivePrefix('/configs')) ? 2 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span className="text-[10px] font-medium">Dashboard</span>
        </button>

        {/* Profile / Sign In */}
        {isAuthenticated ? (
          <button
            onClick={() => navigate('/connections')}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
              isActive('/connections') || isActive('/upgrade') ? 'text-emerald-600' : 'text-stone-400'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-[10px] font-medium">Account</span>
          </button>
        ) : (
          <button
            onClick={login}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg text-stone-400"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            <span className="text-[10px] font-medium">Sign In</span>
          </button>
        )}
      </div>
    </nav>
  );
}

export default MobileBottomNav;
