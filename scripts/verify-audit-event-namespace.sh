#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-audit-event-namespace.sh  (Phase 3 — B.4)
#
# Invariant: audit event names must be referenced via the auditEvent factory
# (auditEvent.auth.loginFailed, etc.) — never as raw string literals.
#
# Three-pass detection strategy:
#
#   Pass 1 — literal eventType in recordSecurityEvent/recordEvent call objects.
#     Pattern: recordSecurityEvent({ ... eventType: '<literal>' ... })
#     Any match fails immediately.
#
#   Pass 2 — direct `as SecurityAuditEventName` casts.
#     Pattern: `as SecurityAuditEventName` anywhere in server/.
#     Any match fails immediately. (Legitimate use is only the type definition
#     itself in shared/types/securityAuditEvents.ts, which is NOT in server/.)
#
#   Pass 3 — raw dotted event-name strings assigned to variables in files that
#     also call recordSecurityEvent.
#     Pattern A: `const <name> = '<a>.<b>.<c>'` in a file that contains recordSecurityEvent.
#     Scope: static patterns only — dynamic template literals out of scope.
#     Any match fails immediately.
#
# Allowlist: empty by design. Chunk A cleaned all legacy call sites.
#
# Known-bad fixtures:
#   scripts/fixtures/verify-audit-event-namespace-bad-pass1.txt  (Pass 1)
#   scripts/fixtures/verify-audit-event-namespace-bad-pass3.txt  (Pass 3)
#
# Exit codes: 0 = clean, 1 = first violation found
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Pass 1: literal eventType string in recordSecurityEvent / recordEvent ─────
# Note: [^}]* does not cross newlines — multi-line object literals with eventType:
# on a separate line are not caught. The TypeScript type system (SecurityEventInputV2)
# is the primary defence; this pass catches single-line literal bypasses only.

while IFS= read -r match; do
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  rel_path="${file#$ROOT_DIR/}"
  echo "verify-audit-event-namespace.sh: raw string literal 'eventType' in recordSecurityEvent call — use auditEvent factory member instead at ${rel_path}:${lineno}"
  exit 1
done < <(grep -rnE "record(Security|)Event\s*\(\s*\{[^}]*event[Tt]ype\s*:\s*['\"]" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

# ── Pass 2: `as SecurityAuditEventName` cast ────────────────────────────────

while IFS= read -r match; do
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  rel_path="${file#$ROOT_DIR/}"
  echo "verify-audit-event-namespace.sh: 'as SecurityAuditEventName' cast bypasses the auditEvent factory at ${rel_path}:${lineno}"
  exit 1
done < <(grep -rn "as SecurityAuditEventName" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

# ── Pass 3: raw dotted event-name string variable in recordSecurityEvent file ─
# For each file that calls recordSecurityEvent, check whether it also contains
# a static dotted-namespace string assignment: const x = 'a.b.c'

while IFS= read -r file; do
  rel_path="${file#$ROOT_DIR/}"

  # Find any `const <name> = '<a>.<b>.<c>'` assignment in the file
  # Note: `|| true` is required because grep exits 1 when there are no matches;
  # with pipefail that would trip set -e even though it is the expected empty case.
  match_line=$(grep -nE "const\s+\w+\s*=\s*['\"][a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*['\"]" "$file" 2>/dev/null | head -1 || true)
  if [ -z "$match_line" ]; then
    continue
  fi

  lineno=$(echo "$match_line" | cut -d: -f1)
  echo "verify-audit-event-namespace.sh: raw dotted event-name string assigned in file that calls recordSecurityEvent — use auditEvent factory instead at ${rel_path}:${lineno}"
  exit 1
done < <(grep -rl "recordSecurityEvent" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

exit 0
