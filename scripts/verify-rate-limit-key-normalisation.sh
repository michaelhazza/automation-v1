#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-rate-limit-key-normalisation.sh  (Phase 3 — B.3)
#
# Invariant: no code outside the single canonical constructor may bypass the
# NormalisedEmail brand type using a direct `as NormalisedEmail` cast.
# The only legitimate cast site is the constructor itself in
# server/lib/rateLimitKeys.ts (grandfathered by the per-file allowlist).
#
# Background: NormalisedEmail is a branded string type introduced in Chunk D
# to ensure rate-limit keys are always built from normalised email addresses.
# Bypassing the brand via `as NormalisedEmail` defeats the type-level
# guarantee and may produce incorrectly-cased keys. All callers must use
# the normaliseEmail() constructor — never cast.
#
# Allowlist (exact file path, checked by line match):
#   server/lib/rateLimitKeys.ts  (the one legitimate cast site)
#
# Known-bad fixture: scripts/fixtures/verify-rate-limit-key-normalisation-bad.txt
#   — shows `loginEmailOnlyKey('foo@example.com' as NormalisedEmail)`
#
# Exit codes: 0 = clean, 1 = first violation found
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# The one file allowed to contain `as NormalisedEmail` (the constructor).
# If Chunk D has not landed yet, this file won't contain the cast either —
# the allowlist entry is harmless.
CONSTRUCTOR_FILE="server/lib/rateLimitKeys.ts"

while IFS= read -r match; do
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  rel_path="${file#$ROOT_DIR/}"

  # Allow the constructor file
  [[ "$rel_path" == "$CONSTRUCTOR_FILE" ]] && continue

  echo "verify-rate-limit-key-normalisation.sh: illegal 'as NormalisedEmail' cast bypasses normaliseEmail() constructor at ${rel_path}:${lineno}"
  exit 1
done < <(grep -rn "as NormalisedEmail" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

exit 0
