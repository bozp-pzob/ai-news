// frontend/src/components/PrivyProvider.tsx

import React, { ReactNode } from 'react';
// @ts-ignore - Privy types resolved after npm install
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
        // Note: Discord login provides identity only; bot authorization uses separate OAuth flow
        loginMethods: ['email', 'wallet', 'google', 'twitter', 'github', 'discord'],
        
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

    >
      {children}
    </BasePrivyProvider>
  );
}

export default PrivyProvider;
