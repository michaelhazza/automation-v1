import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  hierarchyTemplates,
  systemHierarchyTemplates,
  orgAgentConfigs,
} from '../db/schema/index.js';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Org Config Service — loads and merges operational config from templates
//
// Chain: orgAgentConfigs.appliedTemplateId → hierarchyTemplates →
//        hierarchyTemplates.operationalConfig (org overrides) merged with
//        systemHierarchyTemplates.operationalDefaults (template defaults)
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

// ── Service ───────────────────────────────────────────────────────────────

export const orgConfigService = {
  /**
   * Load merged operational config: template defaults + org overrides.
   * Returns null if no template is applied to the org.
   */
  async getOperationalConfig(orgId: string): Promise<OperationalConfig | null> {
    // Find the org's applied hierarchy template
    const [orgTemplate] = await db
      .select()
      .from(hierarchyTemplates)
      .where(and(
        eq(hierarchyTemplates.organisationId, orgId),
        isNotNull(hierarchyTemplates.systemTemplateId),
      ))
      .limit(1);

    if (!orgTemplate) return null;

    // Load the system template defaults
    let systemDefaults: Record<string, unknown> = {};
    if (orgTemplate.systemTemplateId) {
      const [sysTemplate] = await db
        .select()
        .from(systemHierarchyTemplates)
        .where(eq(systemHierarchyTemplates.id, orgTemplate.systemTemplateId));

      if (sysTemplate?.operationalDefaults) {
        systemDefaults = sysTemplate.operationalDefaults as Record<string, unknown>;
      }
    }

    // Merge: org overrides take precedence over system defaults
    const orgOverrides = (orgTemplate.operationalConfig as Record<string, unknown>) ?? {};
    return { ...systemDefaults, ...orgOverrides } as OperationalConfig;
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

  async computeConfigVersion(orgId: string): Promise<string> {
    const config = await this.getOperationalConfig(orgId);
    if (!config) return 'no-config';
    const hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
    return hash.substring(0, 16);
  },
};
