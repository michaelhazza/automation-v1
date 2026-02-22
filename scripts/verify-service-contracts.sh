#!/usr/bin/env bash
set -euo pipefail

# Validates service-contracts.json API contract completeness for Automation OS

SPEC_FILE="docs/service-contracts.json"

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
  classify_and_exit BLOCKING "service-contracts.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "service-contracts-v2" ]; then
  classify_and_exit BLOCKING "service-contracts.json schema mismatch (expected: service-contracts-v2, got: $SCHEMA)"
fi

ENDPOINT_COUNT=$(jq '.endpoints | length' "$SPEC_FILE")
if [ "$ENDPOINT_COUNT" -lt 50 ]; then
  classify_and_exit BLOCKING "endpoint count too low (expected >= 50, got: $ENDPOINT_COUNT)"
fi

MISSING_CATEGORY=$(jq '[.endpoints[] | select(has("category") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_CATEGORY" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_CATEGORY endpoints missing 'category' field"
fi

MISSING_ENTITIES_REF=$(jq '[.endpoints[] | select(has("entitiesReferenced") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_ENTITIES_REF" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_ENTITIES_REF endpoints missing 'entitiesReferenced' field"
fi

ENTITY_EMPTY=$(jq '[.endpoints[] | select(.category == "entity" and (.entitiesReferenced | length) == 0)] | length' "$SPEC_FILE")
if [ "$ENTITY_EMPTY" -gt 0 ]; then
  classify_and_exit BLOCKING "$ENTITY_EMPTY entity-category endpoints have empty entitiesReferenced"
fi

INFRA_NONEMPTY=$(jq '[.endpoints[] | select(.category == "infrastructure" and (.entitiesReferenced | length) > 0)] | length' "$SPEC_FILE")
if [ "$INFRA_NONEMPTY" -gt 0 ]; then
  classify_and_exit BLOCKING "$INFRA_NONEMPTY infrastructure endpoints have non-empty entitiesReferenced"
fi

DELETE_MISSING=$(jq '[.endpoints[] | select(.method == "DELETE" and (has("deleteStrategy") | not))] | length' "$SPEC_FILE")
if [ "$DELETE_MISSING" -gt 0 ]; then
  classify_and_exit BLOCKING "$DELETE_MISSING DELETE endpoints missing deleteStrategy field"
fi

NON_DELETE_HAS=$(jq '[.endpoints[] | select(.method != "DELETE" and has("deleteStrategy"))] | length' "$SPEC_FILE")
if [ "$NON_DELETE_HAS" -gt 0 ]; then
  classify_and_exit BLOCKING "$NON_DELETE_HAS non-DELETE endpoints have forbidden deleteStrategy field"
fi

MISSING_SOURCE=$(jq '[.endpoints[].parameters[]? | select(has("source") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_SOURCE" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_SOURCE parameters missing 'source' field"
fi

REGISTER_ENDPOINT=$(jq '[.endpoints[] | select(.path == "/api/auth/register" and .method == "POST")] | length' "$SPEC_FILE")
if [ "$REGISTER_ENDPOINT" -gt 0 ]; then
  classify_and_exit BLOCKING "invite_only violation: POST /api/auth/register exists (VIOLATION #14)"
fi

classify_and_exit OK "service-contracts.json valid. $ENDPOINT_COUNT endpoints. All mandatory fields present. DELETE strategies correct. No register endpoint."
