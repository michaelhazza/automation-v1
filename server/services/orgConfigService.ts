import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  organisations,
  systemHierarchyTemplates,
} from '../db/schema/index.js';
import { resolveEffectiveOperationalConfig } from './orgOperationalConfigMigrationPure.js';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Org Config Service — loads and merges operational config for an org.
//
// Session 1 / contract (h): the chain is
//   organisations.applied_system_template_id → system_hierarchy_templates
//     .operational_defaults
//   deep-merged with
//   organisations.operational_config_override
// The pre-Session-1 `hierarchy_templates.operational_config` source was
// retired — `hierarchy_templates.operational_config_seed` is a one-time
// informational snapshot, not a runtime source.
// ---------------------------------------------------------------------------

// ── Types ─────────────────────────────────────────────────────────────────

export interface NormalisationConfig {
  type: 'linear' | 'inverse_linear' | 'threshold' | 'percentile';
  minValue: number;
  maxValue: number;
  invertDirection?: boolean;
}

export interface HealthScoreFactor {
  metricSlug: string;
  weight: number;
  label: string;
  periodType?: string;
  normalisation: NormalisationConfig;
}

export interface AnomalyConfig {
  defaultThreshold: number;
  defaultWindowDays: number;
  metricOverrides: Record<string, { threshold: number; windowDays: number }>;
  seasonality: 'none' | 'day_of_week' | 'day_of_month' | 'monthly';
  minimumDataPoints: number;
  dedupWindowMinutes?: number;
}

export interface ChurnRiskSignal {
  signalSlug: string;
  weight: number;
  type: 'metric_trend' | 'metric_threshold' | 'staleness' | 'anomaly_count' | 'health_score_level';
  metricSlug?: string;
  condition?: string;
  periods?: number;
  thresholdValue?: number;
  maxDaysInactive?: number;
}

export interface InterventionType {
  slug: string;
  label: string;
  gateLevel: 'auto' | 'review';
  action: 'internal_notification' | 'connector_action' | 'create_task' | 'generate_draft' | 'send_email' | 'send_slack';
  connectorAction?: string;
  cooldownHours?: number;
  cooldownScope?: 'proposed' | 'executed' | 'any_outcome';

  // ── Phase 4 extensions (optional; existing templates stay valid) ──
  /** Registered actionType slug (e.g. `crm.send_email`); wins over legacy `action`. */
  actionType?: string;
  /** Which bands this template targets. Empty/undefined = all bands. */
  targets?: Array<'healthy' | 'watch' | 'atRisk' | 'critical'>;
  /** Priority for tie-breaking when multiple templates match. Higher wins. */
  priority?: number;
  /** How long after execution before outcome can be measured (hours). Default: 24. */
  measurementWindowHours?: number;
  /** Default payload to prefill into the action (editor can override). */
  payloadDefaults?: Record<string, unknown>;
  /** Human-readable reason surfaced on the proposed action + outcome history. */
  defaultReason?: string;
}

export interface AlertLimits {
  maxAlertsPerRun: number;
  maxAlertsPerAccountPerDay: number;
  batchLowPriority: boolean;
}

export interface ColdStartConfig {
  minimumDataPoints: number;
  allowHeuristicScoring: boolean;
  includeBackfillInBaseline?: boolean;
}

export interface DataRetentionConfig {
  metricHistoryDays: number | null;
  healthSnapshotDays: number | null;
  anomalyEventDays: number | null;
  orgMemoryDays: number | null;
  syncAuditLogDays: number | null;
  canonicalEntityDays: number | null;
}

// ── ClientPulse operational-config block types (§12.2 Gap A) ──────────────

export interface StaffActivityMutationType {
  type: string;
  weight: number;
}

export interface StaffActivityDefinition {
  countedMutationTypes: StaffActivityMutationType[];
  excludedUserKinds: Array<'automation' | 'contact' | 'unknown' | 'staff'>;
  automationUserResolution: {
    strategy: 'outlier_by_volume' | 'named_list';
    threshold: number;
    cacheMonths: number;
  };
  lookbackWindowsDays: number[];
  churnFlagThresholds: {
    zeroActivityDays: number;
    weekOverWeekDropPct: number;
  };
}

