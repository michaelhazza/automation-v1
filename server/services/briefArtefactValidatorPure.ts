import type {
  BriefChatArtefact,
  BriefArtefactStatus,
  BriefResultEntityType,
  BriefResultSource,
  BriefTruncationReason,
  BriefErrorCode,
  BriefErrorSeverity,
  BriefApprovalRiskLevel,
  BriefExecutionStatus,
} from '../../shared/types/briefResultContract.js';

// ---------------------------------------------------------------------------
// Validation error discriminated union
// ---------------------------------------------------------------------------

export type ValidationError =
  | { code: 'invalid_schema'; path: string; expected: string; got: string }
  | { code: 'missing_required'; field: string }
  | { code: 'invalid_enum'; field: string; value: unknown; validValues: string[] }
  | { code: 'orphan_parent'; parentArtefactId: string }
  | { code: 'duplicate_tip'; chainRoot: string; tips: string[] }
  | { code: 'duplicate_supersession'; parentArtefactId: string; conflictingArtefactId: string };

export type ValidateArtefactResult =
  | { valid: true; artefact: BriefChatArtefact }
  | { valid: false; errors: ValidationError[] };

export type ValidateChainResult = {
  valid: boolean;
  errors: ValidationError[];
  tips: string[];
};

// ---------------------------------------------------------------------------
// Enum membership sets (derived from briefResultContract.ts — do NOT modify
// the contract file; these are local validation mirrors)
// ---------------------------------------------------------------------------

const VALID_KINDS = new Set(['structured', 'approval', 'approval_decision', 'error']);
const VALID_DECISION_VALUES = new Set(['approve', 'reject']);
const VALID_STATUSES = new Set<BriefArtefactStatus>(['final', 'pending', 'updated', 'invalidated']);
const VALID_ENTITY_TYPES = new Set<BriefResultEntityType>([
  'contacts', 'opportunities', 'appointments', 'conversations',
  'revenue', 'tasks', 'runs', 'other',
]);
const VALID_SOURCES = new Set<BriefResultSource>(['canonical', 'live', 'hybrid']);
const VALID_TRUNCATION_REASONS = new Set<BriefTruncationReason>([
  'result_limit', 'cost_limit', 'time_limit',
]);
const VALID_ERROR_CODES = new Set<BriefErrorCode>([
  'unsupported_query', 'ambiguous_intent', 'missing_permission',
  'cost_exceeded', 'rate_limited', 'provider_error', 'internal_error',
]);
const VALID_ERROR_SEVERITIES = new Set<BriefErrorSeverity>(['low', 'medium', 'high']);
const VALID_RISK_LEVELS = new Set<BriefApprovalRiskLevel>(['low', 'medium', 'high']);
const VALID_EXECUTION_STATUSES = new Set<BriefExecutionStatus>([
  'pending', 'running', 'completed', 'failed',
]);
const VALID_CONFIDENCE_SOURCES = new Set(['llm', 'heuristic', 'deterministic']);
const VALID_BUDGET_WINDOWS = new Set(['per_run', 'per_day', 'per_month', 'unknown']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkEnum(
  errors: ValidationError[],
  field: string,
  value: unknown,
  validSet: Set<string>,
): void {
  if (value !== undefined && !validSet.has(value as string)) {
    errors.push({ code: 'invalid_enum', field, value, validValues: [...validSet] });
  }
}

function requireString(
  errors: ValidationError[],
  field: string,
  value: unknown,
): void {
  if (typeof value !== 'string') {
    errors.push({
      code: value === undefined ? 'missing_required' : 'invalid_schema',
      ...(value === undefined
        ? { field }
        : { path: field, expected: 'string', got: typeof value }),
    } as ValidationError);
  }
}

function requireArray(
  errors: ValidationError[],
  field: string,
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    errors.push({
      code: value === undefined ? 'missing_required' : 'invalid_schema',
      ...(value === undefined
        ? { field }
        : { path: field, expected: 'array', got: typeof value }),
    } as ValidationError);
  }
}

function requireNumber(
  errors: ValidationError[],
  field: string,
  value: unknown,
): void {
  if (typeof value !== 'number') {
    errors.push({
      code: value === undefined ? 'missing_required' : 'invalid_schema',
      ...(value === undefined
        ? { field }
        : { path: field, expected: 'number', got: typeof value }),
    } as ValidationError);
  }
}

function requireBoolean(
  errors: ValidationError[],
  field: string,
  value: unknown,
): void {
  if (typeof value !== 'boolean') {
    errors.push({
      code: value === undefined ? 'missing_required' : 'invalid_schema',
      ...(value === undefined
        ? { field }
        : { path: field, expected: 'boolean', got: typeof value }),
    } as ValidationError);
  }
}

// ---------------------------------------------------------------------------
// Shared base field validation (BriefArtefactBase)
// ---------------------------------------------------------------------------

