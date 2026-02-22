#!/usr/bin/env bash
set -euo pipefail

# Validates multi-tenancy (organisation isolation) readiness for Automation OS

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

DATA="docs/data-relationships.json"
SCOPE="docs/scope-manifest.json"

for f in "$DATA" "$SCOPE"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify organisations table exists and is marked as 'container'
ORG_TENANT_KEY=$(jq -r '.tables[] | select(.name == "organisations") | .tenantKey // empty' "$DATA")
if [ "$ORG_TENANT_KEY" != "container" ]; then
  classify_and_exit BLOCKING "organisations table tenantKey must be 'container' (got: $ORG_TENANT_KEY)"
fi

# Verify all direct tenant tables have organisationId FK
DIRECT_TABLES=$(jq -r '.tables[] | select(.tenantKey == "direct") | .name' "$DATA")
for table in $DIRECT_TABLES; do
  has_org_fk=$(jq --arg t "$table" '
    [.tables[] | select(.name == $t) | .columns[] |
      select(.name == "organisationId" and has("references"))
    ] | length' "$DATA")
  if [ "$has_org_fk" -eq 0 ]; then
    classify_and_exit BLOCKING "Direct-tenant table '$table' missing organisationId FK with .references"
  fi
done

# Verify requiredFiltering covers executions, tasks, and users
REQUIRED_FILTER_TABLES=$(jq -r '.requiredFiltering[].table' "$DATA")
for required_table in "executions" "tasks" "users"; do
  found=false
  for table in $REQUIRED_FILTER_TABLES; do
    if [ "$table" = "$required_table" ]; then found=true; break; fi
  done
  if [ "$found" = "false" ]; then
    classify_and_exit BLOCKING "requiredFiltering missing entry for '$required_table' table"
  fi
done

DIRECT_COUNT=$(jq '[.tables[] | select(.tenantKey == "direct")] | length' "$DATA")
INDIRECT_COUNT=$(jq '[.tables[] | select(.tenantKey == "indirect")] | length' "$DATA")
NONE_COUNT=$(jq '[.tables[] | select(.tenantKey == "none")] | length' "$DATA")

classify_and_exit OK "Multi-tenancy readiness confirmed. organisations is container. $DIRECT_COUNT direct, $INDIRECT_COUNT indirect tenant tables. RequiredFiltering present."
