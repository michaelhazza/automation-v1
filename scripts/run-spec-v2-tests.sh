#!/usr/bin/env bash
# Tests for Org-Level Agents Spec v2.0 Implementation
# Validates: canonical metrics, metric registry, config-driven intelligence,
# intervention system, alert fatigue, template activation, data retention, org workspace

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
cd "$ROOT_DIR"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local condition="$2"
  if eval "$condition"; then
    echo "[PASS] $desc"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Spec v2.0 Implementation Tests ==="
echo ""

# ── Chunk A: Canonical Metrics Schema + Registry ─────────────────────────

echo "--- Chunk A: Canonical Metrics Schema + Registry ---"

check "canonicalMetrics schema exists" "[ -f server/db/schema/canonicalMetrics.ts ]"
check "metricDefinitions schema exists" "[ -f server/db/schema/metricDefinitions.ts ]"
check "metricRegistryService exists" "[ -f server/services/metricRegistryService.ts ]"
check "migration 0066 exists" "[ -f migrations/0066_canonical_metrics_and_registry.sql ]"

# Schema structure
check "canonicalMetrics has metricSlug field" "grep -q 'metric_slug' server/db/schema/canonicalMetrics.ts"
check "canonicalMetrics has periodType field" "grep -q 'period_type' server/db/schema/canonicalMetrics.ts"
check "canonicalMetrics has aggregationType field" "grep -q 'aggregation_type' server/db/schema/canonicalMetrics.ts"
check "canonicalMetrics has computationTrigger field" "grep -q 'computation_trigger' server/db/schema/canonicalMetrics.ts"
check "canonicalMetricHistory has isBackfill field" "grep -q 'is_backfill' server/db/schema/canonicalMetrics.ts"
check "canonicalMetricHistory has metricVersion field" "grep -q 'metric_version' server/db/schema/canonicalMetrics.ts"

# Metric definitions
check "metricDefinitions has status field (active/deprecated/removed)" "grep -q 'active.*deprecated.*removed' server/db/schema/metricDefinitions.ts"
check "metricDefinitions has dependsOn field" "grep -q 'depends_on' server/db/schema/metricDefinitions.ts"
check "metricDefinitions has version field" "grep -q 'version' server/db/schema/metricDefinitions.ts"

# Registry service
check "metricRegistryService has register method" "grep -q 'async register(' server/services/metricRegistryService.ts"
check "metricRegistryService has registerBatch method" "grep -q 'async registerBatch(' server/services/metricRegistryService.ts"
check "metricRegistryService has validateMetricSlugs method" "grep -q 'async validateMetricSlugs(' server/services/metricRegistryService.ts"
check "metricRegistryService handles deprecated metrics in validation" "grep -q \"deprecated\" server/services/metricRegistryService.ts"

# Schema exports
check "index.ts exports canonicalMetrics" "grep -q 'canonicalMetrics' server/db/schema/index.ts"
check "index.ts exports metricDefinitions" "grep -q 'metricDefinitions' server/db/schema/index.ts"

# Canonical data service extensions
check "canonicalDataService has upsertMetric method" "grep -q 'async upsertMetric(' server/services/canonicalDataService.ts"
check "canonicalDataService has appendMetricHistory method" "grep -q 'async appendMetricHistory(' server/services/canonicalDataService.ts"
check "canonicalDataService has getMetricValue method" "grep -q 'async getMetricValue(' server/services/canonicalDataService.ts"
check "canonicalDataService has getMetricHistoryBySlug method" "grep -q 'async getMetricHistoryBySlug(' server/services/canonicalDataService.ts"
check "canonicalDataService has getMetricHistoryCount method" "grep -q 'async getMetricHistoryCount(' server/services/canonicalDataService.ts"

# Health snapshots + anomaly events versioning
check "healthSnapshots has algorithmVersion column" "grep -q 'algorithm_version' server/db/schema/canonicalEntities.ts"
check "anomalyEvents has algorithmVersion column" "grep -qP 'algorithmVersion.*algorithm_version' server/db/schema/canonicalEntities.ts"

