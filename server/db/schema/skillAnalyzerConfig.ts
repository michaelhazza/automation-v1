import {
  pgTable,
  text,
  integer,
  real,
  jsonb,
  boolean,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Skill Analyzer Config — singleton row (key='default') holding tunable
// thresholds for the analyzer pipeline. Migration 0154.
//
// INVARIANT: jobs.config_snapshot captures this row at job start. Runtime
// pipeline reads the snapshot, NOT this live table. Updates here only
// affect jobs started afterwards.
// ---------------------------------------------------------------------------

export type WarningTier =
  | 'informational'
  | 'standard'
  | 'decision_required'
  | 'critical';

export type WarningTierMap = Record<string, WarningTier>;

export const skillAnalyzerConfig = pgTable('skill_analyzer_config', {
  key: text('key').primaryKey().default('default'),
  configVersion: integer('config_version').notNull().default(1),

  classifierFallbackConfidenceScore: real('classifier_fallback_confidence_score')
    .notNull()
    .default(0.30),

  scopeExpansionStandardThreshold: real('scope_expansion_standard_threshold')
    .notNull()
    .default(0.40),
  scopeExpansionCriticalThreshold: real('scope_expansion_critical_threshold')
    .notNull()
    .default(0.75),

  collisionDetectionThreshold: real('collision_detection_threshold')
    .notNull()
    .default(0.40),
  collisionMaxCandidates: integer('collision_max_candidates').notNull().default(20),

  maxTableGrowthRatio: real('max_table_growth_ratio').notNull().default(1.5),

  executionLockStaleSeconds: integer('execution_lock_stale_seconds')
    .notNull()
    .default(600),
  executionAutoUnlockEnabled: boolean('execution_auto_unlock_enabled')
    .notNull()
    .default(false),

  criticalWarningConfirmationPhrase: text('critical_warning_confirmation_phrase')
    .notNull()
    .default('I accept this critical warning'),

  // Default aligned with migration 0154's DB-level default. When a row is
  // inserted via Drizzle ORM (e.g., the lazy seed in skillAnalyzerConfigService),
  // the column default fires only when this field is omitted — which matches
  // the behaviour expected by effectiveTierMap(). The explicit map is written
  // here so the Drizzle schema and the SQL migration stay aligned.
  warningTierMap: jsonb('warning_tier_map').$type<WarningTierMap>().notNull().default({
    REQUIRED_FIELD_DEMOTED:   'decision_required',
    NAME_MISMATCH:            'decision_required',
    SKILL_GRAPH_COLLISION:    'decision_required',
    INVOCATION_LOST:          'decision_required',
    HITL_LOST:                'decision_required',
    CLASSIFIER_FALLBACK:      'decision_required',
    SCOPE_EXPANSION_CRITICAL: 'critical',
    SCOPE_EXPANSION:          'standard',
    CAPABILITY_OVERLAP:       'standard',
    TABLE_ROWS_DROPPED:       'informational',
    OUTPUT_FORMAT_LOST:       'informational',
    WARNINGS_TRUNCATED:       'informational',
  }),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid('updated_by'),
});

export type SkillAnalyzerConfig = typeof skillAnalyzerConfig.$inferSelect;
export type NewSkillAnalyzerConfig = typeof skillAnalyzerConfig.$inferInsert;
