#!/usr/bin/env bash
set -euo pipefail

# Gate: No direct calls to syncConnector outside approved locations
# Approved: connectorPollingSync.ts, manual sync route

VIOLATIONS=$(grep -rn "syncConnector" server/services/ server/routes/ server/jobs/ \
  --include="*.ts" \
  | grep -v "connectorPollingSync.ts" \
  | grep -v "connectorPollingService.ts" \
  | grep -v "connectorConfigs.ts" \
  | grep -v "__tests__" \
  | grep -v "// verify-connector-scheduler: allowed" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Direct calls to syncConnector outside approved locations:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "PASS: verify-connector-scheduler"
