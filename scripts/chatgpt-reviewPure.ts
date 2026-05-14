/**
 * chatgpt-reviewPure.ts
 *
 * Pure helpers for the ChatGPT review CLI. No I/O, no fetch, no fs.
 * Imported by `scripts/chatgpt-review.ts` and `scripts/__tests__/chatgpt-reviewPure.test.ts`.
 *
 * The CLI's responsibility is: turn a raw OpenAI response into a validated
 * `ChatGPTReviewResult` per the spec at `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md`
 * § C1. The agent (chatgpt-pr-review / chatgpt-spec-review) consumes that JSON
 * and owns its session log.
 */

export type ReviewMode = 'pr' | 'spec';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'bug' | 'improvement' | 'style' | 'architecture';
export type FindingType =
  | 'null_check'
  | 'idempotency'
  | 'naming'
  | 'architecture'
  | 'error_handling'
  | 'test_coverage'
  | 'security'
  | 'performance'
  | 'scope'
  | 'other';
export type Verdict = 'APPROVED' | 'CHANGES_REQUESTED' | 'NEEDS_DISCUSSION';

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const CATEGORIES: readonly Category[] = ['bug', 'improvement', 'style', 'architecture'];
const FINDING_TYPES: readonly FindingType[] = [
  'null_check',
  'idempotency',
  'naming',
  'architecture',
  'error_handling',
  'test_coverage',
  'security',
  'performance',
  'scope',
  'other',
];
const VERDICTS: readonly Verdict[] = ['APPROVED', 'CHANGES_REQUESTED', 'NEEDS_DISCUSSION'];

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  finding_type: FindingType;
  rationale: string;
  evidence: string;
}

export interface InputSummary {
  branch: string | null;
  spec_path: string | null;
  files_changed: number | null;
}

export interface ChatGPTReviewResult {
  mode: ReviewMode;
  model: string;
  input_summary: InputSummary;
  findings: Finding[];
  verdict: Verdict;
  raw_response: string;
}

/**
 * Count distinct files referenced by a unified diff.
 * Looks for `diff --git a/<path> b/<path>` headers.
 */
export function countFilesChangedInDiff(diff: string): number {
  const headers = diff.match(/^diff --git a\/.+ b\/.+$/gm);
  return headers ? headers.length : 0;
}

/**
 * Build the per-mode input summary. Pure — no env reads.
 */
export function buildInputSummary(
  mode: ReviewMode,
  input: string,
  options: { branch?: string | null; specPath?: string | null } = {},
): InputSummary {
  if (mode === 'pr') {
    return {
      branch: options.branch ?? null,
      spec_path: null,
      files_changed: countFilesChangedInDiff(input),
    };
  }
  return {
    branch: options.branch ?? null,
    spec_path: options.specPath ?? null,
    files_changed: null,
  };
}

/**
 * Validate and normalise a single finding from the raw OpenAI JSON.
 * Returns null if the raw object is unsalvageable.
 *
 * Rules:
 * - Unknown enum values fall back to safe defaults (`other`, `improvement`, `medium`).
 * - Missing required strings (title, rationale, evidence) → null (drop).
 * - `id` is regenerated as `f-<index>` if missing or non-string.
 */
export function normaliseFinding(raw: unknown, index: number): Finding | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!title) return null;

  const rationale = typeof r.rationale === 'string' ? r.rationale.trim() : '';
  const evidence = typeof r.evidence === 'string' ? r.evidence.trim() : '';

  const id =
    typeof r.id === 'string' && r.id.trim()
      ? r.id.trim()
      : `f-${String(index + 1).padStart(3, '0')}`;

  const severity: Severity = SEVERITIES.includes(r.severity as Severity)
    ? (r.severity as Severity)
    : 'medium';
  const category: Category = CATEGORIES.includes(r.category as Category)
    ? (r.category as Category)
    : 'improvement';
  const finding_type: FindingType = FINDING_TYPES.includes(r.finding_type as FindingType)
    ? (r.finding_type as FindingType)
    : 'other';

  return { id, title, severity, category, finding_type, rationale, evidence };
}

/**
 * Parse the OpenAI response (already JSON-parsed) into findings + verdict.
 * Pure — no I/O. Throws on the few unrecoverable shape errors; otherwise
 * coerces to safe defaults.
 */
