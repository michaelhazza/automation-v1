import type { routeCall } from '../llmRouter.js';
import type { RetrievalProfile } from '../../lib/queryIntent.js';

// Phase B §8.3 — extended options bag for `extractRunInsights`. `taskSlug`
// moves inside `options` alongside `overrides` so the tail argument has a
// single consistent shape. Overrides are caller-specific (today only
// `outcomeLearningService` uses them to preserve "run-sourced, verified"
// semantics for human-curated lessons — §6.7.1).
export interface ExtractRunInsightsOptions {
  taskSlug?: string;
  overrides?: {
    isUnverified?: boolean;
    provenanceConfidence?: number;
  };
  // Test injection point — allows unit tests to supply a mock without a real
  // provider config. Production code always falls back to `routeCall`.
  _routeCall?: typeof routeCall;
}

// ---------------------------------------------------------------------------
// Phase 2C: Lightweight domain/topic classifier for memory entries
// ---------------------------------------------------------------------------

export const DOMAIN_KEYWORDS: Record<string, readonly string[]> = {
  crm:       ['lead', 'deal', 'pipeline', 'contact', 'prospect', 'hubspot', 'salesforce', 'crm', 'close rate', 'churn', 'retention'],
  reporting: ['report', 'dashboard', 'metric', 'kpi', 'analytics', 'chart', 'trend', 'benchmark', 'performance', 'roi'],
  marketing: ['campaign', 'ad ', 'ads ', 'seo', 'content', 'social media', 'email marketing', 'audience', 'brand', 'conversion', 'ctr', 'impressions'],
  dev:       ['deploy', 'api', 'bug', 'code', 'migration', 'server', 'database', 'endpoint', 'integration', 'webhook'],
  finance:   ['budget', 'invoice', 'revenue', 'cost', 'margin', 'billing', 'payment', 'expense', 'subscription', 'pricing'],
  ops:       ['workflow', 'automation', 'process', 'sop', 'onboarding', 'scheduling', 'handoff', 'escalation'],
};

export const TOPIC_KEYWORDS: Record<string, readonly string[]> = {
  budget:    ['budget', 'spend', 'cost', 'expense', 'allocation'],
  campaign:  ['campaign', 'ad campaign', 'launch', 'promo'],
  pipeline:  ['pipeline', 'deal', 'stage', 'funnel', 'opportunity'],
  metrics:   ['metric', 'kpi', 'benchmark', 'performance', 'score'],
  content:   ['content', 'copy', 'post', 'article', 'blog'],
  client:    ['client', 'customer', 'account', 'stakeholder'],
  product:   ['product', 'feature', 'release', 'roadmap'],
};

/**
 * Map an agent's role (from agents.agentRole) to a memory domain.
 * Returns null when the role doesn't map to a known domain — callers
 * should treat null as "no domain scoping" (search everything).
 */
export function agentRoleToDomain(role: string | null | undefined): string | null {
  if (!role) return null;
  const lower = role.toLowerCase();
  // Direct matches first
  for (const domain of Object.keys(DOMAIN_KEYWORDS)) {
    if (lower.includes(domain)) return domain;
  }
  // Common role names that map to domains
  if (/sales|account.exec|bdr|sdr|business.dev/.test(lower)) return 'crm';
  if (/analyst|intelligence|data/.test(lower)) return 'reporting';
  if (/seo|content|social|brand|geo/.test(lower)) return 'marketing';
  if (/engineer|developer|devops/.test(lower)) return 'dev';
  if (/accounting|bookkeep|cfo/.test(lower)) return 'finance';
  if (/coordinator|operations|admin|onboard/.test(lower)) return 'ops';
  return null;
}

export function classifyDomainTopic(content: string): { domain: string | null; topic: string | null } {
  const lower = content.toLowerCase();
  let bestDomain: string | null = null;
  let bestDomainHits = 0;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const hits = keywords.filter(kw => lower.includes(kw)).length;
    if (hits > bestDomainHits) { bestDomainHits = hits; bestDomain = domain; }
  }
  let bestTopic: string | null = null;
  let bestTopicHits = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const hits = keywords.filter(kw => lower.includes(kw)).length;
    if (hits > bestTopicHits) { bestTopicHits = hits; bestTopic = topic; }
  }
  return { domain: bestDomainHits >= 1 ? bestDomain : null, topic: bestTopicHits >= 1 ? bestTopic : null };
}

// ---------------------------------------------------------------------------
// Shared internal types for the hybrid retrieval pipeline
// ---------------------------------------------------------------------------

export interface HybridRetrieveParams {
  subaccountId: string;
  orgId?: string;
  queryText: string;
  queryEmbedding?: number[];
  qualityThreshold: number;
  taskSlug?: string;
  /** Phase 2C: Optional domain filter for scoped retrieval. */
  domain?: string;
  topK?: number;
  includeOtherSubaccounts?: boolean;
  profile?: RetrievalProfile;
  /** LAEL Phase 1 — when supplied, a memory.retrieved event is emitted at the return boundary. Omit (or pass null) for non-agent callers (admin tooling, config assistant). */
  runId?: string | null;
  /** LAEL Phase 1 — required alongside runId for event emission. */
  organisationId?: string;
}

export interface HybridResult {
  id: string;
  content: string;
  rrf_score: number;
  combined_score: number;
  source_count: number;
  agent_id: string | null;
  agent_name: string;
  subaccount_id: string;
  created_at: string;
  // Memory & Briefings §4.2 (S2): included so the recency-boost post-processing
  // step can check if this entry was accessed within RECENCY_BOOST_WINDOW.
  // IMPORTANT: this field is read-only for ranking purposes — it is NEVER written
  // back as qualityScore (§4.4 invariant: recency boost is ranking-time only).
  last_accessed_at: string | null;
}
