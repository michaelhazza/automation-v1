import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
  test: {
    include: [
      '**/__tests__/**/*.test.ts',
      'shared/lib/parseContextSwitchCommand.test.ts',
      'server/services/scopeResolutionService.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tools/mission-control/**',
      'worker/**',
    ],
    env: {
      JWT_SECRET: 'ci-throwaway-jwt-secret',
      EMAIL_FROM: 'ci@automation-os.local',
      NODE_ENV: 'test',
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    poolMatchGlobs: [
      ['scripts/__tests__/build-code-graph-watcher.test.ts', 'forks'],
    ],
    testTimeout: 30_000,
  },
});