export function parseModelOutput(parsed: unknown): { findings: Finding[]; verdict: Verdict } {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('model output is not an object');
  }
  const obj = parsed as Record<string, unknown>;

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: Finding[] = [];
  for (let i = 0; i < rawFindings.length; i++) {
    const f = normaliseFinding(rawFindings[i], i);
    if (f) findings.push(f);
  }

  const rawVerdict = typeof obj.verdict === 'string' ? obj.verdict : '';
  const verdict: Verdict = VERDICTS.includes(rawVerdict as Verdict)
    ? (rawVerdict as Verdict)
    : deriveVerdictFromFindings(findings);

  return { findings, verdict };
}

/**
 * Fallback verdict when the model omits or malforms it.
 * APPROVED iff zero high/critical findings; otherwise CHANGES_REQUESTED.
 */
export function deriveVerdictFromFindings(findings: Finding[]): Verdict {
  return findings.some((f) => f.severity === 'critical' || f.severity === 'high')
    ? 'CHANGES_REQUESTED'
    : 'APPROVED';
}

/**
 * Strip a JSON code-fence wrapper if the model returned one despite
 * `response_format: { type: "json_object" }` being set. Robustness only.
 */
export function stripJsonFence(text: string): string {
  const fenceMatch = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
}

export const SYSTEM_PROMPT_PR = `You are a senior code reviewer for a TypeScript / Node.js / React codebase. You will receive a unified diff. Your job is to identify real, actionable issues and return them as a structured JSON object.

Output a single JSON object with this shape:

{
  "findings": [
    {
      "id": "f-001",
      "title": "<one line description of the issue>",
      "severity": "critical" | "high" | "medium" | "low",
      "category": "bug" | "improvement" | "style" | "architecture",
      "finding_type": "null_check" | "idempotency" | "naming" | "architecture" | "error_handling" | "test_coverage" | "security" | "performance" | "scope" | "other",
      "rationale": "<one line — WHY this matters>",
      "evidence": "<file:line or verbatim quote from the diff>"
    }
  ],
  "verdict": "APPROVED" | "CHANGES_REQUESTED" | "NEEDS_DISCUSSION"
}

Rules:
- Be concrete. Cite file paths and line numbers. Skip stylistic nits unless they violate a documented convention you can name.
- Findings about code that is NOT in the diff are out of scope; do not invent them.
- Set verdict APPROVED if there are zero high or critical findings; CHANGES_REQUESTED if there is at least one; NEEDS_DISCUSSION only if you genuinely lack the context to make a call.
- If you have no findings, return findings: [] and verdict: "APPROVED".
- Output JSON only — no prose, no preamble, no trailing commentary.`;

export const SYSTEM_PROMPT_SPEC = `You are a senior spec reviewer for a TypeScript / Node.js / React codebase. You will receive a markdown specification document. Your job is to identify gaps, contradictions, and load-bearing claims without backing mechanisms — and return them as structured JSON.

Output a single JSON object with this shape:

{
  "findings": [
    {
      "id": "f-001",
      "title": "<one line description of the gap>",
      "severity": "critical" | "high" | "medium" | "low",
      "category": "bug" | "improvement" | "style" | "architecture",
      "finding_type": "null_check" | "idempotency" | "naming" | "architecture" | "error_handling" | "test_coverage" | "security" | "performance" | "scope" | "other",
      "rationale": "<one line — WHY this matters>",
      "evidence": "<spec section reference or verbatim quote>"
    }
  ],
  "verdict": "APPROVED" | "CHANGES_REQUESTED" | "NEEDS_DISCUSSION"
}

Rules:
- Be concrete. Cite specific section names or quote the spec verbatim.
- Focus on: file inventory drift, missing contracts, missing source-of-truth precedence when multiple representations exist, missing idempotency/retry/concurrency posture for new write paths, phase sequencing bugs (Phase N references something built in Phase N+k), goals/implementation contradictions.
- Skip stylistic / typo nits unless they affect a normative claim.
- Set verdict APPROVED if the spec is implementation-ready; CHANGES_REQUESTED if accepted edits remain; NEEDS_DISCUSSION only for genuine directional ambiguity.
- If you have no findings, return findings: [] and verdict: "APPROVED".
- Output JSON only — no prose, no preamble, no trailing commentary.`;

export function getSystemPrompt(mode: ReviewMode): string {
  return mode === 'pr' ? SYSTEM_PROMPT_PR : SYSTEM_PROMPT_SPEC;
}
