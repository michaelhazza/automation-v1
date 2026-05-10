import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import {
  defineInternalRead,
  defineExternalRead,
  defineInternalStateWrite,
} from './factories.js';

export const intelligenceActions: Record<string, ActionDefinition> = {
  // ── Cross-Subaccount Intelligence Skills (Phase 3) ──────────────────────

  query_subaccount_cohort: defineInternalRead({
    slug: 'query_subaccount_cohort',
    description: 'Read aggregated board health and memory summaries across multiple subaccounts, filtered by tags.',
    topics: ['reporting'],
    readPath: 'canonical',
    riskTier: 0,
    payloadFields: ['tag_filters'],
    parameterSchema: z.object({
      tag_filters: z.string().optional().describe('Tag filters JSON'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
  }),

  read_org_insights: defineInternalRead({
    slug: 'read_org_insights',
    description: 'Query cross-subaccount insights stored in org-level memory.',
    readPath: 'none',
    riskTier: 0,
    payloadFields: [],
    parameterSchema: z.object({
      semantic_query: z.string().optional().describe('Semantic search query'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
  }),

  write_org_insight: defineInternalStateWrite({
    slug: 'write_org_insight',
    description: 'Store a cross-subaccount pattern or insight in org-level memory.',
    riskTier: 1,
    payloadFields: ['content', 'entry_type'],
    parameterSchema: z.object({
      content: z.string().describe('Insight content'),
      entry_type: z.string().describe('Insight type'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  }),

  // Direct-object exception: readOnlyHint: false with idempotencyStrategy: 'read_only' — no factory maps this combination.
  compute_health_score: {
    actionType: 'compute_health_score',
    description: 'Calculate a composite health score (0-100) for a subaccount based on normalised metrics.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['account_id'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  // Direct-object exception: readOnlyHint: false with idempotencyStrategy: 'read_only' — no factory maps this combination.
  detect_anomaly: {
    actionType: 'detect_anomaly',
    description: 'Compare current metrics against historical baseline and flag significant deviations.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['account_id', 'metric_name', 'current_value'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
      metric_name: z.string().describe('Metric name'),
      current_value: z.string().describe('Current metric value'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  compute_churn_risk: defineInternalRead({
    slug: 'compute_churn_risk',
    description: 'Evaluate churn risk signals for a subaccount and produce a risk score with intervention recommendation.',
    topics: ['reporting'],
    readPath: 'canonical',
    riskTier: 0,
    payloadFields: ['account_id'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
  }),

  // Direct-object exception: readPath: 'canonical' with idempotencyStrategy: 'keyed_write' — no factory maps this combination.
  compute_staff_activity_pulse: {
    actionType: 'compute_staff_activity_pulse',
    description: 'Compute the Staff Activity Pulse signal for a subaccount — weighted sum of human-attributed mutations over the configured lookback windows. Writes a real observation row, replacing the Phase 1 placeholder.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 1,
    createsBoardTask: false,
    payloadFields: ['subaccount_id'],
    parameterSchema: z.object({
      subaccount_id: z.string().describe('Subaccount UUID'),
      source_run_id: z.string().optional().describe('Poll-cycle run id for idempotency'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // Direct-object exception: readPath: 'canonical' with idempotencyStrategy: 'keyed_write' — no factory maps this combination.
  scan_integration_fingerprints: {
    actionType: 'scan_integration_fingerprints',
    description: 'Scan a subaccount\'s canonical fingerprint-bearing artifacts against the integration fingerprint library and record detections + unclassified signals. Writes a real observation row, replacing the Phase 1 placeholder.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 1,
    createsBoardTask: false,
    payloadFields: ['subaccount_id'],
    parameterSchema: z.object({
      subaccount_id: z.string().describe('Subaccount UUID'),
      source_run_id: z.string().optional().describe('Poll-cycle run id for idempotency'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  generate_portfolio_report: defineInternalRead({
    slug: 'generate_portfolio_report',
    description: 'Generate a structured portfolio intelligence briefing across the entire organisation.',
    topics: ['reporting'],
    readPath: 'canonical',
    riskTier: 0,
    payloadFields: [],
    parameterSchema: z.object({
      reporting_period_days: z.string().optional().describe('Days to cover'),
      format: z.string().optional().describe('Output format'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
  }),

  // Direct-object exception: actionCategory: 'worker' with isExternal: true — no factory maps this combination.
  trigger_account_intervention: {
    actionType: 'trigger_account_intervention',
    description: 'Propose an intervention for a subaccount — always HITL-gated, requires human approval.',
    actionCategory: 'worker',
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491: high-impact client-affecting action (intervention
    // reaches the account holder) → Tier 6. defaultGateLevel remains 'review'
    // so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['account_id', 'intervention_type', 'evidence_summary'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
      intervention_type: z.string().describe('Intervention type'),
      evidence_summary: z.string().describe('Evidence justification'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
    topics: ['gh-integration'],
    requiresCritiqueGate: true,
  },

  // ── Sprint 5 P4.1: Universal skills ─────────────────────────────────────
  // These are always available to every agent regardless of allowlist.

  ask_clarifying_question: {
    actionType: 'ask_clarifying_question',
    description: 'Ask the user a clarifying question when the agent is unsure how to proceed. Pauses the run until the user responds.',
    actionCategory: 'api',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['question'],
    parameterSchema: z.object({
      question: z.string().min(10).max(2000).describe('The clarifying question to ask the user'),
      blocked_by: z.enum(['topic_filter', 'scope_check', 'no_relevant_tool', 'low_confidence']).optional()
        .describe('Why clarification is needed'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    isMethodology: false,
    topics: [],
  },

  // ── Phase 2 S8: Real-time clarification routing (§5.4) ────────────────────
  // Distinct from ask_clarifying_question — this routes to a named role via
  // WebSocket and supports timeout fallback for blocking urgency.
  request_clarification: {
    actionType: 'request_clarification',
    description: 'Route a real-time question to a named human (subaccount manager / agency owner / client contact) via WebSocket. Blocking urgency pauses the current step until the reply or timeout; non_blocking continues with best-guess.',
    actionCategory: 'api',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['question', 'urgency'],
    parameterSchema: z.object({
      question: z.string().min(10).max(2000).describe('The clarifying question for the recipient'),
      contextSnippet: z.string().max(1000).optional()
        .describe('Short context block explaining the ambiguity'),
      urgency: z.enum(['blocking', 'non_blocking'])
        .describe('blocking pauses the current step; non_blocking continues with best-guess'),
      suggestedAnswers: z.array(z.string().min(1).max(500)).max(5).optional()
        .describe('One-tap answer choices surfaced as buttons'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    isMethodology: false,
    topics: [],
  },

  read_workspace: {
    actionType: 'read_workspace',
    description: 'Read workspace memories for a subaccount. Universal context access.',
    actionCategory: 'api',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['key'],
    parameterSchema: z.object({
      key: z.string().optional().describe('Memory key to read'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    topics: ['workspace'],
  },

  // Sprint 5 P4.2: Shared memory block write
  update_memory_block: defineInternalStateWrite({
    slug: 'update_memory_block',
    description: 'Update a shared memory block. Requires write permission and block ownership.',
    topics: ['workspace'],
    riskTier: 3,
    defaultGateLevel: 'review',
    payloadFields: ['block_name', 'new_content'],
    parameterSchema: z.object({
      block_name: z.string().describe('Name of the memory block to update'),
      new_content: z.string().max(50000).describe('New content for the block'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  }),

  web_search: {
    actionType: 'web_search',
    description: 'Search the web for information. Universal read-only retrieval.',
    actionCategory: 'api',
    isExternal: true,
    readPath: 'liveFetch',
    liveFetchRationale: 'Web search — inherently live, not canonical data',
    defaultGateLevel: 'auto',
    // Spec §4.2.3 line 487: external API read → Tier 2.
    riskTier: 2,
    createsBoardTask: false,
    payloadFields: ['query'],
    parameterSchema: z.object({
      query: z.string().describe('Search query'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['transient_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    topics: [],
  },

  // ── Support Agent — auto-gated stubs ────────────────────────────────────────

  search_knowledge_base: {
    actionType: 'search_knowledge_base',
    description: 'Search the workspace knowledge base for articles and FAQs relevant to a query. Returns ranked results with excerpts.',
    actionCategory: 'api',
    topics: ['support'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['query', 'intent_category', 'max_results'],
    parameterSchema: z.object({
      query: z.string().describe('The search query in natural language'),
      intent_category: z.string().optional().describe('Email intent category from classify_email to narrow search scope'),
      max_results: z.number().optional().describe('Maximum results to return (default 5, max 10)'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  // ── Social Media Agent — review-gated publish + auto-gated analytics ────────

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields, which would mismatch the snapshot.
  publish_post: {
    actionType: 'publish_post',
    description: 'Submit an approved social media post for publishing or scheduling. Review-gated — requires human approval before the post goes live.',
    actionCategory: 'api',
    topics: ['social'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491: client-messaging that lands in a customer feed → Tier 6.
    // (Both immediate-publish and scheduled-publish paths land on the live feed.)
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['platform', 'post_content', 'schedule_at', 'campaign_tag', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['twitter', 'linkedin', 'instagram', 'facebook']).describe('Target publishing platform'),
      post_content: z.string().describe('The final approved post copy'),
      schedule_at: z.string().optional().describe('ISO 8601 datetime to schedule the post. If omitted, publishes immediately upon approval.'),
      media_urls: z.array(z.string()).optional().describe('Optional media attachment URLs'),
      hashtags_in_comment: z.boolean().optional().describe('Instagram: post hashtags in first comment'),
      campaign_tag: z.string().optional().describe('Campaign identifier for analytics grouping'),
      reasoning: z.string().describe('Timing rationale and campaign context — shown to the human reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error', 'platform_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // Spec §4.2.3 line 487: external API read → Tier 2.
  read_analytics: defineExternalRead({
    slug: 'read_analytics',
    description: 'Retrieve social media performance metrics for one or more platforms and a specified time period.',
    topics: ['social'],
    riskTier: 2,
    liveFetchRationale: 'Provider API — social analytics not yet migrated to canonical',
    payloadFields: ['platforms', 'date_from', 'date_to', 'metrics', 'campaign_tag'],
    parameterSchema: z.object({
      platforms: z.array(z.enum(['twitter', 'linkedin', 'instagram', 'facebook'])).describe('Platforms to retrieve analytics for'),
      date_from: z.string().describe('Start date in ISO 8601 format (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date in ISO 8601 format. Defaults to today.'),
      metrics: z.array(z.enum(['impressions', 'reach', 'engagement_rate', 'clicks', 'follower_growth', 'top_posts', 'post_count'])).optional().describe('Specific metrics to retrieve. Omit for all.'),
      campaign_tag: z.string().optional().describe('Filter results to posts with this campaign tag'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'platform_not_configured'],
    },
  }),
};
