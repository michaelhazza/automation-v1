# A2 — RLS write-boundary enforcement guard

**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §A2`
**Branch:** `claude/deferred-quality-fixes-ZKgVV`
**Mode:** all 3 phases bundled in one PR (per user instruction).

## Phase 1 — schema-vs-registry diff gate

Files shipped:

- `scripts/verify-rls-protected-tables.sh` — single gate with three checks:
  1. Schema-vs-registry diff (blocking from day 1).
  2. `allowRlsBypass: true` inline justification comment (blocking from day 1, per spec §A2 DoD Phase 3).
  3. Raw `.execute(sql)` near tenant tables without `assertRlsAwareWrite()` (advisory).
- `scripts/rls-not-applicable-allowlist.txt` — empty-by-default allowlist (every tenant table on `main` is registered).
- `scripts/__tests__/rls-protected-tables/README.md` + `unregistered-table-fixture.sql` — fixture documentation for the four failure modes.
- `server/config/rlsProtectedTables.ts:8` header comment fixed: `scripts/gates/verify-rls-coverage.sh` → `scripts/verify-rls-coverage.sh`.

Migration parsing handles Drizzle's multi-line `CREATE TABLE "<name>" ( ... );` shape via awk state machine (header detection + body accumulation + `\);` close). Same heuristic mirrored in the Phase 2 hook.

## Phase 2 — migration-time hook (advisory)

Files shipped:

- `.claude/hooks/rls-migration-guard.js` — PostToolUse hook on `Write|Edit|MultiEdit` to `migrations/*.sql`. Reads the saved file (defensive: any parse / IO error -> silent no-op exit 0). Always exits 0.
- `.claude/settings.json` — added `PostToolUse` matcher entry; preserved all existing PreToolUse + UserPromptSubmit hooks.

Defensive parsing of stdin: payload may be empty, missing fields, or shaped differently across Claude Code versions. Both `tool_input.file_path` and `tool_input.path` and `tool_input.edits[].file_path` shapes are handled.

## Phase 3 — runtime guard (dev/test)

Files shipped:

- `server/lib/rlsBoundaryGuard.ts` exports:
  - `assertRlsAwareWrite(tableName, source?)` — direct API for raw `.execute(sql)` paths.
  - `wrapWithBoundary(handle, options)` — generic Proxy wrapper used by both org-scoped and admin paths.
  - `withOrgScopedBoundary(handle, source)` — convenience for wrapping a `getOrgScopedDb` handle.
  - `withAdminConnectionGuarded(options, fn)` — drop-in replacement for `withAdminConnection` that enforces the bypass-intent declaration.
  - Errors: `RlsBoundaryUnregistered`, `RlsBoundaryAdminWriteToProtectedTable`.
- `server/lib/__tests__/rlsBoundaryGuard.test.ts` — 11 tests covering the 6 spec cases plus production-mode no-op + direct `assertRlsAwareWrite` API.

Production behaviour: every entry point checks `process.env.NODE_ENV === 'production'` and short-circuits to a no-op. `wrapWithBoundary` returns the original handle unchanged in production (no Proxy overhead). Tested by the `production mode: …` cases.

Proxy semantics:
- Intercepts `.insert(t)`, `.update(t)`, `.delete(t)` only.
- Extracts table name from Drizzle's `_.name` / `_.baseName` slots, with fallbacks for symbol-keyed names and direct `name` (mocks).
- Forwards arguments unchanged via `original.apply(target, [table, ...rest])`. The chained-builder return value (`.values(...).returning(...)`) is preserved verbatim — case 6 tests this.
- All other props/methods (`.select`, `.transaction`, `.execute`, arbitrary fields) are forwarded through `Reflect.get`.

## architecture.md update

Added the `**RLS write boundary.**` paragraph immediately above the existing `**Job concurrency + idempotency standard.**` paragraph in § Architecture Rules → Gate scripts (the cluster of cross-cutting standards). Mirrors the spec §A2 wording.

## Verification

Per user instruction: gates were NOT run as part of this build (focus on code dev). Final verification: `npm run typecheck` once at the very end.

## Open follow-ups

None at the time of shipping. The `allowRlsBypass: true` flag has zero call sites in the current codebase, so the blocking justification check has no rows to evaluate. Once Phase 3 callers migrate `withAdminConnection` -> `withAdminConnectionGuarded`, each new `allowRlsBypass: true` site lands with its inline justification comment in the same diff.
