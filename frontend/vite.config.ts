import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix = load everything, not just VITE_*).
  // This lets us read both VITE_* and legacy REACT_APP_* keys from .env.
  const env = loadEnv(mode, process.cwd(), '');

  // Resolve each public var: prefer the new VITE_* name, fall back to the
  // legacy REACT_APP_* name so existing .env files work without renaming.
  const apiUrl      = env.VITE_API_URL                    || env.REACT_APP_API_URL                    || '';
  const privyAppId  = env.VITE_PRIVY_APP_ID               || env.REACT_APP_PRIVY_APP_ID               || '';
  const solanaRpc   = env.VITE_SOLANA_RPC_URL             || env.REACT_APP_SOLANA_RPC_URL             || '';
  const walletConnect = env.VITE_WALLETCONNECT_PROJECT_ID || env.REACT_APP_WALLETCONNECT_PROJECT_ID   || '';

  const apiTarget = apiUrl || 'http://localhost:3000';

  return {
    plugins: [react()],

    // Static replacements injected at compile time.
    // Explicitly mapping VITE_* names means they work regardless of whether
    // the .env file uses VITE_* or the legacy REACT_APP_* prefix.
    define: {
      global: 'globalThis',
      'import.meta.env.VITE_API_URL':                    JSON.stringify(apiUrl),
      'import.meta.env.VITE_PRIVY_APP_ID':               JSON.stringify(privyAppId),
      'import.meta.env.VITE_SOLANA_RPC_URL':             JSON.stringify(solanaRpc),
      'import.meta.env.VITE_WALLETCONNECT_PROJECT_ID':   JSON.stringify(walletConnect),
    },

    resolve: {
      alias: {
        buffer: resolve('node_modules/buffer'),
      },
    },

    optimizeDeps: {
      include: ['buffer', '@solana/web3.js'],
    },

    server: {
      proxy: {
        // All v1 API traffic
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Docusaurus dev server (docs site, port 3001)
        '/docs': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },

    build: {
      outDir: 'build', // match CRA output dir so src/api.ts path expectations still work
    },
  };
});
