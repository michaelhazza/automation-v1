/**
 * rlsBoundaryGuard — Sprint 2 P1.1 Layer 1 runtime write-boundary guard.
 *
 * Spec: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §A2 Phase 3
 *
 * This module is a defence-in-depth wrapper layered on top of `getOrgScopedDb`
 * and `withAdminConnection`. It does NOT replace either primitive — it
 * intercepts writes via a transparent Proxy to assert two invariants in
 * dev/test only:
 *
 *   1. Every write to a tenant-scoped table (one whose schema declares
 *      `organisation_id`) goes through a registered enforcement point. Tables
 *      that have `organisation_id` but no RLS policy live in
 *      `scripts/rls-not-applicable-allowlist.txt`. Anything else throws
 *      `RlsBoundaryUnregistered`.
 *
 *   2. `withAdminConnectionGuarded({ allowRlsBypass: false }, fn)` rejects
 *      writes to RLS-protected tables — the caller must affirmatively
 *      declare cross-org intent via `allowRlsBypass: true` (with an inline
 *      justification comment enforced by `scripts/verify-rls-protected-tables.sh`).
 *      Otherwise it throws `RlsBoundaryAdminWriteToProtectedTable`.
 *
 * Production behaviour: ALL checks no-op when `process.env.NODE_ENV ===
 * 'production'`. The Postgres RLS policy itself is the ground truth in prod;
 * runtime guards are dev-time aids that surface a bypass attempt loudly
 * BEFORE it reaches a production database where the policy would silently
 * return zero rows.
 *
 * Proxy semantics: the Proxy intercepts `.insert(table)`, `.update(table)`,
 * and `.delete(table)` only. It calls `assertRlsAwareWrite(tableName)` and
 * then forwards arguments unchanged to the underlying handle. The chained
 * builder API (`.values(...).returning(...)`) is preserved verbatim — the
 * Proxy does not wrap the return value or alter method signatures.
 *
 * Coverage gap (intentional): writes that go through `.execute(sql\`...\`)`
 * are not seen by the Proxy. The advisory grep check inside
 * `scripts/verify-rls-protected-tables.sh` flags suspicious raw-SQL writes
 * near tenant tables; service-layer code that needs raw SQL on a tenant
 * table must call `assertRlsAwareWrite('<table>')` immediately before the
 * write executes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { withAdminConnection } from './adminDbConnection.js';
// guard-ignore-next-line: rls-contract-compliance reason="type-only import — OrgScopedTx is erased at compile time and issues no queries"
import type { OrgScopedTx } from '../db/index.js';
import { RLS_PROTECTED_TABLE_NAMES } from '../config/rlsProtectedTables.js';

// ── Errors ─────────────────────────────────────────────────────────────────

export class RlsBoundaryUnregistered extends Error {
  readonly code = 'rls_boundary_unregistered';
  constructor(public readonly tableName: string, source: string) {
    super(
      `[rls-boundary] Write to '${tableName}' (${source}): table is not registered in rlsProtectedTables and not in scripts/rls-not-applicable-allowlist.txt. ` +
        `Either add an RlsProtectedTable entry (with a CREATE POLICY in the matching migration), ` +
        `or add the table to the allowlist with a one-line rationale.`,
    );
    this.name = 'RlsBoundaryUnregistered';
  }
}

export class RlsBoundaryAdminWriteToProtectedTable extends Error {
  readonly code = 'rls_boundary_admin_write_to_protected_table';
  constructor(public readonly tableName: string, source: string) {
    super(
      `[rls-boundary] Admin write to RLS-protected table '${tableName}' (${source}): ` +
        `withAdminConnectionGuarded({ allowRlsBypass: false }, ...) cannot write to a tenant-scoped table. ` +
        `If this write is a deliberate cross-org operation (migration backfill, retention pruner, audit-replay tooling), ` +
        `pass { allowRlsBypass: true } and add a '// allowRlsBypass: <one-sentence justification>' comment within +/-1 line.`,
    );
    this.name = 'RlsBoundaryAdminWriteToProtectedTable';
  }
}

// ── Allowlist loading ──────────────────────────────────────────────────────

let cachedAllowlist: ReadonlySet<string> | null = null;

function isProductionMode(): boolean {
  return process.env.NODE_ENV === 'production';
}

function resolveAllowlistPath(): string {
  // ESM-safe relative resolution: this file lives at server/lib/, so the
  // allowlist is two directories up at scripts/rls-not-applicable-allowlist.txt.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'scripts', 'rls-not-applicable-allowlist.txt');
}

/**
 * Read and cache the allowlist contents. Reads on first call only; subsequent
 * calls return the cached set. The cache is cleared by `__resetAllowlistForTests`.
 */
