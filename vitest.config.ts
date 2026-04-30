import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

const cpuCount = os.cpus()?.length ?? 2;
// In CI use all available CPUs; locally leave one free for the IDE/watcher.
const maxThreads = process.env.CI ? cpuCount : Math.max(1, cpuCount - 1);

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
      // Spawns real subprocesses + holds a singleton filesystem lock (up to 120s).
      // Not suitable for CI — tracked for refactor in tasks/todo.md TI-001.
      ...(process.env.CI ? ['scripts/__tests__/build-code-graph-watcher.test.ts'] : []),
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
        maxThreads,
        minThreads: 1,
      },
    },
    poolMatchGlobs: [
      ['scripts/__tests__/build-code-graph-watcher.test.ts', 'forks'],
    ],
    testTimeout: 30_000,
  },
});
