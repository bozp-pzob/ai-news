// frontend/src/components/MobileBottomNav.tsx

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Fixed bottom tab bar for mobile navigation (< md screens).
 *
 * Tabs:
 *   1. Dashboard  – home icon, /dashboard (login-gated)
 *   2. Explore    – search icon, /explore
 *   3. + Create   – green accent circle, /builder
 *   4. Context-aware:
 *        admin  → Admin   (/admin)
 *        pro    → Subscription (/upgrade)
 *        free   → Upgrade (/upgrade)
 *        unauth → Upgrade (/upgrade)
 *   5. Settings (auth) / Sign In (unauth)
 */
export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isAdmin, user, login } = useAuth();

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

  // Tab 4 — contextual label, icon, route
  const tab4 = (() => {
    if (isAuthenticated && isAdmin) {
      return { label: 'Admin', route: '/admin', active: isActive('/admin') };
    }
    if (isAuthenticated && user?.tier === 'paid') {
      return { label: 'Subscription', route: '/upgrade', active: isActive('/upgrade') };
    }
    return { label: 'Upgrade', route: '/upgrade', active: isActive('/upgrade') };
  })();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-stone-200 md:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-14 px-2">
        {/* 1 · Dashboard */}
        <button
          onClick={handleDashboardClick}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
            isActivePrefix('/dashboard') || isActivePrefix('/configs') ? 'text-emerald-600' : 'text-stone-400'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={(isActivePrefix('/dashboard') || isActivePrefix('/configs')) ? 2 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="text-[10px] font-medium">Dashboard</span>
        </button>

        {/* 2 · Explore */}
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

        {/* 3 · Create (center accent) */}
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

        {/* 4 · Upgrade / Subscription / Admin */}
        <button
          onClick={() => {
            if (!isAuthenticated && tab4.route === '/upgrade') {
              // Non-auth users can view the upgrade page without logging in
              navigate('/upgrade');
            } else if (isAuthenticated) {
              navigate(tab4.route);
            } else {
              sessionStorage.setItem('postLoginRedirect', tab4.route);
              login();
            }
          }}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
            tab4.active ? 'text-emerald-600' : 'text-stone-400'
          }`}
        >
          {isAuthenticated && isAdmin ? (
            /* Shield icon for Admin */
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={tab4.active ? 2 : 1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          ) : (
            /* Lightning bolt icon for Upgrade / Subscription */
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={tab4.active ? 2 : 1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          <span className="text-[10px] font-medium">{tab4.label}</span>
        </button>

        {/* 5 · Settings / Sign In */}
        {isAuthenticated ? (
          <button
            onClick={() => navigate('/connections')}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors ${
              isActive('/connections') ? 'text-emerald-600' : 'text-stone-400'
            }`}
          >
            {/* Gear/cog icon */}
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive('/connections') ? 2 : 1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[10px] font-medium">Settings</span>
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
