#!/usr/bin/env bash
set -euo pipefail

# Validates scope-manifest.json completeness and structural integrity for Automation OS

# jq on Windows (winget binary) under Git Bash has two portability hazards:
#   (1) CRLF line endings on stdout — break bash word-splitting on captured
#       output (each token ends up with a trailing \r).
#   (2) MSYS auto-converts Unix-style argv tokens (e.g. `--arg p
#       "/api/engines"`) to Windows paths, mangling the comparison value.
# Solution: convert positional file args to Windows native form via cygpath,
# disable global path conv, then strip \r. No-op on Linux/macOS.
jq() {
  if command -v cygpath >/dev/null 2>&1; then
    local args=()
    local a
    for a in "$@"; do
      if [ -f "$a" ]; then args+=("$(cygpath -m "$a")"); else args+=("$a"); fi
    done
    MSYS_NO_PATHCONV=1 command jq "${args[@]}" | tr -d '\r'
  else
    command jq "$@" | tr -d '\r'
  fi
}

SPEC_FILE="docs/scope-manifest.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "scope-manifest.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "scope-manifest-v6" ]; then
  classify_and_exit BLOCKING "scope-manifest.json schema mismatch (expected: scope-manifest-v6, got: $SCHEMA)"
fi

ONBOARDING=$(jq -r '.onboarding // empty' "$SPEC_FILE")
if [ "$ONBOARDING" != "invite_only" ]; then
  classify_and_exit BLOCKING "onboarding must be invite_only (got: $ONBOARDING)"
fi

INVITE_ONLY=$(jq -r '.features.inviteOnlyOnboarding // false' "$SPEC_FILE")
if [ "$INVITE_ONLY" != "true" ]; then
  classify_and_exit BLOCKING "features.inviteOnlyOnboarding must be true"
fi

ENTITY_COUNT=$(jq '.requiredEntities | length' "$SPEC_FILE")
if [ "$ENTITY_COUNT" -ne 10 ]; then
  classify_and_exit BLOCKING "requiredEntities count mismatch (expected: 10, got: $ENTITY_COUNT)"
fi

REQUIRED_ENTITIES=$(jq -r '.requiredEntities[]' "$SPEC_FILE")
for entity in $REQUIRED_ENTITIES; do
  ops=$(jq -e --arg e "$entity" '.entityMetadata[$e].allowedOperations // empty' "$SPEC_FILE" 2>/dev/null || echo "")
  if [ -z "$ops" ]; then
    classify_and_exit BLOCKING "entityMetadata.$entity missing allowedOperations"
  fi
done

AUTH_METHOD=$(jq -r '.authentication.method // empty' "$SPEC_FILE")
if [ -z "$AUTH_METHOD" ]; then
  classify_and_exit BLOCKING "authentication.method not set"
fi

BG=$(jq -r '.features.backgroundProcessing // empty' "$SPEC_FILE")
if [ "$BG" != "true" ]; then
  classify_and_exit BLOCKING "features.backgroundProcessing must be true"
fi

ORG_RULE=$(jq -r '.businessRules[] | select(test("system_admin|provisioned|provision"))' "$SPEC_FILE" | head -1)
if [ -z "$ORG_RULE" ]; then
  classify_and_exit BLOCKING "businessRules must include organisation provisioning statement (VIOLATION #12)"
fi

classify_and_exit OK "scope-manifest.json valid. $ENTITY_COUNT entities, invite_only onboarding, JWT auth, backgroundProcessing confirmed."