export interface IntegrationFingerprintPattern {
  type: 'conversation_provider_id' | 'workflow_action_type' | 'outbound_webhook_domain' | 'custom_field_prefix' | 'tag_prefix' | 'contact_source';
  value?: string;
  valuePattern?: string;
}

export interface IntegrationFingerprintSeed {
  integrationSlug: string;
  displayName: string;
  vendorUrl?: string;
  fingerprints: IntegrationFingerprintPattern[];
  confidence: number;
}

export interface IntegrationFingerprintConfig {
  seedLibrary: IntegrationFingerprintSeed[];
  scanFingerprintTypes: string[];
  unclassifiedSignalPromotion: {
    surfaceAfterOccurrenceCount: number;
    surfaceAfterSubaccountCount: number;
  };
}

export interface ChurnBands {
  healthy: [number, number];
  watch: [number, number];
  atRisk: [number, number];
  critical: [number, number];
}

export interface InterventionDefaults {
  cooldownHours: number;
  cooldownScope: 'proposed' | 'executed' | 'any_outcome';
  defaultGateLevel: 'auto' | 'review';
  maxProposalsPerDayPerSubaccount: number;
  maxProposalsPerDayPerOrg: number;
  /** Session 2 §5.5 — outcome-weighted recommendation trial floor (default 5). */
  minTrialsForOutcomeWeight?: number;
}

export interface OnboardingMilestoneDef {
  slug: string;
  label: string;
  targetDays: number;
  signal: string;
}

export interface OperationalConfig {
  healthScoreFactors?: HealthScoreFactor[];
  anomalyConfig?: AnomalyConfig;
  churnRiskSignals?: ChurnRiskSignal[];
  interventionTypes?: InterventionType[];
  alertLimits?: AlertLimits;
  coldStartConfig?: ColdStartConfig;
  dataRetention?: DataRetentionConfig;
  scanFrequencyHours?: number;
  reportSchedule?: { dayOfWeek: number; hour: number };
  dedupWindowMinutes?: number;
  maxAccountsPerRun?: number;
  maxConcurrentEvaluations?: number;
  maxRunDurationMs?: number;
  accountPriorityMode?: 'round_robin' | 'worst_first' | 'stalest_first';
  maxSkipCyclesPerAccount?: number;
  metricAvailabilityMode?: 'strict' | 'lenient';
  templateMigrationMode?: 'gradual' | 'hard_reset' | 'dual_run';
  // ClientPulse additions (§12.2 Gap A)
  staffActivity?: StaffActivityDefinition;
  integrationFingerprints?: IntegrationFingerprintConfig;
  churnBands?: ChurnBands;
  interventionDefaults?: InterventionDefaults;
  onboardingMilestones?: OnboardingMilestoneDef[];
  // Phase 4 — spec-aligned alias for `interventionTypes`. Either key may be
  // present; the accessor prefers `interventionTemplates` when both exist.
  interventionTemplates?: InterventionType[];
}

// ── Default fallbacks (used when no template is applied) ──────────────────

const DEFAULT_HEALTH_SCORE_FACTORS: HealthScoreFactor[] = [
  { metricSlug: 'contact_growth_rate', weight: 0.20, label: 'Contact Growth', periodType: 'rolling_30d', normalisation: { type: 'linear', minValue: -50, maxValue: 50 } },
  { metricSlug: 'pipeline_velocity', weight: 0.30, label: 'Pipeline Velocity', periodType: 'rolling_30d', normalisation: { type: 'inverse_linear', minValue: 0, maxValue: 100 } },
  { metricSlug: 'conversation_engagement', weight: 0.25, label: 'Conversation Engagement', periodType: 'rolling_30d', normalisation: { type: 'linear', minValue: 0, maxValue: 100 } },
  { metricSlug: 'revenue_trend', weight: 0.15, label: 'Revenue Trend', periodType: 'rolling_30d', normalisation: { type: 'linear', minValue: -100, maxValue: 100 } },
  { metricSlug: 'platform_activity', weight: 0.10, label: 'Platform Activity', periodType: 'rolling_7d', normalisation: { type: 'linear', minValue: 0, maxValue: 100 } },
];

