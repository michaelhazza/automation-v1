import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { defineInternalRead, defineMethodologySkill } from './factories.js';

export const methodologyActions: Record<string, ActionDefinition> = {
  // ── Priority Feed (Feature 2) ───────────────────────────────────────────────

  read_priority_feed: {
    actionType: 'read_priority_feed',
    description: 'Read, claim, or release items from the prioritized work feed.',
    actionCategory: 'worker',
    topics: ['workspace'],
    isExternal: false,
    readPath: 'none',
    isUniversal: true,
    riskTier: 1,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['op', 'source', 'itemId', 'limit', 'ttlMinutes'],
    parameterSchema: z.object({
      op: z.enum(['list', 'claim', 'release']),
      limit: z.number().int().min(1).max(50).optional(),
      source: z.string().optional(),
      itemId: z.string().optional(),
      ttlMinutes: z.number().int().min(5).max(120).optional(),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  // ── Cross-Agent Memory Search (Feature 5) ──────────────────────────────────

  search_agent_history: defineInternalRead({
    slug: 'search_agent_history',
    description: 'Search memories and learnings across all agents in the workspace via semantic vector search.',
    topics: ['workspace'],
    readPath: 'none',
    riskTier: 0,
    isUniversal: true,
    payloadFields: ['op', 'query', 'memoryId'],
    parameterSchema: z.object({
      op: z.enum(['search', 'read']),
      query: z.string().min(1).max(1000).optional(),
      includeOtherSubaccounts: z.boolean().optional(),
      topK: z.number().int().min(1).max(50).optional(),
      memoryId: z.string().uuid().optional(),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['validation_failure'],
    },
  }),

  // ── Methodology skills (pure prompt scaffolds, no side effects) ──────────
  // These entries enable the isMethodology fast-path in the preTool middleware,
  // which bypasses full action proposal and writes a lightweight audit row.

  ...Object.fromEntries(([
    ['draft_architecture_plan', 'Produce a structured architecture plan for a feature or subsystem.', ['dev']],
    ['draft_tech_spec', 'Produce a structured technical specification for a feature.', ['dev']],
    ['review_ux', 'Review a UI flow for usability issues and produce recommendations.', ['dev']],
    ['review_code', 'Review code for bugs, quality issues, and adherence to conventions.', ['dev']],
    ['write_tests', 'Generate test cases and test code for a given implementation.', ['dev']],
    ['draft_requirements', 'Draft structured requirements from a feature description.', ['dev']],
    ['derive_test_cases', 'Derive test cases from a requirements specification.', ['dev']],
    ['classify_email', 'Classify an inbound email by intent, urgency, and routing action.', ['support']],
    ['draft_reply', 'Draft a reply to a classified inbound email.', ['support']],
    ['draft_post', 'Draft social media post variants for one or more platforms.', ['social']],
    ['analyse_performance', 'Analyse ads campaign performance and produce ranked recommendations.', ['ads']],
    ['draft_ad_copy', 'Draft ad copy variants for a given campaign and platform.', ['ads']],
    ['draft_sequence', 'Draft a multi-step email outreach sequence.', ['email']],
    ['analyse_financials', 'Analyse revenue and expense data to produce a financial summary.', ['finance']],
    ['generate_competitor_brief', 'Research and produce a structured competitor intelligence brief.', ['strategy']],
    ['synthesise_voc', 'Synthesise voice-of-customer themes from collected feedback.', ['strategy']],
    ['draft_content', 'Draft long-form content (blog post, landing page, guide).', ['content']],
    ['audit_seo', 'Audit a page for on-page SEO issues and produce prioritised recommendations.', ['content']],
    ['draft_report', 'Draft a structured client-facing report from data sections.', ['reporting']],
    ['analyse_pipeline', 'Analyse CRM pipeline data for velocity, conversion, and stale deals.', ['crm']],
    ['draft_followup', 'Draft a follow-up email for a CRM deal or contact.', ['crm']],
    ['detect_churn_risk', 'Score accounts for churn risk based on engagement and commercial signals.', ['crm']],
    ['analyse_42macro_transcript', 'Analyse a 42 Macro transcript into a structured research report.', ['analysis']],
    ['audit_geo', 'Composite GEO audit — evaluates AI search visibility across six dimensions and produces a 0-100 GEO Score.', ['geo', 'seo']],
    ['geo_citability', 'Analyses content extraction quality for AI citation — passage structure, claim density, quotability.', ['geo', 'seo']],
    ['geo_crawlers', 'Checks robots.txt and HTTP headers for 14+ AI crawlers to determine AI search engine access.', ['geo', 'seo']],
    ['geo_schema', 'Evaluates JSON-LD structured data coverage and correctness for AI search engine consumption.', ['geo', 'seo']],
    ['geo_platform_optimizer', 'Platform-specific readiness scores for Google AIO, ChatGPT, Perplexity, Gemini, Bing Copilot.', ['geo', 'seo']],
    ['geo_brand_authority', 'Brand mention tracking, entity signals, and citation density analysis for AI search visibility.', ['geo', 'seo']],
    ['geo_llmstxt', 'Analyses or generates llms.txt — the emerging standard for AI-readable site summaries.', ['geo', 'seo']],
    ['geo_compare', 'Competitive GEO analysis — benchmarks a client site against 2-3 competitors across GEO dimensions.', ['geo', 'seo']],
  ] as [string, string, string[]][]).map(([name, desc, topics]) => [name, defineMethodologySkill({ slug: name, description: desc, topics })])),
};