function loadAllowlist(): ReadonlySet<string> {
  if (cachedAllowlist) return cachedAllowlist;

  const tables = new Set<string>();
  try {
    const raw = readFileSync(resolveAllowlistPath(), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) continue;
      const firstToken = trimmed.split(/\s+/)[0];
      if (firstToken) tables.add(firstToken);
    }
  } catch {
    // Allowlist missing -> treat as empty. The CI gate will catch missing
    // file separately.
  }

  cachedAllowlist = tables;
  return cachedAllowlist;
}

/**
 * Test-only: reset the cached allowlist so a test can stub the file or
 * exercise the lazy-load path.
 */
export function __resetAllowlistForTests(override?: ReadonlySet<string>): void {
  cachedAllowlist = override ?? null;
}

// ── Public assertion ───────────────────────────────────────────────────────

/**
 * Throw `RlsBoundaryUnregistered` if `tableName` is not in
 * `rlsProtectedTables` and not in `rls-not-applicable-allowlist.txt`.
 *
 * No-op in production. Intended for service code that writes via raw
 * `.execute(sql\`...\`)` — the Proxy cannot see those writes, so the service
 * MUST call this assertion immediately before the write executes.
 *
 * @param tableName the physical Postgres table name being written
 * @param source short caller tag for diagnostics (default: `'unknown'`)
 */
export function assertRlsAwareWrite(
  tableName: string,
  source: string = 'unknown',
): void {
  if (isProductionMode()) return;
  if (RLS_PROTECTED_TABLE_NAMES.has(tableName)) return;
  if (loadAllowlist().has(tableName)) return;
  throw new RlsBoundaryUnregistered(tableName, source);
}

// ── Proxy interception ─────────────────────────────────────────────────────

/**
 * Extract the physical Postgres table name from a Drizzle table object. The
 * canonical Drizzle table carries a Symbol-keyed `Table.Symbol.Name` slot, but
 * we reach in defensively — string `name` / `_.name` slots are also supported
 * for test mocks. Returns null if no name can be derived.
 */
function extractTableName(table: unknown): string | null {
  if (!table || typeof table !== 'object') return null;
  const t = table as Record<string | symbol, unknown> & {
    _?: { name?: unknown; baseName?: unknown };
  };
  // 1. Common Drizzle internal: `{ _: { name: 'foo' } }` (used by pgTable).
  if (t._ && typeof t._.name === 'string') return t._.name;
  if (t._ && typeof t._.baseName === 'string') return t._.baseName;
  // 2. Direct `name` field (used by mocks and some adapters).
  if (typeof t.name === 'string') return t.name;
  // 3. Symbol-keyed Drizzle table name (newer versions).
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (sym.description === 'TableName') {
      const v = t[sym];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

interface BoundaryOptions {
  /** Caller tag forwarded to the thrown errors for diagnostics. */
  source: string;
  /**
   * Treat writes to RLS-protected tables as bypass attempts. When `true`,
   * the guard allows the write (caller declared cross-org intent). When
   * `false`, writes to protected tables throw
   * `RlsBoundaryAdminWriteToProtectedTable`.
   *
   * `getOrgScopedDb` handles always pass `false` (an org-scoped tx writes
   * within RLS by construction; protected tables are the expected target).
   */
  allowRlsBypass: boolean;
  /**
   * `'org-scoped'`: tenant writes to protected tables are EXPECTED. Only
   * unregistered tables (not in registry, not in allowlist) throw.
   * `'admin'`: writes to protected tables throw unless `allowRlsBypass` is
   * `true`. Unregistered tables still throw `RlsBoundaryUnregistered`.
   */
  mode: 'org-scoped' | 'admin';
}

function checkWrite(tableName: string, options: BoundaryOptions): void {
  if (isProductionMode()) return;

  const isProtected = RLS_PROTECTED_TABLE_NAMES.has(tableName);
  const isAllowlisted = loadAllowlist().has(tableName);

  // Unregistered + non-allowlisted -> always throw.
  if (!isProtected && !isAllowlisted) {
    throw new RlsBoundaryUnregistered(tableName, options.source);
  }

  // Admin mode + protected table + bypass not declared -> throw.
  if (options.mode === 'admin' && isProtected && !options.allowRlsBypass) {
    throw new RlsBoundaryAdminWriteToProtectedTable(tableName, options.source);
  }

  // Otherwise (org-scoped writing protected, admin writing allowlisted, or
  // admin writing protected with bypass declared) — pass.
}

/**
 * Wrap a Drizzle handle in a transparent Proxy that intercepts `.insert(t)`,
 * `.update(t)`, and `.delete(t)` calls. On each call, the table name is
 * extracted and `checkWrite` runs before forwarding to the underlying method
 * with arguments and return value unchanged. All other methods (`.select`,
 * `.transaction`, `.execute`, etc.) are forwarded verbatim.
 *
 * In production this returns the handle unchanged (zero proxy overhead).
 */
export function wrapWithBoundary<T extends object>(
  handle: T,
  options: BoundaryOptions,
): T {
  if (isProductionMode()) return handle;

  return new Proxy(handle, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (prop !== 'insert' && prop !== 'update' && prop !== 'delete') {
        return original;
      }
      if (typeof original !== 'function') {
        return original;
      }
      return function guardedWriteMethod(this: unknown, table: unknown, ...rest: unknown[]) {
        const tableName = extractTableName(table);
        if (tableName) {
          checkWrite(tableName, options);
        }
        // Forward to the original method with its original receiver. Using
        // .apply preserves the chained-builder return value.
        return (original as (...args: unknown[]) => unknown).apply(target, [table, ...rest]);
      };
    },
  }) as T;
}

