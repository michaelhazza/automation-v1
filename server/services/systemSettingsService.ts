import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemSettings } from '../db/schema/index.js';

// Defaults used when a key has no row in the DB.
// max_upload_size_mb: 200MB covers audio, PDFs, documents, and short video clips
// without risking memory exhaustion on the server.
export const SETTING_DEFAULTS: Record<string, string> = {
  max_upload_size_mb: '200',
  // Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md)
  orchestrator_capability_query_budget: '8',
  orchestrator_per_org_concurrency: '10',
  orchestrator_per_org_burst_window_per_10min: '100',
  max_configuration_attempts_per_task: '1',
  // Feature-request delivery channels (optional — skipped when blank)
  feature_request_slack_channel: '',
  feature_request_email_address: '',
  synthetos_internal_subaccount_id: '',
};

export const SETTING_KEYS = {
  MAX_UPLOAD_SIZE_MB: 'max_upload_size_mb',
  // Orchestrator routing
  ORCHESTRATOR_CAPABILITY_QUERY_BUDGET: 'orchestrator_capability_query_budget',
  ORCHESTRATOR_PER_ORG_CONCURRENCY: 'orchestrator_per_org_concurrency',
  ORCHESTRATOR_PER_ORG_BURST_WINDOW: 'orchestrator_per_org_burst_window_per_10min',
  MAX_CONFIGURATION_ATTEMPTS_PER_TASK: 'max_configuration_attempts_per_task',
  FEATURE_REQUEST_SLACK_CHANNEL: 'feature_request_slack_channel',
  FEATURE_REQUEST_EMAIL_ADDRESS: 'feature_request_email_address',
  SYNTHETOS_INTERNAL_SUBACCOUNT_ID: 'synthetos_internal_subaccount_id',
  // CRM query planner tier config (§21.2) — read by llmPlanner.ts in P2
  CRM_QUERY_PLANNER_DEFAULT_TIER:           'crm_query_planner_default_tier',
  CRM_QUERY_PLANNER_ESCALATION_TIER:        'crm_query_planner_escalation_tier',
  CRM_QUERY_PLANNER_CONFIDENCE_THRESHOLD:   'crm_query_planner_confidence_threshold',
  CRM_QUERY_PLANNER_PER_QUERY_CENTS:        'crm_query_planner_per_query_cents',
  CRM_QUERY_PLANNER_SCHEMA_TOKENS_DEFAULT:  'crm_query_planner_schema_tokens_default',
  CRM_QUERY_PLANNER_SCHEMA_TOKENS_ESCALATED:'crm_query_planner_schema_tokens_escalated',
} as const;

export class SystemSettingsService {
  async getAll(): Promise<Record<string, string>> {
    const rows = await db.select().from(systemSettings);
    const result = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async get(key: string): Promise<string> {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row?.value ?? SETTING_DEFAULTS[key] ?? '';
  }

  async getMaxUploadSizeBytes(): Promise<number> {
    const mb = parseInt(await this.get(SETTING_KEYS.MAX_UPLOAD_SIZE_MB), 10);
    return (isNaN(mb) ? 200 : mb) * 1024 * 1024;
  }

  async set(key: string, value: string): Promise<void> {
    await db
      .insert(systemSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

export const systemSettingsService = new SystemSettingsService();