echo ""

# ── Chunk B: Adapter Metric Computation ──────────────────────────────────

echo "--- Chunk B: Adapter Metric Computation ---"

check "IntegrationAdapter has computeMetrics method" "grep -q 'computeMetrics' server/adapters/integrationAdapter.ts"
check "CanonicalMetricData type defined" "grep -q 'CanonicalMetricData' server/adapters/integrationAdapter.ts"
check "GHL adapter exports metric definitions" "grep -q 'GHL_METRIC_DEFINITIONS' server/adapters/ghlAdapter.ts"
check "GHL adapter implements computeMetrics" "grep -q 'computeGhlMetrics' server/adapters/ghlAdapter.ts"
check "GHL adapter defines contact_growth_rate metric" "grep -q 'contact_growth_rate' server/adapters/ghlAdapter.ts"
check "GHL adapter defines pipeline_velocity metric" "grep -q 'pipeline_velocity' server/adapters/ghlAdapter.ts"
check "GHL adapter defines conversation_engagement metric" "grep -q 'conversation_engagement' server/adapters/ghlAdapter.ts"
check "GHL adapter defines revenue_trend metric" "grep -q 'revenue_trend' server/adapters/ghlAdapter.ts"
check "GHL adapter defines platform_activity metric" "grep -q 'platform_activity' server/adapters/ghlAdapter.ts"

# Polling service wiring
check "connectorPollingService calls computeMetrics" "grep -q 'computeMetrics' server/services/connectorPollingService.ts"
check "connectorPollingService writes to canonical_metrics" "grep -q 'upsertMetric' server/services/connectorPollingService.ts"
check "connectorPollingService appends metric history" "grep -q 'appendMetricHistory' server/services/connectorPollingService.ts"
check "connectorPollingService handles isBackfill flag" "grep -q 'isBackfill' server/services/connectorPollingService.ts"
check "Metric computation failure does not fail sync" "grep -q 'Metric computation failed' server/services/connectorPollingService.ts"

echo ""

# ── Chunks C+D+E: Config-Driven Intelligence ────────────────────────────

echo "--- Chunks C+D+E: Config-Driven Intelligence ---"

check "orgConfigService exists" "[ -f server/services/orgConfigService.ts ]"
check "orgConfigService has getOperationalConfig" "grep -q 'async getOperationalConfig(' server/services/orgConfigService.ts"
check "orgConfigService has getHealthScoreFactors" "grep -q 'async getHealthScoreFactors(' server/services/orgConfigService.ts"
check "orgConfigService has getAnomalyConfig" "grep -q 'async getAnomalyConfig(' server/services/orgConfigService.ts"
check "orgConfigService has getChurnRiskSignals" "grep -q 'async getChurnRiskSignals(' server/services/orgConfigService.ts"
check "orgConfigService has getInterventionTypes" "grep -q 'async getInterventionTypes(' server/services/orgConfigService.ts"
check "orgConfigService has getAlertLimits" "grep -q 'async getAlertLimits(' server/services/orgConfigService.ts"
check "orgConfigService has getColdStartConfig" "grep -q 'async getColdStartConfig(' server/services/orgConfigService.ts"
check "orgConfigService has computeConfigVersion" "grep -q 'async computeConfigVersion(' server/services/orgConfigService.ts"

# Config types
check "HealthScoreFactor type has normalisation" "grep -q 'normalisation.*NormalisationConfig' server/services/orgConfigService.ts"
check "AnomalyConfig type has metricOverrides" "grep -q 'metricOverrides' server/services/orgConfigService.ts"
check "ChurnRiskSignal type defined" "grep -q 'interface ChurnRiskSignal' server/services/orgConfigService.ts"
check "InterventionType type has cooldownScope" "grep -q 'cooldownScope' server/services/orgConfigService.ts"
check "AlertLimits type defined" "grep -q 'interface AlertLimits' server/services/orgConfigService.ts"
check "ColdStartConfig type defined" "grep -q 'interface ColdStartConfig' server/services/orgConfigService.ts"
check "DataRetentionConfig type defined" "grep -q 'interface DataRetentionConfig' server/services/orgConfigService.ts"

