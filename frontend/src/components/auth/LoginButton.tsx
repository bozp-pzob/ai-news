// frontend/src/components/auth/LoginButton.tsx

import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { UserMenu } from './UserMenu';

interface LoginButtonProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost';
}

/**
 * Login button that shows login UI or user menu based on auth state
 */
export function LoginButton({ 
  className = '',
  size = 'md',
  variant = 'primary'
}: LoginButtonProps) {
  const { isPrivyReady, isAuthenticated, isLoading, login } = useAuth();

  // Size classes
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  // Variant classes
  const variantClasses = {
    primary: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    secondary: 'bg-stone-100 hover:bg-stone-200 text-stone-700',
    ghost: 'bg-transparent hover:bg-stone-100 text-stone-600 hover:text-stone-800',
  };

  // Show loading state while Privy initializes
  if (!isPrivyReady || isLoading) {
    return (
      <div 
        className={`
          ${sizeClasses[size]} 
          rounded-lg 
          bg-stone-200 
          animate-pulse
          ${className}
        `}
        style={{ width: size === 'sm' ? 60 : size === 'md' ? 80 : 100 }}
      />
    );
  }

  // Show user menu if authenticated
  if (isAuthenticated) {
    return <UserMenu />;
  }

  // Show login button
  return (
    <button
      onClick={login}
      className={`
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        rounded-lg
        font-medium
        transition-colors
        flex items-center gap-2
        ${className}
      `}
    >
      <svg 
        className="w-4 h-4" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" 
        />
      </svg>
      Sign In
    </button>
  );
}

/**
 * Simple login link for navigation
 */
export function LoginLink({ className = '' }: { className?: string }) {
  const { isPrivyReady, isAuthenticated, login } = useAuth();

  if (!isPrivyReady) {
    return null;
  }

  if (isAuthenticated) {
    return null;
  }

  return (
    <button
      onClick={login}
      className={`text-stone-600 hover:text-stone-800 transition-colors ${className}`}
    >
      Sign In
    </button>
  );
}

export default LoginButton;
