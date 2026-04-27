// ---------------------------------------------------------------------------
// Heuristic registry — core types.
//
// Heuristics are detection-only. They MUST NOT write to the DB, enqueue
// jobs, or call external services. The CI gate verify-heuristic-purity.sh
// (Slice C) enforces this at build time.
// ---------------------------------------------------------------------------

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type EntityKind = 'agent_run' | 'job' | 'skill_execution' | 'connector_poll' | 'llm_call';

// ---------------------------------------------------------------------------
// Baseline types (interface only — implementation lives in baselines/)
// ---------------------------------------------------------------------------

export interface Baseline {
  entityKind: EntityKind;
  entityId: string;
  metric: string;
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface BaselineReader {
  get(
    entityKind: EntityKind,
    entityId: string,
    metric: string,
  ): Promise<Baseline | null>;

  // Returns null if sample_count < minSampleCount.
  getOrNull(
    entityKind: EntityKind,
    entityId: string,
    metric: string,
    minSampleCount: number,
  ): Promise<Baseline | null>;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  type: string;
  ref: string;   // stable resource identifier (file:line, agent_runs.id, etc.)
  summary: string;
}

export type Evidence = EvidenceItem[];

// ---------------------------------------------------------------------------
// Heuristic context — injected at evaluation time
// ---------------------------------------------------------------------------

export interface Logger {
  debug(event: string, meta?: Record<string, unknown>): void;
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
}

export interface HeuristicContext {
  baselines: BaselineReader;
  logger: Logger;
  now: Date;    // injectable for deterministic tests
}

// ---------------------------------------------------------------------------
// Candidate — what the heuristic evaluates
// ---------------------------------------------------------------------------

export interface Candidate {
  entityKind: EntityKind;
  entityId: string;
  entity: unknown;   // typed per kind by the invoking heuristic
}

// ---------------------------------------------------------------------------
// Heuristic result
// ---------------------------------------------------------------------------

export type HeuristicResult =
  | { fired: false }
  | { fired: false; reason: 'insufficient_data' | 'suppressed'; suppressionId?: string }
  | { fired: true; evidence: Evidence; confidence: number };

// ---------------------------------------------------------------------------
// Baseline requirement
// ---------------------------------------------------------------------------

export interface BaselineRequirement {
  entityKind: EntityKind;
  metric: string;
  minSampleCount: number;   // default 10 per spec §7.4
}

// ---------------------------------------------------------------------------
// Suppression rule
// ---------------------------------------------------------------------------

export interface SuppressionRule {
  id: string;                                                              // unique within heuristic
  description: string;                                                     // human-readable why
  predicate: (ctx: HeuristicContext, evidence: Evidence) => boolean;      // true = suppress
}

// ---------------------------------------------------------------------------
// Heuristic interface — one module, one export
// ---------------------------------------------------------------------------

export interface Heuristic {
  id: string;                                                              // stable, unique, kebab-case
  category: 'agent_quality' | 'skill_execution' | 'infrastructure' | 'systemic';
  phase: '2.0' | '2.5';                                                   // day-one or 2.5 expansion

  severity: Severity;       // default severity when this heuristic fires
  confidence: number;       // 0..1, registry-level calibrated default
  expectedFpRate: number;   // 0..1, calibrated false-positive rate estimate

  requiresBaseline: BaselineRequirement[];
  suppressions: SuppressionRule[];

  // Optional per-entity fire-rate cap. When set, the orchestrator writes
  // audit rows with suppression_id='rate_capped' on excess fires.
  firesPerEntityPerHour?: number;

  // Hot path — returns fired/not-fired/insufficient_data.
  evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult>;

  // Rendered into the agent's evidence list when this fires.
  describe(evidence: Evidence): string;
}
