// frontend/src/components/ProfileDropdown.tsx

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSolanaWallets } from '@privy-io/react-auth';
import { useAuth } from '../context/AuthContext';
import { solanaPayment } from '../services/solanaPayment';

/**
 * Shared profile dropdown component - light theme, minimal design.
 */
export function ProfileDropdown() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { wallets: solanaWallets } = useSolanaWallets();
  const [isOpen, setIsOpen] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const connectedWallet = solanaWallets.find(w => w.walletClientType === 'privy') || solanaWallets[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!connectedWallet?.address || !isOpen) return;
      setIsLoadingBalance(true);
      try {
        const balance = await solanaPayment.getUSDCBalance(connectedWallet.address);
        setUsdcBalance(balance);
      } catch (error) {
        setUsdcBalance(0);
      } finally {
        setIsLoadingBalance(false);
      }
    };
    if (isOpen) fetchBalance();
  }, [connectedWallet?.address, isOpen]);

  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (connectedWallet?.address) {
      navigator.clipboard.writeText(connectedWallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openExplorer = () => {
    if (connectedWallet?.address) {
      window.open(`https://solscan.io/account/${connectedWallet.address}`, '_blank');
    }
  };

  const truncateAddress = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 p-[2px] hover:scale-105 transition-transform duration-200"
      >
        <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
          <span className="text-xs font-semibold text-stone-600">
            {user?.email?.slice(0, 1).toUpperCase() || '?'}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-72 bg-white/95 backdrop-blur-xl border border-stone-200 rounded-2xl shadow-2xl shadow-black/10 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 p-[2px]">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                  <span className="text-sm font-semibold text-stone-700">
                    {user?.email?.slice(0, 1).toUpperCase() || '?'}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-800 truncate">
                  {user?.email || 'Anonymous'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    user?.tier === 'admin' ? 'bg-purple-500' : 
                    user?.tier === 'paid' ? 'bg-emerald-500' : 'bg-stone-400'
                  }`} />
                  <span className="text-xs text-stone-500">
                    {user?.tier === 'admin' ? 'Admin' : user?.tier === 'paid' ? 'Pro' : 'Free'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Wallet Card */}
          {connectedWallet && (
            <div className="mx-3 mb-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium text-stone-500">Solana</span>
                </div>
                <span className="text-sm font-semibold text-stone-800">
                  {isLoadingBalance ? '...' : usdcBalance !== null ? `$${usdcBalance.toFixed(2)}` : '--'}
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={copyAddress}
                  className="flex-1 flex items-center justify-between px-2.5 py-1.5 bg-white hover:bg-stone-100 rounded-lg transition-colors group border border-stone-200"
                >
                  <code className="text-xs text-stone-500 group-hover:text-stone-700 font-mono">
                    {truncateAddress(connectedWallet.address)}
                  </code>
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={openExplorer}
                  className="p-1.5 bg-white hover:bg-stone-100 rounded-lg transition-colors group border border-stone-200"
                  title="View on Solscan"
                >
                  <svg className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Menu */}
          <div className="px-2 pb-2 space-y-0.5">
            {!connectedWallet && (
              <button
                onClick={() => { setIsOpen(false); navigate('/upgrade'); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors text-left"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="text-sm">Connect Wallet</span>
              </button>
            )}
            
            <button
              onClick={() => { setIsOpen(false); navigate('/connections'); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors text-left"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="text-sm">Connections</span>
            </button>

            <button
              onClick={() => { setIsOpen(false); navigate('/upgrade'); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors text-left"
            >
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm">{user?.tier === 'paid' ? 'Subscription' : 'Upgrade to Pro'}</span>
            </button>

            <div className="h-px bg-stone-200 my-1" />

            <button
              onClick={() => { setIsOpen(false); logout(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-stone-500 hover:text-red-600 hover:bg-red-50 transition-colors text-left"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="text-sm">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileDropdown;
