/**
 * agentRunHandoffServicePure.ts — Brain Tree OS adoption P1.
 *
 * Pure builder for the handoff document persisted on `agent_runs.handoff_json`.
 * Holds the canonical AgentRunHandoffV1 type, the deterministic detectors that
 * extract accomplishments / decisions / blockers from a finished run, and the
 * pure `buildHandoff` function that the impure wrapper calls.
 *
 * NOTHING in this file imports from `db/`, `drizzle-orm`, or any service that
 * touches the database. The verify-pure-helper-convention.sh static gate
 * enforces this.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P1
 */

// ---------------------------------------------------------------------------
// Versioned payload type — exported as the source of truth for every consumer.
// Bump to V2 with a discriminated union if the shape needs to change.
// ---------------------------------------------------------------------------

export interface AgentRunHandoffV1 {
  version: 1;
  /** What was accomplished this run. Free-form sentences, capped at 5 items. */
  accomplishments: string[];
  /** Decisions made, each with a short rationale. Capped at 5 items. */
  decisions: Array<{ decision: string; rationale: string }>;
  /** Blockers encountered that prevented completion. Capped at 5 items. */
  blockers: Array<{ blocker: string; severity: 'low' | 'medium' | 'high' }>;
  /** The single highest-value next action for the next run against this agent. */
  nextRecommendedAction: string | null;
  /** Artefacts touched during this run, deduplicated by (kind, id). */
  keyArtefacts: Array<{
    kind: 'task' | 'deliverable' | 'memory_block' | 'external' | 'other';
    id: string | null;
    label: string;
  }>;
  /** ISO 8601 timestamp at which the handoff was generated. */
  generatedAt: string;
  /** Snapshot of agent_runs.status at generation time. */
  runStatus: string;
  /** Snapshot of agent_runs.duration_ms at generation time. */
  durationMs: number | null;
}

// ---------------------------------------------------------------------------
// Caps — exported so tests can assert against them
// ---------------------------------------------------------------------------

export const HANDOFF_MAX_ACCOMPLISHMENTS = 5;
export const HANDOFF_MAX_DECISIONS = 5;
export const HANDOFF_MAX_BLOCKERS = 5;
export const HANDOFF_RATIONALE_MAX_CHARS = 200;

// ---------------------------------------------------------------------------
// Builder input — what the impure wrapper assembles from Drizzle reads
// ---------------------------------------------------------------------------