function validateBase(errors: ValidationError[], obj: Record<string, unknown>): void {
  requireString(errors, 'artefactId', obj['artefactId']);
  if (obj['status'] !== undefined) {
    checkEnum(errors, 'status', obj['status'], VALID_STATUSES as Set<string>);
  }
  if (obj['confidenceSource'] !== undefined) {
    checkEnum(errors, 'confidenceSource', obj['confidenceSource'], VALID_CONFIDENCE_SOURCES);
  }
  if (isObject(obj['budgetContext'])) {
    const bc = obj['budgetContext'] as Record<string, unknown>;
    if (bc['window'] !== undefined) {
      checkEnum(errors, 'budgetContext.window', bc['window'], VALID_BUDGET_WINDOWS);
    }
  }
}

// ---------------------------------------------------------------------------
// Kind-specific field validation
// ---------------------------------------------------------------------------

function validateStructured(errors: ValidationError[], obj: Record<string, unknown>): void {
  requireString(errors, 'summary', obj['summary']);
  requireString(errors, 'entityType', obj['entityType']);
  checkEnum(errors, 'entityType', obj['entityType'], VALID_ENTITY_TYPES as Set<string>);
  requireArray(errors, 'filtersApplied', obj['filtersApplied']);
  requireArray(errors, 'rows', obj['rows']);
  requireNumber(errors, 'rowCount', obj['rowCount']);
  requireBoolean(errors, 'truncated', obj['truncated']);
  requireArray(errors, 'suggestions', obj['suggestions']);
  requireNumber(errors, 'costCents', obj['costCents']);
  requireString(errors, 'source', obj['source']);
  checkEnum(errors, 'source', obj['source'], VALID_SOURCES as Set<string>);
  if (obj['truncationReason'] !== undefined) {
    checkEnum(errors, 'truncationReason', obj['truncationReason'], VALID_TRUNCATION_REASONS as Set<string>);
  }
}

function validateApproval(errors: ValidationError[], obj: Record<string, unknown>): void {
  requireString(errors, 'summary', obj['summary']);
  requireString(errors, 'actionSlug', obj['actionSlug']);
  if (!isObject(obj['actionArgs'])) {
    errors.push({ code: 'missing_required', field: 'actionArgs' });
  }
  requireArray(errors, 'affectedRecordIds', obj['affectedRecordIds']);
  requireString(errors, 'riskLevel', obj['riskLevel']);
  checkEnum(errors, 'riskLevel', obj['riskLevel'], VALID_RISK_LEVELS as Set<string>);
  if (obj['executionStatus'] !== undefined) {
    checkEnum(errors, 'executionStatus', obj['executionStatus'], VALID_EXECUTION_STATUSES as Set<string>);
  }
}

function validateError(errors: ValidationError[], obj: Record<string, unknown>): void {
  requireString(errors, 'errorCode', obj['errorCode']);
  checkEnum(errors, 'errorCode', obj['errorCode'], VALID_ERROR_CODES as Set<string>);
  requireString(errors, 'message', obj['message']);
  if (obj['severity'] !== undefined) {
    checkEnum(errors, 'severity', obj['severity'], VALID_ERROR_SEVERITIES as Set<string>);
  }
}

function validateApprovalDecision(errors: ValidationError[], obj: Record<string, unknown>): void {
  requireString(errors, 'parentArtefactId', obj['parentArtefactId']);
  requireString(errors, 'decision', obj['decision']);
  checkEnum(errors, 'decision', obj['decision'], VALID_DECISION_VALUES);
  if (obj['executionStatus'] !== undefined) {
    checkEnum(errors, 'executionStatus', obj['executionStatus'], VALID_EXECUTION_STATUSES as Set<string>);
  }
}

// ---------------------------------------------------------------------------
// Public: validateArtefactPure
// ---------------------------------------------------------------------------

export function validateArtefactPure(artefact: unknown): ValidateArtefactResult {
  const errors: ValidationError[] = [];

  if (!isObject(artefact)) {
    return {
      valid: false,
      errors: [{ code: 'invalid_schema', path: 'root', expected: 'object', got: Array.isArray(artefact) ? 'array' : typeof artefact }],
    };
  }

  const obj = artefact as Record<string, unknown>;

  // Check kind first — determines which branch to validate
  if (obj['kind'] === undefined) {
    errors.push({ code: 'missing_required', field: 'kind' });
  } else if (!VALID_KINDS.has(obj['kind'] as string)) {
    errors.push({ code: 'invalid_enum', field: 'kind', value: obj['kind'], validValues: [...VALID_KINDS] });
  }

  validateBase(errors, obj);

  if (errors.length === 0 || (errors.length > 0 && obj['kind'] !== undefined && VALID_KINDS.has(obj['kind'] as string))) {
    const kind = obj['kind'] as string;
    if (kind === 'structured') validateStructured(errors, obj);
    else if (kind === 'approval') validateApproval(errors, obj);
    else if (kind === 'approval_decision') validateApprovalDecision(errors, obj);
    else if (kind === 'error') validateError(errors, obj);
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, artefact: artefact as unknown as BriefChatArtefact };
}

