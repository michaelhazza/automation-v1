import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  test: {
    name: 'client',
    root: '.',
    include: ['tests/client/**/*.test.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/client/setup.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['client/src/**'],
      exclude: ['client/src/main.tsx'],
    },
  },
});
