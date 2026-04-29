import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

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
      JWT_SECRET: 'ci-throwaway-jwt-secret-at-least-32-chars',
      EMAIL_FROM: 'ci@automation-os.local',
      NODE_ENV: 'test',
      SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS: '0.1',
      SYSTEM_INCIDENT_THROTTLE_MS: '100',
    },
    poolOptions: {
      threads: {
        maxThreads: Math.max(1, (os.cpus()?.length ?? 2) - 1),
        minThreads: 1,
      },
    },
    poolMatchGlobs: [
      ['scripts/__tests__/build-code-graph-watcher.test.ts', 'forks'],
    ],
    testTimeout: 30_000,
  },
});
