import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    root: '.',
    include: ['tests/server/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://postgres:Tyeahzilly!32@localhost:5432/automation_os_test',
      JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
      EMAIL_FROM: 'test@test.com',
      NODE_ENV: 'test',
    },
    setupFiles: [],
    globalSetup: ['tests/setup/globalSetup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['server/services/**', 'server/lib/**', 'server/routes/**'],
      exclude: ['server/db/schema/**', 'server/skills/**'],
    },
  },
});
