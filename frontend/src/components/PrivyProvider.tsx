// frontend/src/components/PrivyProvider.tsx
// @ts-nocheck - Privy types will be available after npm install

import React, { ReactNode } from 'react';
import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth';

interface PrivyWrapperProps {
  children: ReactNode;
}

/**
 * Privy configuration
 */
const PRIVY_APP_ID = process.env.REACT_APP_PRIVY_APP_ID || '';

/**
 * PrivyProvider wrapper with our app configuration
 * 
 * Note: Solana embedded wallets need to be enabled in the Privy dashboard:
 * Dashboard > Embedded Wallets > Enable Solana
 */
export function PrivyProvider({ children }: PrivyWrapperProps) {
  if (!PRIVY_APP_ID) {
    console.warn('[PrivyProvider] REACT_APP_PRIVY_APP_ID not set - auth will be disabled');
    // Return children without Privy if no app ID configured
    return <>{children}</>;
  }

  return (
    <BasePrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Login methods to support
        loginMethods: ['email', 'wallet', 'google', 'twitter', 'github'],
        
        // Appearance configuration
        appearance: {
          theme: 'dark',
          accentColor: '#f59e0b', // Amber to match the app
          logo: '/logo.png', // Add logo if available
          showWalletLoginFirst: false,
        },
        
        // Embedded wallet configuration
        // Solana wallets must be enabled in the Privy dashboard
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          noPromptOnSignature: false,
        },
        
        // Solana cluster configuration for funding and transactions
        solanaClusters: [
          { name: 'mainnet-beta', rpcUrl: process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com' },
        ],
        
        // Legal/consent links (update with actual URLs)
        legal: {
          termsAndConditionsUrl: '/terms',
          privacyPolicyUrl: '/privacy',
        },
        
        // Wallet connection configuration
        walletConnectCloudProjectId: process.env.REACT_APP_WALLETCONNECT_PROJECT_ID,
        
        // Session configuration
        // Sessions last 7 days by default
      }}
      onSuccess={(user) => {
        console.log('[PrivyProvider] Login successful:', user.id);
      }}
    >
      {children}
    </BasePrivyProvider>
  );
}

export default PrivyProvider;