// ── Org-scoped wrapping ─────────────────────────────────────────────────────

/**
 * Wrap an org-scoped tx handle in the boundary Proxy. Use this if you have a
 * raw `OrgScopedTx` from `getOrgScopedDb` and want the dev-time guard. Most
 * service code does not need this directly — the recommendation is to call
 * `getOrgScopedDb('<service>')` and pass the returned handle to this helper
 * at function entry.
 *
 * No-op in production.
 */
export function withOrgScopedBoundary(
  handle: OrgScopedTx,
  source: string,
): OrgScopedTx {
  return wrapWithBoundary(handle, {
    source,
    // Org-scoped handles already operate within `withOrgTx`'s
    // `app.organisation_id` binding; protected-table writes are expected.
    allowRlsBypass: false,
    mode: 'org-scoped',
  });
}

// ── Admin wrapping ─────────────────────────────────────────────────────────

export interface AdminConnectionGuardedOptions {
  /** Short machine-readable tag identifying the caller. */
  source: string;
  /** Optional free-form reason logged to audit_events. */
  reason?: string;
  /** Skip the audit log write — forwarded to `withAdminConnection`. */
  skipAudit?: boolean;
  /**
   * Affirmative declaration that this admin transaction will write across
   * organisations (migration backfill, retention pruner, audit-replay tooling).
   * Default: `false` — writes to RLS-protected tables throw
   * `RlsBoundaryAdminWriteToProtectedTable`.
   *
   * Every call site that passes `true` MUST carry an inline `// allowRlsBypass: <justification>`
   * comment within +/-1 line. CI enforces the comment via
   * `scripts/verify-rls-protected-tables.sh`.
   *
   * The flag is the intent declaration ONLY. The caller is still responsible
   * for the actual `await tx.execute(sql\`SET LOCAL ROLE admin_role\`)` inside
   * the callback — see `withAdminConnection`'s contract.
   */
  allowRlsBypass: boolean;
}

/**
 * Run `fn` inside an admin transaction (via `withAdminConnection`) with the
 * boundary Proxy applied to the tx handle.
 *
 * Behaviour:
 *   - dev/test, `allowRlsBypass: false` (default): writes to RLS-protected
 *     tables throw `RlsBoundaryAdminWriteToProtectedTable`.
 *   - dev/test, `allowRlsBypass: true`: writes pass (caller declared
 *     cross-org intent). Unregistered + non-allowlisted writes still throw
 *     `RlsBoundaryUnregistered`.
 *   - production: no-op wrapper; behaves exactly like `withAdminConnection`.
 *
 * The unwrapped `withAdminConnection` is left in place for callers that have
 * not migrated. New code should use this helper.
 */
export async function withAdminConnectionGuarded<T>(
  options: AdminConnectionGuardedOptions,
  fn: (tx: OrgScopedTx) => Promise<T>,
): Promise<T> {
  return withAdminConnection(
    {
      source: options.source,
      reason: options.reason,
      skipAudit: options.skipAudit,
    },
    async (tx) => {
      const guarded = wrapWithBoundary(tx, {
        source: options.source,
        allowRlsBypass: options.allowRlsBypass,
        mode: 'admin',
      });
      return fn(guarded as OrgScopedTx);
    },
  );
}
