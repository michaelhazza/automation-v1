#!/usr/bin/env bash
set -euo pipefail

# verify-operator-session-consent-immutable.sh
#
# CI gate: asserts that operator_session_consents rows are never mutated
# outside the designated service file.
#
# Greps for both SQL-style UPDATE ... operator_session_consents and
# Drizzle-style .update(operatorSessionConsents) invocations in the
# codebase, excluding the one authorised service file.
#
# Exits non-zero if any match is found outside the allowlist.
#
# This is CI-only — do NOT run locally during development.
#
# Spec: docs/operator-session-identity-spec.md §12 Chunk 1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ALLOWED_FILE="server/services/operatorSessionConsentService.ts"

VIOLATIONS=()

# Check for SQL-style updates (case-insensitive to catch quoted identifiers)
while IFS= read -r match; do
  # Strip leading whitespace and the root dir prefix for display
  rel="${match#"$ROOT_DIR/"}"
  # Exclude the allowed service file
  if [[ "$rel" != "$ALLOWED_FILE" ]]; then
    VIOLATIONS+=("$rel")
  fi
done < <(grep -rn --include="*.ts" --exclude-dir=node_modules -i \
  "UPDATE.*operator_session_consents" \
  "$ROOT_DIR/server" 2>/dev/null | cut -d: -f1 | sort -u || true)

# Check for SQL-style updates in .sql files
while IFS= read -r match; do
  rel="${match#"$ROOT_DIR/"}"
  if [[ "$rel" != "$ALLOWED_FILE" ]]; then
    VIOLATIONS+=("$rel")
  fi
done < <(grep -rn --include="*.sql" -i \
  "UPDATE.*operator_session_consents" \
  "$ROOT_DIR/server" 2>/dev/null | cut -d: -f1 | sort -u || true)

# Check for Drizzle-style updates
while IFS= read -r match; do
  rel="${match#"$ROOT_DIR/"}"
  if [[ "$rel" != "$ALLOWED_FILE" ]]; then
    VIOLATIONS+=("$rel")
  fi
done < <(grep -rn --include="*.ts" --exclude-dir=node_modules \
  "\.update(operatorSessionConsents)" \
  "$ROOT_DIR/server" 2>/dev/null | cut -d: -f1 | sort -u || true)

# Deduplicate violations
UNIQUE_VIOLATIONS=()
declare -A seen
for v in "${VIOLATIONS[@]}"; do
  if [[ -z "${seen[$v]+_}" ]]; then
    seen[$v]=1
    UNIQUE_VIOLATIONS+=("$v")
  fi
done

if [[ "${#UNIQUE_VIOLATIONS[@]}" -gt 0 ]]; then
  echo "ERROR: operator_session_consents rows must not be mutated outside $ALLOWED_FILE."
  echo "Violations found in:"
  for v in "${UNIQUE_VIOLATIONS[@]}"; do
    echo "  $v"
  done
  exit 1
fi

echo "OK: No unauthorised mutations of operator_session_consents found."
exit 0
