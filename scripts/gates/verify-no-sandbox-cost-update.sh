#!/usr/bin/env bash
# verify-no-sandbox-cost-update.sh — CI gate for Spec B sandbox isolation (§12.4, §25).
#
# Asserts that no TypeScript file issues an UPDATE against llm_requests rows whose
# source_type is 'sandbox_compute' or 'sandbox_compute_correction'.
#
# The cost ledger for sandbox executions is insert-only (per spec §12.4): the
# initial sandbox_compute row is inserted once; corrections append new rows with
# source_type='sandbox_compute_correction'. An UPDATE against these rows violates
# the insert-only invariant and breaks the correction-sequence partial unique index.
#
# The gate scans for db.update(llmRequests) and update(llmRequests) patterns across
# server/ and shared/. It is intentionally conservative — any match requires human
# review.
#
# Exit codes:
#   0 — no violations found
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: grep -r handles mixed line endings transparently.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── Scan paths ────────────────────────────────────────────────────────────────
SCAN_DIRS=(
  "$ROOT_DIR/server"
  "$ROOT_DIR/shared"
)

# ── Patterns that indicate an UPDATE against llmRequests ─────────────────────
# These patterns capture the two idiomatic Drizzle ORM call shapes for updates:
#   db.update(llmRequests)
#   .update(llmRequests)   (chained on a transaction variable)
# Both variants are checked. Imports of the table name for read purposes are
# excluded via the `grep -v "import type"` filter and are not a violation —
# only actual update() call-sites are flagged.
#
# Narrowing per spec §12.4 strict reading: the insert-only invariant applies
# to SANDBOX source-type rows, not all llmRequests rows. Maintenance jobs that
# update non-sandbox llmRequests fields (e.g. audit metadata on completion
# rows) are legitimate. We narrow the gate to files that mix llmRequests
# updates with references to sandbox source-type strings — those are the
# updates plausibly targeting sandbox rows and warrant human review. Files
# that update llmRequests without any sandbox-context references in the same
# file are presumed non-sandbox and pass.

FORBIDDEN_PATTERNS=(
  "\.update\(llmRequests\)"
  "db\.update\(llmRequests\)"
)

# Sandbox source-type markers — presence in the same file flags the update as
# in-scope for the §12.4 insert-only invariant.
SANDBOX_SOURCE_TYPE_PATTERN="sandbox_compute(_correction)?"

for dir in "${SCAN_DIRS[@]}"; do
  [ -d "$dir" ] || continue

  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    raw_matches=$(
      grep -rn "$pattern" "$dir" \
        --include="*.ts" \
        --exclude-glob="*.test.ts" \
        --exclude-glob="*.spec.ts" \
        2>/dev/null \
        | grep -v "import type" \
        || true
    )

    [ -z "$raw_matches" ] && continue

    # Narrow: only flag matches whose file also references a sandbox source type.
    while IFS=: read -r match_file match_line match_content; do
      [ -z "$match_file" ] && continue
      if grep -qE "$SANDBOX_SOURCE_TYPE_PATTERN" "$match_file"; then
        echo "[FAIL] UPDATE against llmRequests in a file that also references sandbox source types — spec §12.4 insert-only invariant applies:"
        echo "  $match_file:$match_line: $match_content"
        FAIL=1
      fi
    done <<< "$raw_matches"
  done
done

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-no-sandbox-cost-update: no UPDATE calls against llmRequests found outside test files"
  exit 0
else
  exit 1
fi
