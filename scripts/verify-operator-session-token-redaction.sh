#!/usr/bin/env bash
set -euo pipefail

# verify-operator-session-token-redaction.sh
#
# CI gate: asserts that accessToken / refreshToken properties are only
# read in the two permitted service files.
#
# Greps for TypeScript property accesses (.accessToken and .refreshToken)
# in server/ .ts files, excluding the two authorised files.
#
# Exits non-zero if any match is found outside the allowlist.
#
# This is CI-only — do NOT run locally during development.
#
# Spec: docs/operator-session-identity-spec.md §17.9

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ALLOWED_FILES=(
  "server/services/credentialBrokerService.ts"
  "server/services/connectionTokenService.ts"
)

VIOLATIONS=()

# Check for .accessToken property accesses
while IFS= read -r match; do
  rel="${match#"$ROOT_DIR/"}"
  allowed=false
  for f in "${ALLOWED_FILES[@]}"; do
    if [[ "$rel" == "$f" ]]; then
      allowed=true
      break
    fi
  done
  if [[ "$allowed" == false ]]; then
    VIOLATIONS+=("$rel")
  fi
done < <(grep -rn --include="*.ts" --exclude-dir=node_modules \
  '\.accessToken\b' \
  "$ROOT_DIR/server" 2>/dev/null | cut -d: -f1 | sort -u || true)

# Check for .refreshToken property accesses
while IFS= read -r match; do
  rel="${match#"$ROOT_DIR/"}"
  allowed=false
  for f in "${ALLOWED_FILES[@]}"; do
    if [[ "$rel" == "$f" ]]; then
      allowed=true
      break
    fi
  done
  if [[ "$allowed" == false ]]; then
    VIOLATIONS+=("$rel")
  fi
done < <(grep -rn --include="*.ts" --exclude-dir=node_modules \
  '\.refreshToken\b' \
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
  echo "ERROR: accessToken / refreshToken properties must not be read outside the permitted files."
  echo "Permitted: ${ALLOWED_FILES[*]}"
  echo "Violations found in:"
  for v in "${UNIQUE_VIOLATIONS[@]}"; do
    echo "  $v"
  done
  exit 1
fi

echo "OK: No unauthorised accessToken / refreshToken reads found."
exit 0
