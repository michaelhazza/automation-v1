#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-event-type-registry.sh
#
# Enforces that every eventType string literal used in the system-monitor
# service layer is registered in the canonical registry:
#   shared/types/systemIncidentEvent.ts
#
# Gate scope: server/services/systemMonitor/**/*.ts and
#             server/services/systemIncidentService.ts
# (scoped to system-incident domain files to avoid flagging other event
# systems in the codebase that use different schemas).
#
# Excludes:
#   - import type lines (compile-time only)
#   - __tests__/ directories
#   - the canonical file itself
#
# SCAN_DIR override: set EVENT_TYPE_REGISTRY_SCAN_DIR for self-testing.
#
# Exit codes:  0 = pass, 1 = blocking violations found.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GATE_ID="event-type-registry"

CANONICAL="$ROOT_DIR/shared/types/systemIncidentEvent.ts"
if [ ! -f "$CANONICAL" ]; then
  echo "[BLOCKING] Canonical event type registry not found at: $CANONICAL"
  echo "[GATE] $GATE_ID: violations=1"
  exit 1
fi

# Extract all registered event type literals from the canonical file.
# Matches quoted strings inside the union definition (e.g. | 'ack' → ack).
REGISTERED_TYPES="$(grep -oE "'\''[a-z_]+'\''|'\"[a-z_]+\"'" "$CANONICAL" 2>/dev/null | tr -d "'\"" | sort -u || true)"
if [ -z "$REGISTERED_TYPES" ]; then
  # Try alternative quote pattern
  REGISTERED_TYPES="$(grep -oE "'[a-z_]+'" "$CANONICAL" | tr -d "'" | sort -u || true)"
fi

if [ -z "$REGISTERED_TYPES" ]; then
  echo "[BLOCKING] Could not extract event type literals from $CANONICAL"
  echo "[GATE] $GATE_ID: violations=1"
  exit 1
fi

# When using the real scan dirs, skip __tests__/ sub-directories.
# When SCAN_DIR is overridden (fixture mode), skip the exclusion.
SKIP_TESTS_DIR="${EVENT_TYPE_REGISTRY_SCAN_DIR:+no}"
SKIP_TESTS_DIR="${SKIP_TESTS_DIR:-yes}"

# Determine scan targets
if [ -n "${EVENT_TYPE_REGISTRY_SCAN_DIR:-}" ]; then
  SCAN_DIRS=("$EVENT_TYPE_REGISTRY_SCAN_DIR")
else
  SCAN_DIRS=(
    "$ROOT_DIR/server/services/systemMonitor"
    "$ROOT_DIR/server/services/systemIncidentService.ts"
  )
fi

VIOLATIONS=0

# Scan for eventType: 'literal' patterns
while IFS= read -r MATCH; do
  [ -z "$MATCH" ] && continue
  MATCH="$(echo "$MATCH" | tr -d '\r')"
  FILE="$(echo "$MATCH" | cut -d: -f1)"

  # Skip canonical file
  [[ "$FILE" == "$CANONICAL" ]] && continue

  # Skip __tests__/ when in normal mode
  if [ "$SKIP_TESTS_DIR" = "yes" ]; then
    echo "$FILE" | grep -q '/__tests__/' && continue
  fi

  # Skip import type lines
  LINE_CONTENT="$(echo "$MATCH" | cut -d: -f3-)"
  echo "$LINE_CONTENT" | grep -q 'import type' && continue

  # Extract the literal value
  LITERAL="$(echo "$LINE_CONTENT" | grep -oE "eventType:\s*'[a-z_]+'" | grep -oE "'[a-z_]+'" | tr -d "'")"
  [ -z "$LITERAL" ] && continue

  # Check against canonical registry
  if ! echo "$REGISTERED_TYPES" | grep -q "^${LITERAL}$"; then
    echo "[VIOLATION] Unregistered event type '$LITERAL' in: $FILE"
    echo "  -> $MATCH"
    echo "  Add '$LITERAL' to shared/types/systemIncidentEvent.ts"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(
  for TARGET in "${SCAN_DIRS[@]}"; do
    if [ -d "$TARGET" ]; then
      grep -rn "eventType:\s*'" "$TARGET" --include="*.ts" 2>/dev/null || true
    elif [ -f "$TARGET" ]; then
      grep -n "eventType:\s*'" "$TARGET" | sed "s|^|$TARGET:|" || true
    fi
  done
)

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "[GATE] $GATE_ID: violations=$VIOLATIONS"
  echo "[BLOCKING] $VIOLATIONS unregistered event type(s) found."
  echo "  Register all event types in shared/types/systemIncidentEvent.ts"
  exit 1
fi

echo "[GATE] $GATE_ID: violations=0"
echo "[PASS] All event type literals are registered in the canonical registry."
exit 0
