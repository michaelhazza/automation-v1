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
      'server/services/*.test.ts',
      'client/src/lib/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tools/mission-control/**',
      // Spawns real subprocesses + holds a singleton filesystem lock (up to 120s).
      // Not suitable for CI — tracked for refactor in tasks/todo.md TI-001.
      ...(process.env.CI ? ['scripts/__tests__/build-code-graph-watcher.test.ts'] : []),
    ],
    env: {
      JWT_SECRET: 'ci-throwaway-jwt-secret-at-least-32-chars',
      EMAIL_FROM: 'ci@automation-os.local',
      // Default to 'test' but let the shell override (e.g. CI integration
      // job runs with NODE_ENV=integration to un-skip the *.integration.
      // test.ts files gated on `process.env.NODE_ENV === 'integration'`).
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS: '0.1',
      SYSTEM_INCIDENT_THROTTLE_MS: '100',
      // Permit pure tests to import server modules whose transitive imports
      // touch `lib/env.ts` — `envSchema.parse(process.env)` requires
      // DATABASE_URL even when the tests never open a real connection.
      // The `db` handle is still typically `vi.mock`-ed at the test level
      // for hot-path units; this default just lets the env parse succeed
      // so the import chain reaches the mock layer.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
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
