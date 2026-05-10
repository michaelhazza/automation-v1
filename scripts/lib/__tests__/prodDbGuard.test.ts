/**
 * prodDbGuard.test.ts
 *
 * Pure-function tests for assertDevTargetOrThrow.
 * No DB connection required — all cases are deterministic based on env inputs.
 *
 * Run via: npx vitest run scripts/lib/__tests__/prodDbGuard.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { assertDevTargetOrThrow } from '../prod-db-guard.js';

// Save and restore PROD_DB_HOST_DENYLIST between tests to prevent leakage.
const originalDenylist = process.env.PROD_DB_HOST_DENYLIST;
afterEach(() => {
  if (originalDenylist === undefined) {
    delete process.env.PROD_DB_HOST_DENYLIST;
  } else {
    process.env.PROD_DB_HOST_DENYLIST = originalDenylist;
  }
});

describe('assertDevTargetOrThrow — primary guard (NODE_ENV=production)', () => {
  it('NODE_ENV=production AND no DATABASE_URL → throw on primary guard', () => {
    expect(() => assertDevTargetOrThrow(undefined, 'production')).toThrow(
      'REFUSING TO RUN: NODE_ENV=production',
    );
  });

  it('NODE_ENV=production AND DATABASE_URL=postgresql://localhost/x → throw on primary guard (denylist not consulted)', () => {
    expect(() => assertDevTargetOrThrow('postgresql://localhost/x', 'production')).toThrow(
      'REFUSING TO RUN: NODE_ENV=production',
    );
  });
});

describe('assertDevTargetOrThrow — secondary guard (hardcoded denylist fragments)', () => {
  it("NODE_ENV=development AND DATABASE_URL contains 'supabase' → throw on secondary guard", () => {
    expect(() =>
      assertDevTargetOrThrow('postgresql://db.supabase.co/mydb', 'development'),
    ).toThrow('supabase');
  });

  it("NODE_ENV=development AND DATABASE_URL contains 'neon' → throw", () => {
    expect(() =>
      assertDevTargetOrThrow('postgresql://ep-cool.neon.tech/mydb', 'development'),
    ).toThrow('neon');
  });

  it("NODE_ENV=development AND DATABASE_URL contains 'render' → throw", () => {
    expect(() =>
      assertDevTargetOrThrow('postgresql://dpg-abc123.render.com/mydb', 'development'),
    ).toThrow('render');
  });

  it("NODE_ENV=development AND DATABASE_URL contains 'rds.amazonaws' → throw", () => {
    expect(() =>
      assertDevTargetOrThrow(
        'postgresql://mydb.cluster-abc.us-east-1.rds.amazonaws.com/mydb',
        'development',
      ),
    ).toThrow('rds.amazonaws');
  });

  it("NODE_ENV=development AND DATABASE_URL contains 'pooler.' → throw", () => {
    expect(() =>
      assertDevTargetOrThrow('postgresql://pooler.mydb.host.com/mydb', 'development'),
    ).toThrow('pooler.');
  });
});

describe('assertDevTargetOrThrow — safe case', () => {
  it('NODE_ENV=development AND DATABASE_URL=postgresql://localhost/dev → ok (no throw)', () => {
    expect(() =>
      assertDevTargetOrThrow('postgresql://localhost/dev', 'development'),
    ).not.toThrow();
  });
});

describe('assertDevTargetOrThrow — PROD_DB_HOST_DENYLIST env extension', () => {
  it("PROD_DB_HOST_DENYLIST='myhost.example.com' AND DATABASE_URL contains 'myhost.example.com' → throw", () => {
    process.env.PROD_DB_HOST_DENYLIST = 'myhost.example.com';
    expect(() =>
      assertDevTargetOrThrow('postgresql://myhost.example.com/mydb', 'development'),
    ).toThrow('myhost.example.com');
  });
});