# Intelligence skills are config-driven
check "intelligenceSkillExecutor imports orgConfigService" "grep -q 'orgConfigService' server/services/intelligenceSkillExecutor.ts"
check "intelligenceSkillExecutor has normaliseValue function" "grep -q 'function normaliseValue' server/services/intelligenceSkillExecutor.ts"
check "intelligenceSkillExecutor has evaluateSignal function" "grep -q 'async function evaluateSignal' server/services/intelligenceSkillExecutor.ts"
check "Health score reads factors from config" "grep -q 'getHealthScoreFactors' server/services/intelligenceSkillExecutor.ts"
check "Anomaly detection reads config" "grep -q 'getAnomalyConfig' server/services/intelligenceSkillExecutor.ts"
check "Churn risk reads signals from config" "grep -q 'getChurnRiskSignals' server/services/intelligenceSkillExecutor.ts"
check "Intervention validates type from config" "grep -q 'getInterventionTypes' server/services/intelligenceSkillExecutor.ts"

# No hardcoded metric slugs in intelligence executor
check "No hardcoded DEFAULT_WEIGHTS in intelligenceSkillExecutor" "! grep -q 'DEFAULT_WEIGHTS' server/services/intelligenceSkillExecutor.ts"
check "No hardcoded DEFAULT_ANOMALY_THRESHOLD in intelligenceSkillExecutor" "! grep -q 'DEFAULT_ANOMALY_THRESHOLD' server/services/intelligenceSkillExecutor.ts"
check "No hardcoded pipelineVelocity in intelligenceSkillExecutor" "! grep -q 'pipelineVelocity' server/services/intelligenceSkillExecutor.ts"

# Cold start
check "Health score has cold start check" "grep -q 'cold_start' server/services/intelligenceSkillExecutor.ts"
check "Health score returns null during cold start" "grep -q 'score.*null' server/services/intelligenceSkillExecutor.ts"

# Explainability
check "Health score returns explanation" "grep -q 'explanation:' server/services/intelligenceSkillExecutor.ts"
check "Anomaly detection returns explanation" "grep -q 'confidenceReasoning' server/services/intelligenceSkillExecutor.ts"
check "Churn risk returns explanation" "grep -q 'explanation' server/services/intelligenceSkillExecutor.ts"

# Normalisation types
check "Normalisation supports linear" "grep -q \"case 'linear'\" server/services/intelligenceSkillExecutor.ts"
check "Normalisation supports inverse_linear" "grep -q \"case 'inverse_linear'\" server/services/intelligenceSkillExecutor.ts"
check "Normalisation supports threshold" "grep -q \"case 'threshold'\" server/services/intelligenceSkillExecutor.ts"

# Signal types
check "Signal evaluator supports metric_trend" "grep -q \"case 'metric_trend'\" server/services/intelligenceSkillExecutor.ts"
check "Signal evaluator supports metric_threshold" "grep -q \"case 'metric_threshold'\" server/services/intelligenceSkillExecutor.ts"
check "Signal evaluator supports staleness" "grep -q \"case 'staleness'\" server/services/intelligenceSkillExecutor.ts"
check "Signal evaluator supports health_score_level" "grep -q \"case 'health_score_level'\" server/services/intelligenceSkillExecutor.ts"

echo ""

# ── Chunk F: Intervention System ─────────────────────────────────────────

echo "--- Chunk F: Intervention System ---"

check "interventionOutcomes schema exists" "[ -f server/db/schema/interventionOutcomes.ts ]"
check "accountOverrides schema exists" "[ -f server/db/schema/accountOverrides.ts ]"
check "interventionService exists" "[ -f server/services/interventionService.ts ]"
check "migration 0067 exists" "[ -f migrations/0067_intervention_outcomes_and_overrides.sql ]"

