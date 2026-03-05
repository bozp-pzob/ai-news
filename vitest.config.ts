import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Generous timeout: SQLite in-memory init + HTTP round-trips
    testTimeout: 30000,
    hookTimeout: 15000,
    // Show which tests are slow
    slowTestThreshold: 5000,
  },
  resolve: {
    alias: {
      '@helpers': path.resolve(__dirname, 'src/helpers'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
      '@aggregator': path.resolve(__dirname, 'src/aggregator'),
    },
  },
});
