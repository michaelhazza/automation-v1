import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import {
  defineCanonicalRead,
  defineExternalRead,
  defineInternalStateWrite,
} from './factories.js';

export const agentsActions: Record<string, ActionDefinition> = {
  // ── Ads Management Agent — auto-gated stubs + block-gated + review-gated ──

  read_campaigns: defineExternalRead({
    slug: 'read_campaigns',
    description: 'Retrieve current campaign data from the connected ads platform — campaign names, status, budget, spend, and performance summary.',
    topics: ['ads'],
    liveFetchRationale: 'Provider API — ads campaign data not yet migrated to canonical',
    // Spec §4.2.3 line 487: external API read → Tier 2.
    riskTier: 2,
    payloadFields: ['platform', 'campaign_ids', 'include_ad_groups', 'date_from', 'date_to'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform to read campaigns from'),
      campaign_ids: z.array(z.string()).optional().describe('Specific campaign IDs to retrieve. If omitted, returns all active campaigns.'),
      include_ad_groups: z.boolean().optional().describe('Include ad group breakdown. Default false.'),
      date_from: z.string().optional().describe('Start date for metrics (ISO 8601 YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date for metrics (ISO 8601 YYYY-MM-DD)'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'platform_not_configured'],
    },
  }),

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields, which would mismatch the snapshot.
  update_bid: {
    actionType: 'update_bid',
    description: 'Propose a bid adjustment for a campaign or ad group. Review-gated — requires human approval before the change is applied.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3: paid-ads spend mutation (state change to billed budget) → Tier 5.
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 5,
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'current_bid', 'proposed_bid', 'change_direction', 'change_percentage', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to adjust the bid for'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      ad_group_id: z.string().optional().describe('Ad group ID if adjusting at ad group level'),
      current_bid: z.string().describe('Current bid or target CPA/ROAS value'),
      proposed_bid: z.string().describe('Proposed new bid or target value'),
      change_direction: z.enum(['increase', 'decrease']).describe('Whether this is an increase or decrease'),
      change_percentage: z.number().describe('Percentage change'),
      reasoning: z.string().describe('Data-driven rationale from analyse_performance'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error', 'platform_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields, which would mismatch the snapshot.
  update_copy: {
    actionType: 'update_copy',
    description: 'Upload approved ad copy to the connected ads platform. Review-gated — requires human approval before the copy change goes live.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3: paid-ads state change (live customer-facing copy) → Tier 5.
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 5,
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'ad_format', 'copy_content', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to update copy for'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      ad_group_id: z.string().optional().describe('Ad group ID if updating at ad group level'),
      ad_format: z.enum(['responsive_search_ad', 'display_ad', 'social_feed_ad', 'sponsored_content']).describe('The ad format being updated'),
      copy_content: z.record(z.unknown()).describe('Approved copy fields to upload'),
      replace_existing: z.boolean().optional().describe('If true, replaces all existing copy. Default false.'),
      reasoning: z.string().describe('Test hypothesis or performance issue being addressed'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error', 'platform_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields, which would mismatch the snapshot.
  pause_campaign: {
    actionType: 'pause_campaign',
    description: 'Propose pausing a campaign on the connected ads platform. Review-gated — requires human approval before execution.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491 ("pause campaign" → Tier 6 example) interpreted in
    // operator scope as Tier 5 — campaign state change without material spend
    // commitment (the action stops spending; budget changes are increase_budget).
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 5,
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'pause_reason', 'performance_evidence', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to pause'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      pause_reason: z.enum(['underperformance', 'budget_exhausted', 'campaign_ended', 'manual_override']).describe('The reason for pausing'),
      performance_evidence: z.string().describe('Data from analyse_performance justifying the pause'),
      reasoning: z.string().describe('Full reasoning for the pause recommendation'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields, which would mismatch the snapshot.
  increase_budget: {
    actionType: 'increase_budget',
    description: 'Propose a budget increase for a high-performing campaign. Review-gated — requires human approval before execution.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491: material spend changes (paid-ads budget mutation
    // commits the agency / customer to additional spend) → Tier 6.
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'current_daily_budget', 'proposed_daily_budget', 'change_percentage', 'performance_evidence', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to increase budget for'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      current_daily_budget: z.string().describe('Current daily budget'),
      proposed_daily_budget: z.string().describe('Proposed new daily budget'),
      change_percentage: z.number().describe('Percentage increase'),
      performance_evidence: z.string().describe('Data justifying the increase'),
      reasoning: z.string().describe('Full reasoning for the budget increase recommendation'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // ── Email Outreach Agent — auto-gated stub + review-gated ───────────────

  // Direct-object exception: external read with CRM write-back (readPath: 'liveFetch' + idempotencyStrategy: 'keyed_write'
  // + readOnlyHint: false). Forces a new factory for a single entry — keep direct per §4.2.
  enrich_contact: {
    actionType: 'enrich_contact',
    description: 'Retrieve enrichment data for a contact from the connected data enrichment provider and write it to the CRM.',
    actionCategory: 'api',
    topics: ['outreach'],
    isExternal: true,
    readPath: 'liveFetch',
    liveFetchRationale: 'Provider API — contact enrichment requires real-time external lookup',
    defaultGateLevel: 'auto',
    riskTier: 2,
    createsBoardTask: false,
    payloadFields: ['contact_email', 'contact_name', 'company_name', 'crm_contact_id', 'fields_requested'],
    parameterSchema: z.object({
      contact_email: z.string().describe('Contact email address to enrich'),
      contact_name: z.string().optional().describe('Contact full name'),
      company_name: z.string().optional().describe('Company name'),
      crm_contact_id: z.string().optional().describe('CRM contact ID to write enriched data back to'),
      fields_requested: z.array(z.enum(['job_title', 'seniority', 'company', 'industry', 'company_size', 'linkedin_url', 'phone', 'location'])).optional().describe('Specific fields to enrich'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'contact_not_found'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },

  // Direct-object exception: actionCategory 'api' + isExternal:false — no factory covers this combination
  // (defineExternalWrite requires isExternal:true; defineInternalStateWrite uses actionCategory 'worker').
  update_crm: {
    actionType: 'update_crm',
    description: 'Write contact or deal updates to the connected CRM. Review-gated — requires human approval before any data is written.',
    actionCategory: 'api',
    topics: ['outreach', 'crm'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: ['record_type', 'record_id', 'record_identifier', 'updates', 'update_reason', 'reasoning'],
    parameterSchema: z.object({
      record_type: z.enum(['contact', 'deal', 'company']).describe('The type of CRM record to update'),
      record_id: z.string().describe('The CRM record ID to update'),
      record_identifier: z.string().describe('Human-readable identifier (email, deal name, company name)'),
      updates: z.record(z.unknown()).describe('Key-value pairs of CRM fields to update'),
      update_reason: z.string().describe('Why these fields are being updated'),
      reasoning: z.string().describe('Full reasoning — shown to the human reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
    requiredIntegration: 'ghl',
  },

  // ── Finance Agent — auto-gated stubs + review-gated ─────────────────────

  // Direct-object exception: actionCategory 'api' vs defineCanonicalRead/defineInternalRead which use 'worker'.
  read_revenue: {
    actionType: 'read_revenue',
    description: 'Retrieve revenue data from the connected accounting or billing system for a specified period.',
    actionCategory: 'api',
    topics: ['finance'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['date_from', 'date_to', 'breakdown_by', 'include_comparison', 'currency'],
    parameterSchema: z.object({
      date_from: z.string().describe('Start date in ISO 8601 format (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date in ISO 8601 format. Defaults to today.'),
      breakdown_by: z.enum(['product', 'customer', 'channel', 'geography', 'none']).optional().describe('Revenue breakdown dimension'),
      include_comparison: z.boolean().optional().describe('Include period-over-period comparison'),
      currency: z.string().optional().describe('ISO 4217 currency code'),
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

  // Direct-object exception: readPath 'liveFetch' + isExternal:false combination — no factory covers this
  // (defineExternalRead requires isExternal:true; defineInternalRead only handles 'canonical'|'none').
  read_expenses: {
    actionType: 'read_expenses',
    description: 'Retrieve expense data from the connected accounting system for a specified period.',
    actionCategory: 'api',
    topics: ['finance'],
    isExternal: false,
    readPath: 'liveFetch',
    liveFetchRationale: 'Provider API — expense data not yet migrated to canonical',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['date_from', 'date_to', 'categories', 'include_comparison', 'currency'],
    parameterSchema: z.object({
      date_from: z.string().describe('Start date in ISO 8601 format (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date in ISO 8601 format. Defaults to today.'),
      categories: z.array(z.string()).optional().describe('Expense categories to filter by'),
      include_comparison: z.boolean().optional().describe('Include period-over-period comparison'),
      currency: z.string().optional().describe('ISO 4217 currency code'),
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

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields (blastRadius:'external') which would mismatch the snapshot.
  // Also isExternal:false vs factory's hardcoded isExternal:true.
  update_financial_record: {
    actionType: 'update_financial_record',
    description: 'Write a financial record update to the connected accounting system. Review-gated — requires human approval before execution.',
    actionCategory: 'api',
    topics: ['finance'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491: financial record material change → Tier 6.
    // defaultGateLevel remains 'review' so existing behaviour is unchanged (INV-8).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['record_type', 'record_description', 'updates', 'period', 'reasoning'],
    parameterSchema: z.object({
      record_type: z.enum(['budget_entry', 'forecast_adjustment', 'expense_note', 'revenue_note']).describe('Type of financial record to update'),
      record_id: z.string().optional().describe('ID of the record to update in the accounting system'),
      record_description: z.string().describe('Human-readable description of what is being updated'),
      updates: z.record(z.unknown()).describe('Fields to write: amounts, notes, dates, category assignments'),
      period: z.string().optional().describe('The financial period this update applies to'),
      reasoning: z.string().describe('Why this record is being updated — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Content/SEO + Client Reporting — review-gated ────────────────────────

  create_lead_magnet: defineInternalStateWrite({
    slug: 'create_lead_magnet',
    description: 'Produce a complete lead magnet asset (checklist, template, mini-guide, scorecard). Review-gated — requires human approval before use in campaigns.',
    topics: ['content'],
    defaultGateLevel: 'review',
    riskTier: 3,
    payloadFields: ['asset_type', 'topic', 'target_audience', 'value_promise', 'reasoning'],
    parameterSchema: z.object({
      asset_type: z.enum(['checklist', 'template', 'mini_guide', 'scorecard', 'swipe_file']).describe('The type of lead magnet to produce'),
      topic: z.string().describe('The topic or problem the lead magnet addresses'),
      target_audience: z.string().describe('Who this lead magnet is for'),
      value_promise: z.string().describe('The specific outcome the reader gets'),
      brand_voice: z.string().optional().describe('Brand voice guidelines'),
      campaign_context: z.string().optional().describe('The campaign this lead magnet supports'),
      workspace_context: z.string().optional().describe('Workspace context'),
      reasoning: z.string().describe('Why this asset is being created — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    idempotencyStrategy: 'keyed_write',
  }),

  // Direct-object exception: no inline verify/verifyNullJustification — IIFE applies 'tenant' blastRadius fallback.
  // defineCustomerMessagingWrite pre-populates these fields (blastRadius:'external') which would mismatch the snapshot.
  deliver_report: {
    actionType: 'deliver_report',
    description: 'Deliver an approved client report via the configured delivery channel. Review-gated — requires human approval before the report is sent to the client.',
    actionCategory: 'api',
    topics: ['reporting'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491: client-messaging that lands in the customer's
    // inbox/portal → Tier 6. defaultGateLevel remains 'review' so existing
    // behaviour is unchanged (INV-8).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['report_title', 'client_name', 'client_email', 'report_content', 'delivery_channel', 'reasoning'],
    parameterSchema: z.object({
      report_title: z.string().describe('Title of the report being delivered'),
      client_name: z.string().describe('Client name'),
      client_email: z.string().describe('Client email address'),
      report_content: z.string().describe('The full approved report content'),
      delivery_channel: z.enum(['email', 'shared_link', 'portal']).describe('How to deliver the report'),
      cover_message: z.string().optional().describe('Optional cover email message'),
      reporting_period: z.string().optional().describe('The reporting period for the email subject'),
      reasoning: z.string().describe('Context for the reviewer — NOT sent to the client'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // ── Onboarding Agent — review-gated ─────────────────────────────────────

  configure_integration: defineInternalStateWrite({
    slug: 'configure_integration',
    description: 'Guide configuration of a workspace integration and submit for human approval. Review-gated — never stores credentials without approval.',
    topics: ['onboarding'],
    defaultGateLevel: 'review',
    riskTier: 3,
    payloadFields: ['integration_type', 'provider_name', 'configuration', 'reasoning'],
    parameterSchema: z.object({
      integration_type: z.enum(['crm', 'email_provider', 'google_ads', 'meta_ads', 'linkedin_ads', 'accounting', 'knowledge_base', 'social_media']).describe('The type of integration to configure'),
      provider_name: z.string().describe('The specific provider name'),
      configuration: z.record(z.unknown()).describe('Integration settings — sensitive fields masked in review'),
      validation_checks: z.array(z.string()).optional().describe('Pre-submission validation checks to run'),
      reasoning: z.string().describe('Why this integration is being configured — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    idempotencyStrategy: 'keyed_write',
  }),

  // ── CRM/Pipeline Agent — auto-gated stub ─────────────────────────────────

  // Direct-object exception: actionCategory 'api' vs defineCanonicalRead which uses 'worker'.
  read_crm: {
    actionType: 'read_crm',
    description: 'Retrieve contact, deal, or pipeline data from the connected CRM for analysis.',
    actionCategory: 'api',
    topics: ['crm'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['query_type', 'filters', 'limit', 'include_activity_history'],
    parameterSchema: z.object({
      query_type: z.enum(['contacts', 'deals', 'pipeline_summary', 'churned_accounts', 'stale_deals']).describe('The type of CRM data to retrieve'),
      filters: z.record(z.unknown()).optional().describe('Filter criteria: stage, owner, date_range, deal_value_min, deal_value_max, last_activity_days'),
      limit: z.number().optional().describe('Maximum records to return (default 50, max 200)'),
      include_activity_history: z.boolean().optional().describe('Include recent activity history per record'),
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

  // ── Canonical Data Dictionary ──────────────────────────────────────────────

  canonical_dictionary: defineCanonicalRead({
    slug: 'canonical_dictionary',
    description: 'Query the canonical data dictionary for table metadata, columns, relationships, and example queries.',
    topics: ['data'],
    riskTier: 0,
    payloadFields: ['tableFilter', 'includeExamples'],
    parameterSchema: z.object({
      tableFilter: z.array(z.string()).optional().describe('Optional list of canonical table names to filter the result'),
      includeExamples: z.boolean().optional().describe('Whether to include example queries in the output'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['validation_error'],
    },
  }),

  // ── Knowledge Management Agent — auto-gated stub + review-gated ──────────

  // Direct-object exception: actionCategory 'api' + isExternal:false + readPath:'none' — no factory covers this
  // combination (defineInternalRead uses 'worker'; defineExternalRead requires isExternal:true).
  read_docs: {
    actionType: 'read_docs',
    description: 'Retrieve documentation pages or sections from the connected documentation source.',
    actionCategory: 'api',
    topics: ['knowledge'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['page_id', 'page_title', 'section', 'include_metadata'],
    parameterSchema: z.object({
      page_id: z.string().optional().describe('The ID or path of the documentation page to retrieve'),
      page_title: z.string().optional().describe('Human-readable page title for search-based retrieval'),
      section: z.string().optional().describe('Specific section or heading to retrieve'),
      include_metadata: z.boolean().optional().describe('Include page metadata. Default true.'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'page_not_found'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  propose_doc_update: defineInternalStateWrite({
    slug: 'propose_doc_update',
    description: 'Propose a specific change to an existing documentation page. Review-gated — requires human approval before write_docs is invoked.',
    topics: ['knowledge'],
    defaultGateLevel: 'review',
    riskTier: 3,
    payloadFields: ['page_title', 'current_content', 'proposed_changes', 'change_type', 'reasoning'],
    parameterSchema: z.object({
      page_id: z.string().optional().describe('The ID of the documentation page to update'),
      page_title: z.string().describe('Human-readable page title'),
      current_content: z.string().describe('Current page content from read_docs'),
      proposed_changes: z.array(z.object({
        section: z.string(),
        current_text: z.string(),
        proposed_text: z.string(),
        change_reason: z.string(),
      })).describe('List of specific changes'),
      change_type: z.enum(['correction', 'update', 'addition', 'removal', 'restructure']).describe('The type of change'),
      reasoning: z.string().describe('Why this update is needed — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    idempotencyStrategy: 'keyed_write',
  }),

  // Direct-object exception: actionCategory 'api' vs defineInternalStateWrite which uses 'worker'.
  write_docs: {
    actionType: 'write_docs',
    description: 'Apply an approved documentation update to the connected documentation system. Review-gated — requires human approval before any content is written.',
    actionCategory: 'api',
    topics: ['knowledge'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: ['page_title', 'full_updated_content', 'change_summary', 'reasoning'],
    parameterSchema: z.object({
      page_id: z.string().optional().describe('The ID of the documentation page to update'),
      page_title: z.string().describe('Human-readable page title'),
      full_updated_content: z.string().describe('The complete updated page content'),
      change_summary: z.string().describe('Brief summary of what changed'),
      source_proposal_id: z.string().optional().describe('ID of the approved propose_doc_update action'),
      reasoning: z.string().describe('Why this update is being applied — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
};
