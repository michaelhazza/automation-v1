#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-audit-event-namespace.sh  (Phase 3 — B.4)
#
# Invariant: audit event names must be referenced via the auditEvent factory
# (auditEvent.auth.loginFailed, etc.) — never as raw string literals.
#
# Five-pass detection strategy:
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
#   Pass 4 — dynamic-construction patterns at recordSecurityEvent call sites.
#     Patterns flagged when found within an `eventType:` in a recordSecurityEvent
#     call (single-line scope only — multi-line objects rely on the type system):
#       (a) template-literal eventType:        eventType: `auth.login.${...}`
#       (b) string-concat eventType:           eventType: PREFIX + 'foo'  /  'auth' + variable
#     The TypeScript type (SecurityEventInputV2) is the canonical defence; this
#     pass closes the "clever string-build" escape hatch ChatGPT round-1 named.
#     Any match fails immediately.
#
#   Pass 5 — multi-line dynamic construction at recordSecurityEvent call sites.
#     CHATGPT-R3-6 closeout: Pass 4 only catches single-line eventType: values.
#     For object literals that span multiple lines (the dominant style in
#     this codebase), pull the 15-line window following the call and apply
#     the same template-literal / concat checks against the joined snippet.
#     Any match fails immediately.
#
# Allowlist: empty by design. Chunk A cleaned all legacy call sites.
#
# Known-bad fixtures:
#   scripts/fixtures/verify-audit-event-namespace-bad-pass1.txt  (Pass 1)
#   scripts/fixtures/verify-audit-event-namespace-bad-pass3.txt  (Pass 3)
#   scripts/fixtures/verify-audit-event-namespace-bad-pass4.txt  (Pass 4)
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

# ── Pass 4: dynamic eventType construction at recordSecurityEvent call sites ──
# Flags template-literal or string-concat eventType: values inside a single-line
# recordSecurityEvent call. Multi-line object literals are not caught — the type
# system (SecurityEventInputV2) is canonical there. This pass closes the
# clever-string-build escape hatch noted by chatgpt-pr-review round 1.

# Pass 4a — template literal: recordSecurityEvent({ ... eventType: `...` ... })
while IFS= read -r match; do
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  rel_path="${file#$ROOT_DIR/}"
  echo "verify-audit-event-namespace.sh: template-literal eventType in recordSecurityEvent call — use auditEvent factory member instead at ${rel_path}:${lineno}"
  exit 1
done < <(grep -rnE "record(Security|)Event\s*\(\s*\{[^}]*event[Tt]ype\s*:\s*\`" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

# Pass 4b — string concatenation: recordSecurityEvent({ ... eventType: X + Y ... })
# Catches `eventType: <ident> + ...` and `eventType: '...' + <ident>`.
while IFS= read -r match; do
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  rel_path="${file#$ROOT_DIR/}"
  echo "verify-audit-event-namespace.sh: string-concat eventType in recordSecurityEvent call — use auditEvent factory member instead at ${rel_path}:${lineno}"
  exit 1
done < <(grep -rnE "record(Security|)Event\s*\(\s*\{[^}]*event[Tt]ype\s*:\s*[^,}]*\+[^,}]+" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

# ── Pass 5: multi-line dynamic eventType construction ────────────────────────
# Closes the gap chatgpt-pr-review round 3 flagged as CHATGPT-R3-6: the
# Pass-4 single-line guard misses recordSecurityEvent calls where the object
# literal spans multiple lines, e.g.
#
#   await recordSecurityEvent({
#     organisationId,
#     eventType: `auth.login.${result}`,   // ← template literal
#     ...
#   });
#
# The strategy: for every recordSecurityEvent call site (any call-open
# shape), read the 15-line window following the call and check the JOINED
# snippet for the same dynamic-construction patterns Pass 4 catches
# single-line. Fifteen lines is generous — any object literal larger than
# that is itself a smell and would be caught the next time a reviewer
# reads the file.
#
# Pass 5 anchor: matches `recordSecurityEvent(` followed by optional
# whitespace, optional `{`, optional whitespace, and end-of-line — covers
# both `recordSecurityEvent({` (the dominant style) and the less-common
# `recordSecurityEvent(` newline `{` style. Pass 1 and Pass 4 already
# cover same-line eventType values, so the only multi-line case left for
# Pass 5 to catch is the one where eventType lives on a following line.

while IFS=: read -r file lineno _; do
  [ -z "$file" ] && continue
  rel_path="${file#$ROOT_DIR/}"
  snippet=$(sed -n "${lineno},$((lineno+15))p" "$file" | tr '\n' ' ')

  # Skip if the snippet does NOT contain an eventType: assignment (the
  # recordSecurityEvent call might be a passthrough wrapper without one in
  # the same object literal).
  if ! echo "$snippet" | grep -qE 'eventType[[:space:]]*:'; then
    continue
  fi

  # Skip if eventType: on the same line as recordSecurityEvent — that case
  # is owned by Pass 1 / Pass 4 (single-line); Pass 5 only fires for the
  # genuinely multi-line shape that Pass 1 / Pass 4 cannot see.
  same_line=$(sed -n "${lineno}p" "$file")
  if echo "$same_line" | grep -qE 'eventType[[:space:]]*:'; then
    continue
  fi

  # Template-literal in eventType across lines.
  if echo "$snippet" | grep -qE 'eventType[[:space:]]*:[[:space:]]*\`'; then
    echo "verify-audit-event-namespace.sh: multi-line template-literal eventType in recordSecurityEvent call — use auditEvent factory member instead at ${rel_path}:${lineno}"
    exit 1
  fi

  # String-concat in eventType across lines. Anchor on `eventType:` then a
  # token containing a + on the right-hand side.
  if echo "$snippet" | grep -qE 'eventType[[:space:]]*:[[:space:]]*[^,}]*[a-zA-Z_0-9'"'"'"]+[[:space:]]*\+[[:space:]]*[a-zA-Z_0-9'"'"'"]'; then
    echo "verify-audit-event-namespace.sh: multi-line string-concat eventType in recordSecurityEvent call — use auditEvent factory member instead at ${rel_path}:${lineno}"
    exit 1
  fi
done < <(grep -rnE "record(Security|)Event\s*\(\s*\{?\s*$" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

exit 0
