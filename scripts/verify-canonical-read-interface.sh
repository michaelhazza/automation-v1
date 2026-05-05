#!/usr/bin/env bash
set -euo pipefail

# Gate: No raw Drizzle queries against canonical_* tables outside
# canonicalDataService.ts and approved adapter files.

CANONICAL_TABLES="canonical_accounts\|canonical_contacts\|canonical_opportunities\|canonical_conversations\|canonical_revenue\|canonical_metrics\|canonicalAccounts\|canonicalContacts\|canonicalOpportunities\|canonicalConversations\|canonicalRevenue\|canonicalMetrics"

VIOLATIONS=$(grep -rn "$CANONICAL_TABLES" \
  server/services/ server/routes/ server/jobs/ \
  --include="*.ts" \
  | grep -v "canonicalDataService" \
  | grep -v "canonicalDictionary" \
  | grep -v "connectorConfigService" \
  | grep -v "connectorPollingService" \
  | grep -v "intelligenceSkillExecutor" \
  | grep -v "webhooks/" \
  | grep -v "__tests__" \
  | grep -v "schema/" \
  | grep -v "index.ts" \
  | grep -v "// verify-canonical-read-interface: allowed" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Direct canonical table access outside canonicalDataService:"
  echo "$VIOLATIONS"
  echo "[GATE] canonical-read-interface: violations=1"
  exit 1
fi

echo "PASS: verify-canonical-read-interface"
echo "[GATE] canonical-read-interface: violations=0"
