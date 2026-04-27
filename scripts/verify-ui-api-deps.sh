#!/usr/bin/env bash
set -euo pipefail

# Validates ui-api-deps.json page specification completeness for Automation OS

SPEC_FILE="docs/ui-api-deps.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; echo "[GATE] ui-api-deps: violations=0"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; echo "[GATE] ui-api-deps: violations=1"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; echo "[GATE] ui-api-deps: violations=0"; exit 2 ;;
    INFO) echo "[INFO] $message"; echo "[GATE] ui-api-deps: violations=0"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; echo "[GATE] ui-api-deps: violations=1"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "ui-api-deps.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "ui-api-deps-v2" ]; then
  classify_and_exit BLOCKING "ui-api-deps.json schema mismatch (expected: ui-api-deps-v2, got: $SCHEMA)"
fi

PAGE_COUNT=$(jq '.pages | length' "$SPEC_FILE")
if [ "$PAGE_COUNT" -ne 16 ]; then
  classify_and_exit BLOCKING "page count mismatch (expected: 16, got: $PAGE_COUNT)"
fi

LEGACY_PATH=$(jq '[.pages[] | select(has("path"))] | length' "$SPEC_FILE")
if [ "$LEGACY_PATH" -gt 0 ]; then
  classify_and_exit BLOCKING "$LEGACY_PATH pages use legacy 'path' instead of 'routePath'"
fi

LEGACY_API=$(jq '[.pages[] | select(has("apiDependencies"))] | length' "$SPEC_FILE")
if [ "$LEGACY_API" -gt 0 ]; then
  classify_and_exit BLOCKING "$LEGACY_API pages use legacy 'apiDependencies' instead of 'apiCalls'"
fi

MISSING_AUTH=$(jq '[.pages[] | select(has("authentication") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_AUTH" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_AUTH pages missing 'authentication' field"
fi

MISSING_DESC=$(jq '[.pages[] | select(has("description") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_DESC" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_DESC pages missing 'description' field"
fi

REGISTER_PAGE=$(jq '[.pages[] | select(.routePath == "/register")] | length' "$SPEC_FILE")
if [ "$REGISTER_PAGE" -gt 0 ]; then
  classify_and_exit BLOCKING "invite_only violation: /register page found in ui-api-deps (VIOLATION #14)"
fi

INVITE_PAGE=$(jq '[.pages[] | select(.routePath == "/invite/accept")] | length' "$SPEC_FILE")
if [ "$INVITE_PAGE" -eq 0 ]; then
  classify_and_exit BLOCKING "invite_only onboarding requires AcceptInvitePage at /invite/accept"
fi

MISSING_REQUIRED_FLAG=$(jq '[.pages[].apiCalls[]? | select(has("required") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_REQUIRED_FLAG" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_REQUIRED_FLAG apiCalls missing 'required' boolean"
fi

classify_and_exit OK "ui-api-deps.json valid. $PAGE_COUNT pages. Modern schema fields confirmed. Invite-only compliance verified."