export interface BuildHandoffInput {
  run: {
    status: string;
    summary: string | null;
    errorMessage: string | null;
    runResultStatus: 'success' | 'partial' | 'failed' | null;
    durationMs: number | null;
    tasksCreated: number;
    tasksUpdated: number;
    deliverablesCreated: number;
  };
  /** Decision-bearing assistant turns from agent_run_messages, in order. */
  assistantTexts: string[];
  /** Tasks touched by this run (created or updated via taskActivities). */
  tasksTouched: Array<{ id: string; title: string }>;
  /** Deliverables produced by this run. */
  deliverables: Array<{ id: string; title: string | null }>;
  /** Memory blocks updated during this run. */
  memoryBlocks: Array<{ id: string; name: string }>;
  /** Open HITL review items attached to this run. */
  hitlItems: Array<{ id: string; title: string | null; status: string }>;
  /** The highest-priority open task assigned to this agent, used for "next action". */
  nextOpenTask: { id: string; title: string } | null;
  /** Override for the generated-at timestamp; tests pin this to a fixed value. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Decision pattern matching — exported so the test suite can verify each branch
// ---------------------------------------------------------------------------

const DECISION_PATTERNS: ReadonlyArray<RegExp> = [
  /^Decision[:\s]+(.+)$/im,
  /^I (?:chose|decided to|opted to|went with) (.+?)(?: because (.+?))?[.\n]/im,
  /^Going with (.+?)(?: because (.+?))?[.\n]/im,
];

/** Strip trailing sentence punctuation so the UI doesn't render dangling periods. */
function trimTrailingPunctuation(s: string): string {
  return s.replace(/[.!?,;:]+$/g, '').trim();
}

/**
 * Extract decision/rationale pairs from a body of assistant text. Stops at the
 * first HANDOFF_MAX_DECISIONS hits. Pure — no side effects.
 */
export function extractDecisions(text: string): Array<{ decision: string; rationale: string }> {
  if (!text) return [];
  const out: Array<{ decision: string; rationale: string }> = [];
  // Walk line-by-line; each pattern is tried per line.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (out.length >= HANDOFF_MAX_DECISIONS) break;
    for (const pattern of DECISION_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const decision = trimTrailingPunctuation((match[1] ?? '').trim());
        const rationale = trimTrailingPunctuation((match[2] ?? '').trim());
        if (decision) {
          out.push({
            decision: decision.slice(0, HANDOFF_RATIONALE_MAX_CHARS),
            rationale: rationale.slice(0, HANDOFF_RATIONALE_MAX_CHARS),
          });
        }
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Severity classification for errors → blocker severity
// ---------------------------------------------------------------------------

const HIGH_SEVERITY_KEYWORDS: ReadonlyArray<string> = [
  'scope_violation',
  'policy_block',
  'permission_denied',
  'unauthorized',
];

const MEDIUM_SEVERITY_KEYWORDS: ReadonlyArray<string> = [
  'budget_exceeded',
  'timeout',
  'cost_exceeded',
  'rate_limit',
];

export function classifyBlockerSeverity(message: string | null): 'low' | 'medium' | 'high' {
  if (!message) return 'low';
  const lower = message.toLowerCase();
  for (const kw of HIGH_SEVERITY_KEYWORDS) {
    if (lower.includes(kw)) return 'high';
  }
  for (const kw of MEDIUM_SEVERITY_KEYWORDS) {
    if (lower.includes(kw)) return 'medium';
  }
  return 'low';
}

// ---------------------------------------------------------------------------
// Counter-driven accomplishments
// ---------------------------------------------------------------------------

function counterAccomplishments(input: BuildHandoffInput): string[] {
  const out: string[] = [];
  const { tasksCreated, tasksUpdated, deliverablesCreated } = input.run;
  if (tasksCreated > 0) out.push(`Created ${tasksCreated} task${tasksCreated === 1 ? '' : 's'}`);
  if (tasksUpdated > 0) out.push(`Updated ${tasksUpdated} task${tasksUpdated === 1 ? '' : 's'}`);
  if (deliverablesCreated > 0) {
    out.push(`Produced ${deliverablesCreated} deliverable${deliverablesCreated === 1 ? '' : 's'}`);
  }
  return out;
}

/**
 * Extract sentence-level "I did X" lines from the run summary. Conservative —
 * if the summary is empty or doesn't look prose-shaped, returns an empty list.
 * Counter-derived lines are preferred when both are present.
 */
function summaryAccomplishments(summary: string | null): string[] {
  if (!summary) return [];
  // Split on sentence boundaries; tolerate the LLM's varied punctuation.
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 300);
  // Filter for sentences that look like accomplishments (start with a verb).
  const verbStart = /^(?:Created|Updated|Sent|Posted|Generated|Built|Wrote|Fixed|Reviewed|Analysed|Analyzed|Detected|Found|Resolved|Closed|Opened|Triggered|Completed|Drafted|Published)\b/;
  return sentences.filter((s) => verbStart.test(s));
}

// ---------------------------------------------------------------------------
// Blocker derivation
// ---------------------------------------------------------------------------

function deriveBlockers(input: BuildHandoffInput): AgentRunHandoffV1['blockers'] {
  const blockers: AgentRunHandoffV1['blockers'] = [];

  // 1. Run-level error
  if (input.run.errorMessage) {
    blockers.push({
      blocker: input.run.errorMessage.slice(0, HANDOFF_RATIONALE_MAX_CHARS),
      severity: classifyBlockerSeverity(input.run.errorMessage),
    });
  }

  // 2. Partial result with no explicit error message
  if (
    input.run.runResultStatus === 'partial' &&
    !input.run.errorMessage &&
    blockers.length < HANDOFF_MAX_BLOCKERS
  ) {
    blockers.push({
      blocker: 'Run completed with partial results',
      severity: 'medium',
    });
  }

  // 3. Open HITL items count as blockers
  for (const item of input.hitlItems) {
    if (blockers.length >= HANDOFF_MAX_BLOCKERS) break;
    if (item.status === 'pending' || item.status === 'open') {
      blockers.push({
        blocker: `Awaiting human review: ${item.title ?? item.id}`,
        severity: 'medium',
      });
    }
  }

  return blockers.slice(0, HANDOFF_MAX_BLOCKERS);
}

// ---------------------------------------------------------------------------
// Key artefacts: deduplicate by (kind, id)
// ---------------------------------------------------------------------------

function deriveArtefacts(input: BuildHandoffInput): AgentRunHandoffV1['keyArtefacts'] {
  const seen = new Set<string>();
  const out: AgentRunHandoffV1['keyArtefacts'] = [];

  const push = (kind: AgentRunHandoffV1['keyArtefacts'][number]['kind'], id: string | null, label: string) => {
    const key = `${kind}:${id ?? label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, id, label });
  };

  for (const t of input.tasksTouched) push('task', t.id, t.title);
  for (const d of input.deliverables) push('deliverable', d.id, d.title ?? 'Untitled deliverable');
  for (const m of input.memoryBlocks) push('memory_block', m.id, m.name);

  return out;
}

// ---------------------------------------------------------------------------
// Next recommended action
// ---------------------------------------------------------------------------

function deriveNextAction(
  input: BuildHandoffInput,
  blockers: AgentRunHandoffV1['blockers'],
): string | null {
  if (blockers.length > 0) {
    const top = blockers[0];
    return `Resolve blockers: ${top.blocker}`;
  }
  if (input.nextOpenTask) {
    return input.nextOpenTask.title;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top-level builder — pure
// ---------------------------------------------------------------------------

export function buildHandoff(input: BuildHandoffInput): AgentRunHandoffV1 {
  // Decisions: walk every assistant text and collect from each, capped overall.
  const decisions: AgentRunHandoffV1['decisions'] = [];
  for (const text of input.assistantTexts) {
    if (decisions.length >= HANDOFF_MAX_DECISIONS) break;
    const found = extractDecisions(text);
    for (const d of found) {
      if (decisions.length >= HANDOFF_MAX_DECISIONS) break;
      decisions.push(d);
    }
  }

  // Accomplishments: counter-derived lines come first, then verb-prefixed
  // sentences from the summary, deduplicated by exact match.
  const counterLines = counterAccomplishments(input);
  const summaryLines = summaryAccomplishments(input.run.summary);
  const accomplishments: string[] = [];
  const seen = new Set<string>();
  for (const line of [...counterLines, ...summaryLines]) {
    if (accomplishments.length >= HANDOFF_MAX_ACCOMPLISHMENTS) break;
    if (seen.has(line)) continue;
    seen.add(line);
    accomplishments.push(line);
  }

  const blockers = deriveBlockers(input);
  const keyArtefacts = deriveArtefacts(input);
  const nextRecommendedAction = deriveNextAction(input, blockers);

  return {
    version: 1,
    accomplishments,
    decisions,
    blockers,
    nextRecommendedAction,
    keyArtefacts,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runStatus: input.run.status,
    durationMs: input.run.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Validator — runtime guard for the impure wrapper and tests
// ---------------------------------------------------------------------------

/**
 * Lightweight runtime validator. Returns true if the value parses as a valid
 * AgentRunHandoffV1. Used by tests to assert builder output and by the impure
 * wrapper to refuse to persist a malformed payload.
 */
export function isValidHandoffV1(value: unknown): value is AgentRunHandoffV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AgentRunHandoffV1>;
  if (v.version !== 1) return false;
  if (!Array.isArray(v.accomplishments)) return false;
  if (!Array.isArray(v.decisions)) return false;
  if (!Array.isArray(v.blockers)) return false;
  if (!Array.isArray(v.keyArtefacts)) return false;
  if (typeof v.generatedAt !== 'string') return false;
  if (typeof v.runStatus !== 'string') return false;
  if (v.durationMs !== null && typeof v.durationMs !== 'number') return false;
  if (v.nextRecommendedAction !== null && typeof v.nextRecommendedAction !== 'string') return false;
  if (v.accomplishments.length > HANDOFF_MAX_ACCOMPLISHMENTS) return false;
  if (v.decisions.length > HANDOFF_MAX_DECISIONS) return false;
  if (v.blockers.length > HANDOFF_MAX_BLOCKERS) return false;
  for (const b of v.blockers) {
    if (b.severity !== 'low' && b.severity !== 'medium' && b.severity !== 'high') return false;
  }
  return true;
}
