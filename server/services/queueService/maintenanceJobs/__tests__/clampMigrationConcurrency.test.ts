// Pure unit tests for clampMigrationConcurrency.
// Closes Wave 3 deferred test + Wave 5 Session K PR #327 T2 helper.
//
// Runnable via:
//   npx vitest run server/services/queueService/maintenanceJobs/__tests__/clampMigrationConcurrency.test.ts

import { describe, it, expect } from 'vitest';
import {
  MIGRATION_CONCURRENCY_DEFAULT,
  MIGRATION_CONCURRENCY_MAX,
  clampMigrationConcurrency,
} from '../clampMigrationConcurrency.js';

describe('clampMigrationConcurrency', () => {
  it('non-numeric "abc" falls back to default', () => {
    expect(clampMigrationConcurrency('abc')).toBe(MIGRATION_CONCURRENCY_DEFAULT);
  });

  it('empty string falls back to default', () => {
    expect(clampMigrationConcurrency('')).toBe(MIGRATION_CONCURRENCY_DEFAULT);
  });

  it('undefined falls back to default', () => {
    expect(clampMigrationConcurrency(undefined)).toBe(MIGRATION_CONCURRENCY_DEFAULT);
  });

  it('negative "-5" falls back to default', () => {
    expect(clampMigrationConcurrency('-5')).toBe(MIGRATION_CONCURRENCY_DEFAULT);
  });

  it('upper-clamp: "1000" clamps to MAX', () => {
    expect(clampMigrationConcurrency('1000')).toBe(MIGRATION_CONCURRENCY_MAX);
  });

  it('float "3.7" floors to 3', () => {
    expect(clampMigrationConcurrency('3.7')).toBe(3);
  });

  it('valid in-range "12" returns 12', () => {
    expect(clampMigrationConcurrency('12')).toBe(12);
  });

  it('numeric input also works (not only strings)', () => {
    expect(clampMigrationConcurrency(20)).toBe(20);
    expect(clampMigrationConcurrency(0)).toBe(MIGRATION_CONCURRENCY_DEFAULT);
  });
});
