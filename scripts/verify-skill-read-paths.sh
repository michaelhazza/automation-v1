#!/usr/bin/env bash
set -euo pipefail

# Gate: Every ActionDefinition entry in ACTION_REGISTRY must have readPath.
# liveFetch actions must have liveFetchRationale.

FILE="server/config/actionRegistry.ts"

# Count literal action entries (actionType: '<name>') — excludes the interface
# definition, the methodology template variable, and function parameters.
ACTION_COUNT=$(grep -cE "actionType: '[a-z_]+'" "$FILE" || true)

# Count readPath entries, subtracting 2 non-entry occurrences:
#   1. The interface definition: readPath: 'canonical' | 'liveFetch' | 'none'
#   2. The methodology template:  readPath: 'none' as const (generated entries)
# This gives us the count of literal registry entries with readPath.
RAW_READ_PATH=$(grep -c "readPath:" "$FILE" || true)
ENTRY_READ_PATH=$((RAW_READ_PATH - 2))

# For the summary, count the methodology block as 1 entry on each side.
TOTAL_ACTIONS=$((ACTION_COUNT + 1))

if [ "$ACTION_COUNT" -ne "$ENTRY_READ_PATH" ]; then
  echo "FAIL: $((ACTION_COUNT - ENTRY_READ_PATH)) actions missing readPath tag"
  echo "Literal action entries: $ACTION_COUNT, with readPath: $ENTRY_READ_PATH"
  echo "[GATE] skill-read-paths: violations=$((ACTION_COUNT - ENTRY_READ_PATH))"
  exit 1
fi

# Check liveFetch actions have rationale
LIVE_FETCH_COUNT=$(grep -c "readPath: 'liveFetch'" "$FILE" || true)
RATIONALE_COUNT=$(grep -c "liveFetchRationale:" "$FILE" || true)

if [ "$LIVE_FETCH_COUNT" -gt "$RATIONALE_COUNT" ]; then
  echo "FAIL: $((LIVE_FETCH_COUNT - RATIONALE_COUNT)) liveFetch actions missing liveFetchRationale"
  echo "[GATE] skill-read-paths: violations=$((LIVE_FETCH_COUNT - RATIONALE_COUNT))"
  exit 1
fi

# +1 for the methodology block (generated, not literal)
echo "PASS: verify-skill-read-paths ($TOTAL_ACTIONS actions tagged, $LIVE_FETCH_COUNT liveFetch with rationale)"
echo "[GATE] skill-read-paths: violations=0"
