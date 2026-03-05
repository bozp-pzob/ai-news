import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Load all env vars (empty prefix = load everything, not just VITE_*)
  // This lets the proxy target read REACT_APP_API_URL or VITE_API_URL from .env
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_URL || env.REACT_APP_API_URL || 'http://localhost:3000';

  return {
    plugins: [react()],

    // Polyfills for Solana/web3.js which expects Node globals
    define: {
      global: 'globalThis',
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
