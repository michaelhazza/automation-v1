#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-pre-launch-invariants.sh   (CHATGPT-R3-1 closeout)
#
# Enforces four pre-launch hardening invariants that have not previously had
# a dedicated CI grep gate. Together with the existing B-series gates
# (verify-assert-active.sh, verify-no-raw-console.sh,
# verify-rate-limit-key-normalisation.sh, verify-audit-event-namespace.sh)
# this closes the "remaining 4 categories" tracked in tasks/todo.md as
# CHATGPT-R3-1.
#
# Each pass exits 1 on the first violation with a single-line message in
# `verify-pre-launch-invariants.sh: <problem> at <file:line>` form, matching
# the meta-rule from tasks/builds/pre-launch-phase-3-deferred-backlog/plan.md
# § Cross-cutting failure posture.
#
# Pass 1 — No new test categories (§4.5 of pre-launch-hardening-invariants.md).
#   Pattern: any `*.test.ts*` file importing from `playwright`, `supertest`,
#   `jest`, or `@testing-library/react`. The current phase only allows
#   Vitest unit tests + the three carved-out integration tests; no E2E,
#   no route-exercise, no frontend unit tests.
#
# Pass 2 — No feature-flag library introductions (§5.2).
#   Pattern: any `server/**/*.ts` importing or referencing `@growthbook/*`
#   or `unleash-client` packages, OR calling `.isOn(` namespaced through a
#   feature-flag handle (`gb`, `growthBook`, `featureFlag`, `featureFlags`),
#   OR calling our internal `featureFlag(` helper. The pre-launch rollout
#   model is `commit_and_revert` per docs/spec-context.md.
#
# Pass 3 — No introduce-then-defer stubs (§5.4).
#   Pattern: any `throw new Error('not implemented'…)` /
#   `throw new NotImplementedError(` in server runtime code (excluding
#   __tests__ / fixtures, which legitimately raise these for negative tests).
#   The pre-launch sprints either ship a primitive in scope or do not
#   propose it; mid-spec deferrals are a documented anti-pattern.
#
# Pass 4 — No `@ts-ignore` / `@ts-nocheck` in shipped server code (§3 of
#   pre-launch-hardening-invariants.md — Execution contract). These directives
#   silently bypass the TS type checker. The convention is `@ts-expect-error`
#   which itself fails as soon as the surrounding code is fixed — making the
#   suppression self-cleaning. Tests and fixtures may legitimately need the
#   blunter form to construct deliberately-malformed payloads; allowlist them.
#
# Allowlist suppressions use the standard `guard-ignore:` annotation
# (see scripts/lib/guard-utils.sh § Suppression Annotation Grammar).
# GUARD_ID = `pre-launch-invariants`.
#
# Exit codes: 0 = clean, 1 = first violation found.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="pre-launch-invariants"

# Helper: emit a single-line violation message and exit 1.
emit() {
  local pattern="$1"
  local file="$2"
  local lineno="$3"
  local rel_path="${file#$ROOT_DIR/}"
  echo "verify-pre-launch-invariants.sh: ${pattern} at ${rel_path}:${lineno}"
  exit 1
}

# Helper: filter out lines carrying a `guard-ignore: pre-launch-invariants`
# suppression on the same line. (The full annotation grammar — next-line,
# file-scoped, ADR shape — is intentionally NOT supported here; this gate
# is meant to be tripped, not papered over.)
filter_suppressions() {
  grep -v "guard-ignore:[[:space:]]*${GUARD_ID}" || true
}

# ── Pass 1: No new test categories ────────────────────────────────────────
# Bare `from 'playwright'` is fine in `scripts/playwright/**` (the IEE
# browser worker) and in agent-skill execution — neither path uses .test.ts
# names — so the glob-scoping to *.test.ts is sufficient.

while IFS= read -r match; do
  [ -z "$match" ] && continue
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  emit "forbidden test framework import (§4.5 — no playwright / supertest / jest / @testing-library in *.test.ts)" "$file" "$lineno"
done < <(grep -rnE "from\s+['\"](playwright|supertest|jest|@testing-library/react)['\"]" \
  "$ROOT_DIR" \
  --include="*.test.ts" --include="*.test.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | filter_suppressions)

# ── Pass 2: No feature-flag library introductions ─────────────────────────
# Three patterns: import of growthbook / unleash, member access `.isOn(`
# (the canonical GrowthBook API), or a call to our internal `featureFlag(`
# helper. The internal helper does not exist yet — flagging it pre-emptively
# catches an attempt to add one.

while IFS= read -r match; do
  [ -z "$match" ] && continue
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  emit "forbidden feature-flag introduction (§5.2 — commit_and_revert rollout model)" "$file" "$lineno"
done < <(grep -rnE "from\s+['\"](@growthbook/[^'\"]+|unleash-client)['\"]|\b(gb|growthBook|featureFlags?)\.isOn\s*\(|\bfeatureFlag\s*\(" \
  "$ROOT_DIR/server" \
  --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=__tests__ \
  2>/dev/null | filter_suppressions)

# ── Pass 3: No introduce-then-defer stubs ─────────────────────────────────
# `throw new Error('not implemented')` and friends in shipped runtime code.
# Tests (which raise these to assert negative paths) and fixtures are
# excluded.

while IFS= read -r match; do
  [ -z "$match" ] && continue
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  emit "introduce-then-defer stub (§5.4 — ship the primitive or do not propose it)" "$file" "$lineno"
done < <(grep -rnE "throw new (Error|NotImplementedError)\(\s*['\"](not[ _-]?implemented|TODO|stub)['\"]" \
  "$ROOT_DIR/server" \
  --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=__tests__ --exclude-dir=fixtures \
  2>/dev/null | filter_suppressions)

# ── Pass 4: No @ts-ignore / @ts-nocheck in shipped server code ────────────
# @ts-expect-error is the preferred form (self-cleaning) and is allowed.
# Tests and fixtures may use the blunter directives for negative-path setup.

while IFS= read -r match; do
  [ -z "$match" ] && continue
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  emit "@ts-ignore / @ts-nocheck in shipped code — use @ts-expect-error so the suppression is self-cleaning" "$file" "$lineno"
done < <(grep -rnE "@ts-(ignore|nocheck)" \
  "$ROOT_DIR/server" \
  --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=__tests__ --exclude-dir=fixtures \
  2>/dev/null | filter_suppressions)

exit 0
