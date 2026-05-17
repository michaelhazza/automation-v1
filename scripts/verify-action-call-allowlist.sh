#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-action-call-allowlist.sh
#
# Introduced by docs/onboarding-playbooks-spec.md Final gates section.
#
# Enforces that every slug in ACTION_CALL_ALLOWED_SLUGS resolves to a
# registered handler — i.e. it appears in either:
#   - server/config/actionRegistry/*.ts  (mutation actions, post-refactor split)
#   - server/services/skillExecutor.ts   (read-only actions or direct handlers)
#
# Note (refactor-action-registry, 2026-05-10): server/config/actionRegistry.ts
# is now a 3-line re-export shim; the mutation entries live in per-domain
# modules under server/config/actionRegistry/ (e.g. configuration.ts). This
# gate scans that directory rather than the shim.
#
# A slug in the allowlist with no backing handler is a dead reference that
# would cause a silent runtime failure when a playbook step tries to invoke it.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="action-call-allowlist"
GUARD_NAME="Action-call allowlist slugs are backed by handlers"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0

emit_header "$GUARD_NAME"

ALLOWLIST_FILE="$ROOT_DIR/server/lib/workflow/actionCallAllowlist.ts"
REGISTRY_DIR="$ROOT_DIR/server/config/actionRegistry"
EXECUTOR_FILE="$ROOT_DIR/server/services/skillExecutor.ts"
EXECUTOR_DIR="$ROOT_DIR/server/services/skillExecutor"

if [ ! -f "$ALLOWLIST_FILE" ]; then
  echo "[GUARD] $GUARD_NAME: allowlist file not found at $ALLOWLIST_FILE"
  emit_summary 0 1
  exit 1
fi
if [ ! -d "$REGISTRY_DIR" ] || [ ! -f "$EXECUTOR_FILE" ]; then
  echo "[GUARD] $GUARD_NAME: required file(s) not found"
  emit_summary 0 1
  exit 1
fi

# Extract slugs from ACTION_CALL_ALLOWED_SLUGS set literal.
# Each slug appears as:   'some_slug',
SLUGS=$(grep -oP "(?<=')\bconfig_[a-z_]+(?=')" "$ALLOWLIST_FILE" 2>/dev/null || true)

if [ -z "$SLUGS" ]; then
  echo "  [warn] could not extract slugs from ACTION_CALL_ALLOWED_SLUGS — check regex"
  emit_summary 1 0
  exit 0
fi

SLUG_COUNT=0
MISSING_COUNT=0

while IFS= read -r slug; do
  [ -z "$slug" ] && continue
  SLUG_COUNT=$((SLUG_COUNT + 1))

  in_registry=0
  in_executor=0

  # Scan all per-domain registry modules for an entry-line match.
  # Entry shape after refactor: either "  slug: { ..." or "  slug: defineX({...})".
  grep -rqE "^\s+${slug}:" "$REGISTRY_DIR" 2>/dev/null && in_registry=1 || true
  # After feat/split-skillexecutor: slugs may live in the barrel (skillExecutor.ts)
  # OR in any handler-family module under server/services/skillExecutor/**.
  grep -q "${slug}:" "$EXECUTOR_FILE" 2>/dev/null && in_executor=1 || true
  if [ "$in_executor" -eq 0 ] && [ -d "$EXECUTOR_DIR" ]; then
    grep -rqE "['\"]?${slug}['\"]?\s*:" "$EXECUTOR_DIR" --include="*.ts" 2>/dev/null && in_executor=1 || true
  fi

  if [ "$in_registry" -eq 0 ] && [ "$in_executor" -eq 0 ]; then
    emit_violation "$GUARD_ID" "error" "$ALLOWLIST_FILE" "0" \
      "Slug '${slug}' is in ACTION_CALL_ALLOWED_SLUGS but has no entry in server/config/actionRegistry/ or skillExecutor.ts" \
      "Add an entry for '${slug}' to the relevant module under server/config/actionRegistry/ (mutations) or register it in skillExecutor.ts (reads)."
    MISSING_COUNT=$((MISSING_COUNT + 1))
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done <<< "$SLUGS"

echo "  Slugs checked: $SLUG_COUNT"
echo "  Missing handlers: $MISSING_COUNT"

emit_summary 1 "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
