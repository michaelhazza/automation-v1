#!/usr/bin/env bash
set -euo pipefail

# Gate: Every ActionDefinition must have readPath.
# liveFetch actions must have liveFetchRationale.

FILE="server/config/actionRegistry.ts"

# Count actions without readPath
MISSING_READ_PATH=$(grep -c "actionType:" "$FILE" || true)
HAS_READ_PATH=$(grep -c "readPath:" "$FILE" || true)

if [ "$MISSING_READ_PATH" -ne "$HAS_READ_PATH" ]; then
  echo "FAIL: $((MISSING_READ_PATH - HAS_READ_PATH)) actions missing readPath tag"
  echo "Total actions: $MISSING_READ_PATH, with readPath: $HAS_READ_PATH"
  exit 1
fi

# Check liveFetch actions have rationale
LIVE_FETCH_COUNT=$(grep -c "readPath: 'liveFetch'" "$FILE" || true)
RATIONALE_COUNT=$(grep -c "liveFetchRationale:" "$FILE" || true)

if [ "$LIVE_FETCH_COUNT" -gt "$RATIONALE_COUNT" ]; then
  echo "FAIL: $((LIVE_FETCH_COUNT - RATIONALE_COUNT)) liveFetch actions missing liveFetchRationale"
  exit 1
fi

echo "PASS: verify-skill-read-paths ($HAS_READ_PATH actions tagged)"
