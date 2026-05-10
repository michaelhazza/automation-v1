#!/usr/bin/env bash
# CI-only gate — DO NOT run locally
# Verifies that the support-agent seed migration's default_system_skill_slugs
# does NOT include web_search or search_knowledge_base.
# Also verifies applied_template_slug is only written in the install service.

set -euo pipefail

MIGRATION="migrations/0314_support_agent_install.sql"
INSTALL_SERVICE="server/services/supportAgentInstallService.ts"

# Check for forbidden skills in the seed migration
if grep -qE '"web_search"|'"'"'web_search'"'"'' "$MIGRATION"; then
  echo "FAIL: seed migration contains web_search in default_system_skill_slugs" >&2
  exit 1
fi

if grep -qE '"search_knowledge_base"|'"'"'search_knowledge_base'"'"'' "$MIGRATION"; then
  echo "FAIL: seed migration contains search_knowledge_base in default_system_skill_slugs" >&2
  exit 1
fi

# Check that applied_template_slug is only mutated in the install service
MUTATION_COUNT=$(grep -rn "applied_template_slug" server/ --include="*.ts" | grep -v "$INSTALL_SERVICE" | grep -c "=" || true)
if [ "$MUTATION_COUNT" -gt 0 ]; then
  echo "FAIL: applied_template_slug is written outside the install service" >&2
  grep -rn "applied_template_slug" server/ --include="*.ts" | grep -v "$INSTALL_SERVICE" | grep "=" >&2
  exit 1
fi

echo "PASS: support-agent skill set gate passed"