check "interventionService has checkCooldown" "grep -q 'async checkCooldown(' server/services/interventionService.ts"
check "interventionService has recordOutcome" "grep -q 'async recordOutcome(' server/services/interventionService.ts"
check "interventionService has getAccountOverride" "grep -q 'async getAccountOverride(' server/services/interventionService.ts"
check "interventionService has setAccountOverride" "grep -q 'async setAccountOverride(' server/services/interventionService.ts"
check "interventionService has clearExpiredOverrides" "grep -q 'async clearExpiredOverrides(' server/services/interventionService.ts"

check "Cooldown supports different scopes" "grep -q 'any_outcome' server/services/interventionService.ts"
check "Account overrides have expiry" "grep -q 'expiresAt' server/db/schema/accountOverrides.ts"

check "index.ts exports interventionOutcomes" "grep -q 'interventionOutcomes' server/db/schema/index.ts"
check "index.ts exports accountOverrides" "grep -q 'accountOverrides' server/db/schema/index.ts"

echo ""

# ── Chunk G: Alert Fatigue Guard ─────────────────────────────────────────

echo "--- Chunk G: Alert Fatigue Guard ---"

check "alertFatigueGuard exists" "[ -f server/services/alertFatigueGuard.ts ]"
check "AlertFatigueGuard class defined" "grep -q 'class AlertFatigueGuard' server/services/alertFatigueGuard.ts"
check "Guard checks per-run alert cap" "grep -q 'maxAlertsPerRun' server/services/alertFatigueGuard.ts"
check "Guard checks per-account-day cap" "grep -q 'maxAlertsPerAccountPerDay' server/services/alertFatigueGuard.ts"
check "Guard batches low priority" "grep -q 'batchLowPriority' server/services/alertFatigueGuard.ts"

echo ""

# ── Chunk H: Template Activation ─────────────────────────────────────────

echo "--- Chunk H: Template Activation ---"

check "systemTemplateService has loadToOrg method" "grep -q 'async loadToOrg(' server/services/systemTemplateService.ts"
check "loadToOrg validates metric slugs" "grep -q 'validateMetricSlugs' server/services/systemTemplateService.ts"
check "loadToOrg supports strict/lenient mode" "grep -q 'metricAvailabilityMode' server/services/systemTemplateService.ts"
check "loadToOrg seeds org memory" "grep -q 'memorySeedsJson' server/services/systemTemplateService.ts"
check "loadToOrg creates orgAgentConfigs" "grep -q 'orgAgentConfigs' server/services/systemTemplateService.ts"
check "loadToOrg returns structured result" "grep -q 'agentsProvisioned' server/services/systemTemplateService.ts"

echo ""

# ── Chunk I: Seeds ───────────────────────────────────────────────────────

echo "--- Chunk I: Portfolio Health Agent + GHL Template Seeds ---"

check "migration 0068 exists" "[ -f migrations/0068_portfolio_health_agent_seed.sql ]"
check "Portfolio Health Agent seed has correct slug" "grep -q 'portfolio-health-agent' migrations/0068_portfolio_health_agent_seed.sql"
check "Portfolio Health Agent has execution_scope org" "grep -q \"'org'\" migrations/0068_portfolio_health_agent_seed.sql"
check "GHL Agency Template seed exists" "grep -q 'GHL Agency Intelligence' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has healthScoreFactors config" "grep -q 'healthScoreFactors' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has churnRiskSignals config" "grep -q 'churnRiskSignals' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has interventionTypes config" "grep -q 'interventionTypes' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has alertLimits config" "grep -q 'alertLimits' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has coldStartConfig" "grep -q 'coldStartConfig' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has dataRetention config" "grep -q 'dataRetention' migrations/0068_portfolio_health_agent_seed.sql"
check "GHL template has required connector type ghl" "grep -q \"'ghl'\" migrations/0068_portfolio_health_agent_seed.sql"

echo ""

# ── Chunk J: Data Retention ──────────────────────────────────────────────

echo "--- Chunk J: Data Retention ---"

check "dataRetentionService exists" "[ -f server/services/dataRetentionService.ts ]"
check "dataRetentionService has cleanupForOrg method" "grep -q 'async cleanupForOrg(' server/services/dataRetentionService.ts"
check "Retention respects null (skip)" "grep -q 'null' server/services/dataRetentionService.ts"