const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  defaultThreshold: 2.0,
  defaultWindowDays: 30,
  metricOverrides: {},
  seasonality: 'none',
  minimumDataPoints: 14,
  dedupWindowMinutes: 60,
};

const DEFAULT_CHURN_RISK_SIGNALS: ChurnRiskSignal[] = [
  { signalSlug: 'health_trajectory_decline', weight: 0.30, type: 'metric_trend', metricSlug: 'health_score', condition: 'declining_over_periods', periods: 3 },
  { signalSlug: 'pipeline_stagnation', weight: 0.25, type: 'metric_threshold', metricSlug: 'pipeline_velocity', condition: 'above_value', thresholdValue: 60 },
  { signalSlug: 'engagement_decline', weight: 0.25, type: 'metric_threshold', metricSlug: 'conversation_engagement', condition: 'below_value', thresholdValue: 30 },
  { signalSlug: 'low_health', weight: 0.20, type: 'health_score_level', thresholdValue: 40 },
  // ClientPulse Phase 3 additions (§10 Phase 3). Seeded with weight=0 so the
  // default weight sum stays at 1.0 and existing orgs see no behaviour change.
  // Post-launch tuning with Kel's portfolio data will rebalance weights.
  { signalSlug: 'no_funnel_built', weight: 0, type: 'metric_threshold', metricSlug: 'funnel_count', condition: 'below_value', thresholdValue: 1 },
  { signalSlug: 'feature_breadth_floor', weight: 0, type: 'metric_threshold', metricSlug: 'ai_feature_usage', condition: 'below_value', thresholdValue: 1 },
  { signalSlug: 'tier_downgrade_trend', weight: 0, type: 'metric_trend', metricSlug: 'subscription_tier', condition: 'declining_over_periods', periods: 3 },
];

const DEFAULT_ALERT_LIMITS: AlertLimits = {
  maxAlertsPerRun: 20,
  maxAlertsPerAccountPerDay: 3,
  batchLowPriority: true,
};

const DEFAULT_COLD_START: ColdStartConfig = {
  minimumDataPoints: 14,
  allowHeuristicScoring: false,
};

// ── ClientPulse defaults — seeded by migration 0170 into the GHL Agency template ──
// These fallbacks only fire if an org has no template applied. Post-migration every
// GHL Agency org gets the seeded JSONB; new-template authors get a structured default.

const DEFAULT_STAFF_ACTIVITY: StaffActivityDefinition = {
  countedMutationTypes: [
    { type: 'contact_created', weight: 1.0 },
    { type: 'contact_updated', weight: 0.5 },
    { type: 'opportunity_stage_changed', weight: 2.0 },
    { type: 'opportunity_status_changed', weight: 1.5 },
    { type: 'message_sent_outbound', weight: 1.5 },
    { type: 'note_added', weight: 1.0 },
    { type: 'task_completed', weight: 1.0 },
    { type: 'workflow_edited', weight: 3.0 },
    { type: 'funnel_edited', weight: 3.0 },
    { type: 'calendar_configured', weight: 2.0 },
  ],
  excludedUserKinds: ['automation', 'contact', 'unknown'],
  automationUserResolution: {
    strategy: 'outlier_by_volume',
    threshold: 0.6,
    cacheMonths: 1,
  },
  lookbackWindowsDays: [7, 30, 90],
  churnFlagThresholds: {
    zeroActivityDays: 14,
    weekOverWeekDropPct: 50,
  },
};

const DEFAULT_INTEGRATION_FINGERPRINTS: IntegrationFingerprintConfig = {
  seedLibrary: [],
  scanFingerprintTypes: [
    'conversation_provider_id',
    'workflow_action_type',
    'outbound_webhook_domain',
    'custom_field_prefix',
    'tag_prefix',
    'contact_source',
  ],
  unclassifiedSignalPromotion: {
    surfaceAfterOccurrenceCount: 50,
    surfaceAfterSubaccountCount: 3,
  },
};

