import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 10000,
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