echo ""

# ── Chunk K: Phase 5 Org Workspace ───────────────────────────────────────

echo "--- Chunk K: Phase 5 Org Workspace ---"

check "migration 0069 exists" "[ -f migrations/0069_org_workspace_nullable.sql ]"
check "Tasks subaccountId made nullable" "grep -q 'tasks.*DROP NOT NULL' migrations/0069_org_workspace_nullable.sql"
check "Scheduled tasks subaccountId made nullable" "grep -q 'scheduled_tasks.*DROP NOT NULL' migrations/0069_org_workspace_nullable.sql"
check "Agent triggers subaccountId made nullable" "grep -q 'agent_triggers.*DROP NOT NULL' migrations/0069_org_workspace_nullable.sql"
check "Org-only partial indexes created" "grep -q 'WHERE subaccount_id IS NULL' migrations/0069_org_workspace_nullable.sql"
check "orgWorkspace routes exist" "[ -f server/routes/orgWorkspace.ts ]"

echo ""

# ── Generic Abstraction Validation ───────────────────────────────────────

echo "--- Generic Abstraction Validation ---"

check "No GHL references in intelligenceSkillExecutor" "! grep -qi 'ghl\|goHighLevel' server/services/intelligenceSkillExecutor.ts"
check "No GHL references in orgConfigService" "! grep -qi 'ghl\|goHighLevel' server/services/orgConfigService.ts"
check "No GHL references in metricRegistryService" "! grep -qi 'ghl\|goHighLevel' server/services/metricRegistryService.ts"
check "No GHL references in interventionService" "! grep -qi 'ghl\|goHighLevel' server/services/interventionService.ts"
check "No GHL references in alertFatigueGuard" "! grep -qi 'ghl\|goHighLevel' server/services/alertFatigueGuard.ts"
check "No GHL references in dataRetentionService" "! grep -qi 'ghl\|goHighLevel' server/services/dataRetentionService.ts"
check "No GHL references in orgWorkspace routes" "! grep -qi 'ghl\|goHighLevel' server/routes/orgWorkspace.ts"
check "No hardcoded metric enums in platform services" "! grep -qP 'contact_growth_rate|pipeline_velocity|conversation_engagement' server/services/intelligenceSkillExecutor.ts"

echo ""

# ── Spec v2.0 Document ──────────────────────────────────────────────────

echo "--- Spec v2.0 Document ---"

check "Spec v2.0 exists" "[ -f tasks/org-level-agents-full-spec-v2.md ]"
check "Spec v1.0 removed" "[ ! -f tasks/org-level-agents-full-spec.md ]"
check "Spec mentions canonical_metrics" "grep -q 'canonical_metrics' tasks/org-level-agents-full-spec-v2.md"
check "Spec mentions metric_definitions" "grep -q 'metric_definitions' tasks/org-level-agents-full-spec-v2.md"
check "Spec mentions intervention_outcomes" "grep -q 'intervention_outcomes' tasks/org-level-agents-full-spec-v2.md"
check "Spec mentions account overrides" "grep -qi 'account.*override' tasks/org-level-agents-full-spec-v2.md"
check "Spec has Shopify template example" "grep -q 'Shopify Store Intelligence' tasks/org-level-agents-full-spec-v2.md"
check "Spec has cold start behaviour" "grep -qi 'cold.start' tasks/org-level-agents-full-spec-v2.md"
check "Spec has alert fatigue guard" "grep -q 'Alert fatigue' tasks/org-level-agents-full-spec-v2.md"
check "Spec has output explainability" "grep -q 'explainability' tasks/org-level-agents-full-spec-v2.md"
check "Spec has data retention" "grep -q 'dataRetention' tasks/org-level-agents-full-spec-v2.md"
check "Spec has intervention cooldown" "grep -q 'cooldown' tasks/org-level-agents-full-spec-v2.md"

echo ""
echo "=== Results ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Some tests failed!"
  exit 1
else
  echo "All tests passed!"
  exit 0
fi
