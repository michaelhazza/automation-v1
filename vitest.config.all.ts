/**
 * Combined vitest config for running ALL tests (server + client) from the Test Control Center.
 * Uses node environment for server tests; client tests that need jsdom must use
 * inline `// @vitest-environment jsdom` comments.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  test: {
    name: 'all',
    root: '.',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    environment: 'node',
    globalSetup: ['tests/setup/globalSetup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://postgres:Tyeahzilly!32@localhost:5432/automation_os_test',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
      EMAIL_FROM: 'test@test.com',
      NODE_ENV: 'test',
    },
  },
});
