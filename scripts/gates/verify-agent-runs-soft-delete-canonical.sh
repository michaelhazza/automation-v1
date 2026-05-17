#!/usr/bin/env bash
set -euo pipefail
# advisory — checks that agent_runs.deleted_at is written only via softDeleteAgentRun()

VIOLATIONS=$(grep -rEn 'update\(agentRuns\)[^;]*deletedAt|agentRuns\..*deletedAt.*set' server/ \
  --include='*.ts' \
  --exclude-dir='__tests__' \
  | grep -v 'server/services/agentRunSoftDeleteService.ts' \
  | grep -v 'server/db/schema/agentRuns.ts' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "[advisory] Direct writes to agent_runs.deleted_at outside softDeleteAgentRun():"
  echo "$VIOLATIONS"
  exit 0  # advisory only — does not block CI
fi

echo "verify-agent-runs-soft-delete-canonical: clean"
exit 0