const DEFAULT_CHURN_BANDS: ChurnBands = {
  healthy: [70, 100],
  watch: [40, 69],
  atRisk: [20, 39],
  critical: [0, 19],
};

const DEFAULT_INTERVENTION_DEFAULTS: InterventionDefaults = {
  cooldownHours: 48,
  cooldownScope: 'executed',
  defaultGateLevel: 'review',
  maxProposalsPerDayPerSubaccount: 1,
  maxProposalsPerDayPerOrg: 20,
};

// ── Service ───────────────────────────────────────────────────────────────

export const orgConfigService = {
  /**
   * Load the merged operational config for an org.
   *
   * Session 1 / contract (h): effective config = deep-merge of the adopted
   * system template's `operational_defaults` with the org's
   * `operational_config_override`. Returns null iff the org row is missing
   * entirely; orgs with no `appliedSystemTemplateId` (legacy pre-Session-1)
   * still return a (possibly-empty) OperationalConfig derived from whatever
   * explicit override the org has written, per spec §4.5.
   */
  async getOperationalConfig(orgId: string): Promise<OperationalConfig | null> {
    const [org] = await db
      .select({
        override: organisations.operationalConfigOverride,
        appliedTemplateId: organisations.appliedSystemTemplateId,
      })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .limit(1);

    if (!org) return null;

    let systemDefaults: Record<string, unknown> | null = null;
    if (org.appliedTemplateId) {
      const [sys] = await db
        .select({ defaults: systemHierarchyTemplates.operationalDefaults })
        .from(systemHierarchyTemplates)
        .where(eq(systemHierarchyTemplates.id, org.appliedTemplateId))
        .limit(1);
      systemDefaults = (sys?.defaults as Record<string, unknown> | undefined) ?? null;
    }

    const overrides = (org.override as Record<string, unknown> | null) ?? null;
    return resolveEffectiveOperationalConfig(systemDefaults, overrides) as OperationalConfig;
  },

  /**
   * Session 1 — new read surface for the Settings page + legacy callers.
   * Returns the raw override row + system defaults + adopted template
   * metadata so the Settings UI can compute the `hasExplicitOverride` +
   * `differsFromTemplate` states locally per spec §4.5.
   */
  async getEffectiveConfigWithProvenance(orgId: string): Promise<
    | {
        effective: Record<string, unknown>;
        overrides: Record<string, unknown> | null;
        systemDefaults: Record<string, unknown> | null;
        appliedSystemTemplateId: string | null;
        appliedSystemTemplateName: string | null;
      }
    | null
  > {
    const [org] = await db
      .select({
        override: organisations.operationalConfigOverride,
        appliedTemplateId: organisations.appliedSystemTemplateId,
      })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .limit(1);

    if (!org) return null;

    let systemDefaults: Record<string, unknown> | null = null;
    let appliedSystemTemplateName: string | null = null;
    if (org.appliedTemplateId) {
      const [sys] = await db
        .select({
          defaults: systemHierarchyTemplates.operationalDefaults,
          name: systemHierarchyTemplates.name,
        })
        .from(systemHierarchyTemplates)
        .where(eq(systemHierarchyTemplates.id, org.appliedTemplateId))
        .limit(1);
      systemDefaults = (sys?.defaults as Record<string, unknown> | undefined) ?? null;
      appliedSystemTemplateName = sys?.name ?? null;
    }

    const overrides = (org.override as Record<string, unknown> | null) ?? null;
    const effective = resolveEffectiveOperationalConfig(systemDefaults, overrides);

    return {
      effective,
      overrides,
      systemDefaults,
      appliedSystemTemplateId: org.appliedTemplateId ?? null,
      appliedSystemTemplateName,
    };
  },

  async getHealthScoreFactors(orgId: string): Promise<HealthScoreFactor[]> {
    const config = await this.getOperationalConfig(orgId);
    return config?.healthScoreFactors ?? DEFAULT_HEALTH_SCORE_FACTORS;
  },

  async getAnomalyConfig(orgId: string): Promise<AnomalyConfig> {
    const config = await this.getOperationalConfig(orgId);
    return config?.anomalyConfig ?? DEFAULT_ANOMALY_CONFIG;
  },

  async getChurnRiskSignals(orgId: string): Promise<ChurnRiskSignal[]> {
    const config = await this.getOperationalConfig(orgId);
    return config?.churnRiskSignals ?? DEFAULT_CHURN_RISK_SIGNALS;
  },

  async getInterventionTypes(orgId: string): Promise<InterventionType[]> {
    const config = await this.getOperationalConfig(orgId);
    return config?.interventionTypes ?? [];
  },

  async getAlertLimits(orgId: string): Promise<AlertLimits> {
    const config = await this.getOperationalConfig(orgId);
    return config?.alertLimits ?? DEFAULT_ALERT_LIMITS;
  },

  async getColdStartConfig(orgId: string): Promise<ColdStartConfig> {
    const config = await this.getOperationalConfig(orgId);
    return config?.coldStartConfig ?? DEFAULT_COLD_START;
  },

  async getDataRetention(orgId: string): Promise<DataRetentionConfig | null> {
    const config = await this.getOperationalConfig(orgId);
    return config?.dataRetention ?? null;
  },

  async getExecutionScalingConfig(orgId: string) {
    const config = await this.getOperationalConfig(orgId);
    return {
      maxAccountsPerRun: config?.maxAccountsPerRun ?? 50,
      maxConcurrentEvaluations: config?.maxConcurrentEvaluations ?? 5,
      maxRunDurationMs: config?.maxRunDurationMs ?? 300000,
      accountPriorityMode: config?.accountPriorityMode ?? 'round_robin',
      maxSkipCyclesPerAccount: config?.maxSkipCyclesPerAccount ?? 3,
    };
  },

  async computeConfigVersion(orgId: string): Promise<string> {
    const config = await this.getOperationalConfig(orgId);
    if (!config) return 'no-config';
    const hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
    return hash.substring(0, 16);
  },

  // ── ClientPulse accessors (§12.2 Gap B) ─────────────────────────────────

  async getStaffActivityDefinition(orgId: string): Promise<StaffActivityDefinition> {
    const config = await this.getOperationalConfig(orgId);
    return config?.staffActivity ?? DEFAULT_STAFF_ACTIVITY;
  },

  async getIntegrationFingerprintConfig(orgId: string): Promise<IntegrationFingerprintConfig> {
    const config = await this.getOperationalConfig(orgId);
    return config?.integrationFingerprints ?? DEFAULT_INTEGRATION_FINGERPRINTS;
  },

  async getChurnBands(orgId: string): Promise<ChurnBands> {
    const config = await this.getOperationalConfig(orgId);
    return config?.churnBands ?? DEFAULT_CHURN_BANDS;
  },

  async getInterventionDefaults(orgId: string): Promise<InterventionDefaults> {
    const config = await this.getOperationalConfig(orgId);
    return config?.interventionDefaults ?? DEFAULT_INTERVENTION_DEFAULTS;
  },

  async getOnboardingMilestoneDefs(orgId: string): Promise<OnboardingMilestoneDef[]> {
    const config = await this.getOperationalConfig(orgId);
    return config?.onboardingMilestones ?? [];
  },

  /**
   * Phase 4 — intervention templates (the catalogue the scenario detector + UI
   * pick from). Reads the spec-aligned `interventionTemplates` key if present,
   * falling back to the pre-existing `interventionTypes` key so existing
   * hierarchyTemplate data keeps working.
   */
  async getInterventionTemplates(orgId: string): Promise<InterventionType[]> {
    const config = await this.getOperationalConfig(orgId);
    return config?.interventionTemplates ?? config?.interventionTypes ?? [];
  },
};