// ---------------------------------------------------------------------------
// Public: validateLifecycleChainPure
// ---------------------------------------------------------------------------

export function validateLifecycleChainPure(artefacts: BriefChatArtefact[]): ValidateChainResult {
  const errors: ValidationError[] = [];

  if (artefacts.length === 0) {
    return { valid: true, errors: [], tips: [] };
  }

  const byId = new Map<string, BriefChatArtefact>();
  for (const a of artefacts) {
    byId.set(a.artefactId, a);
  }

  // Build children index: parentArtefactId → list of child artefactIds
  const childrenIndex = new Map<string, string[]>();
  for (const a of artefacts) {
    if (a.parentArtefactId !== undefined) {
      if (!byId.has(a.parentArtefactId)) {
        // Orphan — parent referenced but not present in the input set
        errors.push({ code: 'orphan_parent', parentArtefactId: a.parentArtefactId });
      } else {
        const siblings = childrenIndex.get(a.parentArtefactId) ?? [];
        siblings.push(a.artefactId);
        childrenIndex.set(a.parentArtefactId, siblings);
      }
    }
  }

  // Tips: artefacts with no children
  const tips: string[] = [];
  for (const a of artefacts) {
    if (!childrenIndex.has(a.artefactId)) {
      tips.push(a.artefactId);
    }
  }

  // Walk to chain roots and check for duplicate tips per root
  function findRoot(id: string): string {
    const a = byId.get(id);
    if (!a || a.parentArtefactId === undefined || !byId.has(a.parentArtefactId)) {
      return id;
    }
    return findRoot(a.parentArtefactId);
  }

  // Group tips by chain root
  const tipsByRoot = new Map<string, string[]>();
  for (const tip of tips) {
    const root = findRoot(tip);
    const group = tipsByRoot.get(root) ?? [];
    group.push(tip);
    tipsByRoot.set(root, group);
  }

  // Detect duplicate tips per chain root
  for (const [chainRoot, chainTips] of tipsByRoot) {
    if (chainTips.length > 1) {
      errors.push({ code: 'duplicate_tip', chainRoot, tips: chainTips });
    }
  }

  const valid = errors.length === 0;
  return { valid, errors, tips };
}

// ---------------------------------------------------------------------------
// Public: validateLifecycleWriteGuardPure
// ---------------------------------------------------------------------------

export type WriteGuardConflict = {
  artefactId: string;
  error: Extract<ValidationError, { code: 'duplicate_supersession' }>;
};

export type ValidateWriteGuardResult = {
  valid: boolean;
  conflicts: WriteGuardConflict[];
};

/**
 * Write-time invariant: a parent artefact can only be superseded once.
 *
 * Surgical guard that checks only the one invariant which is unambiguously
 * wrong regardless of arrival order — it does NOT flag orphan parents
 * (those are tolerated as an eventual-consistency case: a child can
 * arrive before its parent; the UI's resolveLifecyclePure handles this).
 *
 * Returns a per-artefact conflict list for the new batch — callers drop
 * the offending artefacts and persist the rest.
 */
export function validateLifecycleWriteGuardPure(
  existingArtefacts: BriefChatArtefact[],
  newArtefacts: BriefChatArtefact[],
): ValidateWriteGuardResult {
  // Build a lookup of every artefactId that already supersedes a given parent.
  // An artefact "supersedes" its parent when `parentArtefactId === parent`.
  const supersederByParent = new Map<string, string>();
  for (const a of existingArtefacts) {
    if (a.parentArtefactId !== undefined) {
      // If the existing set already has duplicates, we still only record the
      // first one — subsequent ones are already-broken state the guard can't
      // fix here. Our job is to stop the new write from making it worse.
      if (!supersederByParent.has(a.parentArtefactId)) {
        supersederByParent.set(a.parentArtefactId, a.artefactId);
      }
    }
  }

  const conflicts: WriteGuardConflict[] = [];

  for (const a of newArtefacts) {
    if (a.parentArtefactId === undefined) continue;

    // Idempotent re-write of the same artefactId is allowed (covers retries).
    const existing = supersederByParent.get(a.parentArtefactId);
    if (existing !== undefined && existing !== a.artefactId) {
      conflicts.push({
        artefactId: a.artefactId,
        error: {
          code: 'duplicate_supersession',
          parentArtefactId: a.parentArtefactId,
          conflictingArtefactId: existing,
        },
      });
      continue;
    }

    // Claim this parent for subsequent new artefacts in the same batch.
    supersederByParent.set(a.parentArtefactId, a.artefactId);
  }

  return { valid: conflicts.length === 0, conflicts };
}
