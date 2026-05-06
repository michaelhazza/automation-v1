/**
 * shared/types/agentRecommendations.ts
 *
 * Discriminated-union evidence types + materialDelta predicates + canonical-JSON
 * helpers for the agent_recommendations primitive (spec §6.5, §2, §6.2).
 *
 * Used by:
 *   - server/db/schema/agentRecommendations.ts (Drizzle type annotation)
 *   - server/services/agentRecommendationsService.ts (upsertRecommendation)
 *   - server/services/skillExecutor.ts (output.recommend handler)
 *   - client/src/components/recommendations/* (rendering)
 */

import { createHash } from 'crypto';

// ── Per-category evidence shapes (spec §6.5) ─────────────────────────────────

export type AgentOverBudgetEvidence = {
  agent_id: string;
  this_month: number;        // integer cents
  last_month: number;        // integer cents
  budget: number;            // integer cents
  top_cost_driver: string;
};

export type PlaybookEscalationRateEvidence = {
  workflow_id: string;
  run_count: number;         // integer
  escalation_count: number;  // integer
  escalation_pct: number;    // ratio 0..1, 4 decimal places
  common_step_id: string;
};

export type SkillSlowEvidence = {
  skill_slug: string;
  latency_p95_ms: number;    // integer ms
  peer_p95_ms: number;       // integer ms
  ratio: number;             // ratio, 4 decimal places
};

export type InactiveWorkflowEvidence = {
  subaccount_agent_id: string;
  agent_id: string;
  agent_name: string;
  expected_cadence: string;  // human-readable cadence description
  last_run_at: string | null; // ISO-8601 or null
};

export type EscalationRepeatPhraseEvidence = {
  phrase: string;
  count: number;             // integer
  sample_escalation_ids: string[]; // array of escalation IDs
};

export type MemoryLowCitationWasteEvidence = {
  agent_id: string;
  low_citation_pct: number;  // ratio 0..1, 4 decimal places
  total_injected: number;    // integer
  projected_token_savings: number; // integer tokens
};

export type AgentRoutingUncertaintyEvidence = {
  agent_id: string;
  low_confidence_pct: number;  // ratio 0..1, 4 decimal places
  second_look_pct: number;     // ratio 0..1, 4 decimal places
  total_decisions: number;     // integer
};

export type LlmCachePoorReuseEvidence = {
  agent_id: string;
  creation_tokens: number;   // integer
  reused_tokens: number;     // integer
  dominant_skill: string;
};

// ── Discriminated union (spec §6.5) ──────────────────────────────────────────

export type RecommendationEvidence =
  | { category: 'agent.over_budget' } & AgentOverBudgetEvidence
  | { category: 'playbook.escalation_rate' } & PlaybookEscalationRateEvidence
  | { category: 'skill.slow' } & SkillSlowEvidence
  | { category: 'inactive.workflow' } & InactiveWorkflowEvidence
  | { category: 'escalation.repeat_phrase' } & EscalationRepeatPhraseEvidence
  | { category: 'memory.low_citation_waste' } & MemoryLowCitationWasteEvidence
  | { category: 'agent.routing_uncertainty' } & AgentRoutingUncertaintyEvidence
  | { category: 'llm.cache_poor_reuse' } & LlmCachePoorReuseEvidence;

// ── Material-change thresholds (spec §2) ─────────────────────────────────────
//
// Pure predicates — no I/O, no clock reads.
// Both a relative threshold and an absolute floor must hold for a delta
// to count as material. Rate-based predicates additionally require a minimum
// supporting count.
//
// Used by upsertRecommendation to gate updated_in_place vs sub_threshold.

