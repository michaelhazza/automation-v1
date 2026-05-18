// Pure type definitions for the deterministic validator framework.
// No runtime code — tree-shaking safe.
// Deterministic-validators spec §6.1.

export interface RunMetadata {
  skillSlug: string;
  agentId: string;
  subaccountId: string;
  runId: string;
  /** Populated by dispatcher before calling any validator (spec §7.5). */
  invokedSkillSlugs: string[];
}

export interface ValidatorEvidence {
  field?: string;
  expected?: unknown;
  actual?: unknown;
  matchedSubstring?: string;
  missingIds?: string[];
  /** Set when payload was truncated to stay under 4 KB. */
  _truncated?: true;
  [key: string]: unknown;
}

export interface ValidatorResult {
  passed: boolean;
  /** 0.0 or 1.0 for most deterministic; graded only for partial-match validators. */
  score: number;
  reasoning: string;
  /** Required when passed === false. */
  evidence?: ValidatorEvidence;
}

export interface ValidatorContext {
  runOutput: string;
  runMetadata: RunMetadata;
  entityRecord?: Record<string, unknown>;
  parameters: Record<string, unknown>;
}

export interface ValidatorParameterField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description: string;
  uiHint?: 'textarea' | 'code-editor' | 'json-schema' | 'slug-picker' | 'number-range';
  validation?: { min?: number; max?: number; pattern?: string; enum?: unknown[] };
}

export interface Validator {
  slug: string;
  /** Human-readable display name; sourced from validator markdown h1. */
  name?: string;
  /** Semantic version e.g. '1.0.0'. */
  version: string;
  kind: 'deterministic' | 'deterministic_external' | 'hybrid_precondition';
  /** True for validators whose failure triggers safety-class effects (spec §7.6). */
  safetyClass?: boolean;
  /** True once a validator is retired; excluded from new rubric configs. */
  deprecated?: boolean;
  parameterSchema: ValidatorParameterField[];
  evaluate(ctx: ValidatorContext): Promise<ValidatorResult>;
}

/** Shape returned by GET /api/validators (spec §10.1). */
export interface ValidatorSummary {
  slug: string;
  /** Human-readable name; sourced from validator markdown doc h1. */
  name: string;
  kind: 'deterministic' | 'deterministic_external' | 'hybrid_precondition';
  safetyClass: boolean;
  deprecated: boolean;
  parameterSchema: ValidatorParameterField[];
}
