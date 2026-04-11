#!/usr/bin/env bash
set -euo pipefail

# Validates cross-artifact consistency across all Automation OS spec files

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

SCOPE="docs/scope-manifest.json"
DATA="docs/data-relationships.json"
SERVICE="docs/service-contracts.json"

for f in "$SCOPE" "$DATA" "$SERVICE"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify service-contracts entitiesReferenced use table names from data-relationships
SERVICE_ENTITIES=$(jq -r '[.endpoints[].entitiesReferenced[]] | unique[]' "$SERVICE")
DATA_TABLES=$(jq -r '.tables[].name' "$DATA")
for entity in $SERVICE_ENTITIES; do
  found=false
  for table in $DATA_TABLES; do
    if [ "$table" = "$entity" ]; then found=true; break; fi
  done
  if [ "$found" = "false" ]; then
    classify_and_exit BLOCKING "service-contracts references entity '$entity' not found in data-relationships tables"
  fi
done

# Forward FK check: scope-manifest relationships must match data-relationships FK columns
SCOPE_FIELDS=$(jq -r '.relationships[].field' "$SCOPE")
FK_COLUMNS=$(jq -r '[.tables[].columns[] | select(has("references")) | .name] | unique[]' "$DATA")
for field in $SCOPE_FIELDS; do
  found=false
  for fk in $FK_COLUMNS; do
    if [ "$fk" = "$field" ]; then found=true; break; fi
  done
  if [ "$found" = "false" ]; then
    classify_and_exit BLOCKING "scope-manifest relationship field '$field' has no FK column with .references in data-relationships"
  fi
done

# Invite-only: no POST /api/auth/register in service-contracts
REGISTER_ENDPOINT=$(jq '[.endpoints[] | select(.path == "/api/auth/register" and .method == "POST")] | length' "$SERVICE")
if [ "$REGISTER_ENDPOINT" -gt 0 ]; then
  classify_and_exit BLOCKING "invite_only onboarding violation: POST /api/auth/register found in service-contracts (VIOLATION #14)"
fi

# Invite accept endpoint must exist
INVITE_ENDPOINT=$(jq '[.endpoints[] | select(.path == "/api/auth/invite/accept" and .method == "POST")] | length' "$SERVICE")
if [ "$INVITE_ENDPOINT" -eq 0 ]; then
  classify_and_exit BLOCKING "invite_only onboarding requires POST /api/auth/invite/accept in service-contracts"
fi

classify_and_exit OK "Cross-artifact consistency validated. Entity refs, FK alignment, invite-only compliance confirmed."