export const materialDelta: Record<RecommendationEvidence['category'], (prev: any, next: any) => boolean> = {
  // 10% relative change AND >= 1000 cents ($10) absolute change
  'agent.over_budget': (prev, next) =>
    Math.abs(next.this_month - prev.this_month) / Math.max(prev.this_month, 1) >= 0.10 &&
    Math.abs(next.this_month - prev.this_month) >= 1000,

  // 10pp rate change AND >= 3 escalation-count change
  'playbook.escalation_rate': (prev, next) =>
    Math.abs(next.escalation_pct - prev.escalation_pct) >= 0.10 &&
    Math.abs(next.escalation_count - prev.escalation_count) >= 3,

  // 20% ratio change AND >= 200ms absolute p95 change
  'skill.slow': (prev, next) => {
    const prevRatio = prev.ratio ?? (prev.latency_p95_ms / Math.max(prev.peer_p95_ms, 1));
    const nextRatio = next.ratio ?? (next.latency_p95_ms / Math.max(next.peer_p95_ms, 1));
    return (
      Math.abs(nextRatio - prevRatio) >= 0.20 &&
      Math.abs(next.latency_p95_ms - prev.latency_p95_ms) >= 200
    );
  },

  // Any change in last_run_at is material (a new run resolves the finding)
  'inactive.workflow': (prev, next) =>
    next.last_run_at !== prev.last_run_at,

  // Any new occurrence is material
  'escalation.repeat_phrase': (prev, next) =>
    next.count !== prev.count,

  // 10pp rate change AND volume floor AND volume change
  'memory.low_citation_waste': (prev, next) =>
    Math.abs(next.low_citation_pct - prev.low_citation_pct) >= 0.10 &&
    next.total_injected >= 10 &&
    Math.abs(next.total_injected - prev.total_injected) >= 3,

  // 10pp change on either metric AND volume floor AND volume change
  'agent.routing_uncertainty': (prev, next) =>
    (Math.abs(next.low_confidence_pct - prev.low_confidence_pct) >= 0.10 ||
      Math.abs(next.second_look_pct - prev.second_look_pct) >= 0.10) &&
    next.total_decisions >= 10 &&
    Math.abs(next.total_decisions - prev.total_decisions) >= 3,

  // 20% relative AND >= 1000 token absolute change
  'llm.cache_poor_reuse': (prev, next) =>
    Math.abs(next.creation_tokens - prev.creation_tokens) / Math.max(prev.creation_tokens, 1) >= 0.20 &&
    Math.abs(next.creation_tokens - prev.creation_tokens) >= 1000,
};

// ── output.recommend input/output (spec §6.2) ────────────────────────────────

export interface OutputRecommendInput {
  scope_type: 'org' | 'subaccount';
  scope_id: string;
  category: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  action_hint?: string | null;
  dedupe_key: string;
}

export interface OutputRecommendOutput {
  recommendation_id: string;
  was_new: boolean;
  reason?: 'cap_reached' | 'cooldown' | 'updated_in_place' | 'sub_threshold' | 'evicted_lower_priority';
}

// ── Severity rank (spec §6.2) ─────────────────────────────────────────────────

export function severityRank(severity: 'info' | 'warn' | 'critical'): number {
  if (severity === 'critical') return 3;
  if (severity === 'warn') return 2;
  return 1;
}

// ── Per-severity cooldown defaults (spec §6.5 dismiss endpoint) ──────────────
//
// critical = 24h, warn = 168h (7d), info = 336h (14d)

export const COOLDOWN_HOURS_BY_SEVERITY: Record<'info' | 'warn' | 'critical', number> = {
  critical: 24,
  warn: 168,
  info: 336,
};

// ── Pre-hash canonicalisation (spec §6.2 "Numeric canonicalisation") ─────────
//
// 8 canonical-JSON rules (plan.md Chunk 1 §Contracts):
//
//   1. Object key ordering: keys sorted lexicographically (UTF-16 code-unit
//      order via Array.prototype.sort default), recursively at every level.
//   2. undefined: dropped entirely (not serialised as null).
//   3. null: preserved as null (distinct from undefined).
//   4. Numbers: integers serialise without trailing .0; floats round to 4 dp
//      via Number(n.toFixed(4)); NaN / Infinity / -Infinity throw.
//   5. Strings: NFC-normalised; leading/trailing whitespace preserved.
//   6. Booleans: serialised as true / false; never coerced to 0 / 1.
//   7. Arrays: sorted ascending by JSON.stringify of each element.
//      @preserveOrder tag suppresses sort.
//   8. Date-shaped strings: NOT specially treated.

function canonicaliseValue(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new Error(`[canonicaliseEvidence] NaN/Infinity is not allowed in evidence: ${value}`);
    }
    if (Number.isInteger(value)) return value;
    // Round floats to 4 decimal places
    return Number(value.toFixed(4));
  }

  if (typeof value === 'string') {
    return value.normalize('NFC');
  }

  if (Array.isArray(value)) {
    const mapped = value.map((el) => canonicaliseValue(el));
    // Sort by JSON.stringify of each element (ascending)
    const sorted = [...mapped].sort((a, b) => {
      const sa = JSON.stringify(a) ?? '';
      const sb = JSON.stringify(b) ?? '';
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return sorted;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      const v = canonicaliseValue(obj[key]);
      if (v !== undefined) {
        sorted[key] = v;
      }
    }
    return sorted;
  }

  return value;
}

/**
 * Returns the canonical JSON string for an evidence object.
 * Used as input to sha256 for evidence_hash.
 * Implements all 8 canonical-JSON rules pinned in the plan.
 */
export function canonicaliseEvidence(evidence: Record<string, unknown>): string {
  const canonical = canonicaliseValue(evidence);
  return JSON.stringify(canonical);
}

/**
 * Returns the sha256 hex digest of the canonical JSON of the evidence.
 * This is the value stored in agent_recommendations.evidence_hash.
 */
export function evidenceHash(evidence: Record<string, unknown>): string {
  const canonical = canonicaliseEvidence(evidence);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
