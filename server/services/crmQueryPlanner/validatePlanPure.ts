// Stage 4 validator — pure function (spec §11)
// Validates a DraftQueryPlan against schema + registry + principal context.
// Stage1_mode: runs reduced subset (Rules 2, 3, 9) using allowedFields.
// Full mode: runs all 10 rules using schemaContext (P2+).

import type {
  DraftQueryPlan,
  QueryPlan,
  CanonicalQueryRegistry,
  CanonicalQueryRegistryEntry,
  QueryFilter,
  StageResolved,
} from '../../../shared/types/crmQueryPlanner.js';
import type { BriefCostPreview } from '../../../shared/types/briefResultContract.js';
import { isLiveOnlyField } from './executors/liveExecutorPure.js';

// ── ValidationError ───────────────────────────────────────────────────────────

export type RejectedRule =
  | 'entity_existence'
  | 'field_existence'
  | 'operator_sanity'
  | 'date_range_sanity'
  | 'entity_relation_validity'
  | 'aggregation_compatibility'
  | 'hybrid_pattern_check'
  | 'canonical_precedence'
  | 'projection_overlap'
  | 'capability_check';

export class ValidationError extends Error {
  readonly rejectedRule: RejectedRule;
  readonly rejectedValue: unknown;
  constructor(rejectedRule: RejectedRule, rejectedValue: unknown, message?: string) {
    super(message ?? `Validation failed: ${rejectedRule} — ${JSON.stringify(rejectedValue)}`);
    this.name = 'ValidationError';
    this.rejectedRule = rejectedRule;
    this.rejectedValue = rejectedValue;
  }
}

// ── Minimal SchemaContext (P2 will expand this) ───────────────────────────────

export interface SchemaContext {
  entities: Record<string, {
    fields: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'date' | 'array';
      numeric?: boolean;
    }>;
  }>;
}

// ── ValidatorOptions ──────────────────────────────────────────────────────────

export interface ValidatorOptions {
  mode: 'stage1' | 'full';
  stageResolved: StageResolved;
  costPreview: BriefCostPreview;
  // stage1 mode uses entry's allowedFields instead of schemaContext
  entry?: CanonicalQueryRegistryEntry;
  // full mode uses schemaContext (null = P1 stub, skips schema-dependent rules)
  schemaContext?: SchemaContext | null;
  registry: CanonicalQueryRegistry;
  callerCapabilities: Set<string>;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const VALID_ENTITIES = new Set(['contacts', 'opportunities', 'appointments', 'conversations', 'revenue', 'tasks']);

const NUMERIC_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte', 'between']);

// ── Rules ─────────────────────────────────────────────────────────────────────

// Rule 1 [plan-dependent]: entity existence
function checkEntityExistence(draft: DraftQueryPlan): void {
  if (!VALID_ENTITIES.has(draft.primaryEntity)) {
    throw new ValidationError('entity_existence', draft.primaryEntity);
  }
}

// Rule 2 [plan-dependent] [stage1-subset]: field existence
function checkFieldExistenceStage1(
  draft: DraftQueryPlan,
  entry: CanonicalQueryRegistryEntry,
): void {
  const allowed = entry.allowedFields;
  for (const f of draft.filters) {
    if (!(f.field in allowed)) {
      throw new ValidationError('field_existence', f.field);
    }
  }
  for (const s of draft.sort ?? []) {
    if (!(s.field in allowed)) throw new ValidationError('field_existence', s.field);
  }
  for (const p of draft.projection ?? []) {
    if (!(p in allowed)) throw new ValidationError('field_existence', p);
  }
  if (draft.aggregation?.field && !(draft.aggregation.field in allowed)) {
    throw new ValidationError('field_existence', draft.aggregation.field);
  }
  for (const g of draft.aggregation?.groupBy ?? []) {
    if (!(g in allowed)) throw new ValidationError('field_existence', g);
  }
}

function checkFieldExistenceFull(
  draft: DraftQueryPlan,
  schemaContext: SchemaContext,
): void {
  const entitySchema = schemaContext.entities[draft.primaryEntity];
  if (!entitySchema) return; // entity schema not loaded yet — pass
  const fields = entitySchema.fields;
  for (const f of draft.filters) {
    if (!(f.field in fields)) throw new ValidationError('field_existence', f.field);
  }
  for (const s of draft.sort ?? []) {
    if (!(s.field in fields)) throw new ValidationError('field_existence', s.field);
  }
}

// Rule 3 [plan-dependent] [stage1-subset]: operator sanity
function checkOperatorSanityStage1(
  draft: DraftQueryPlan,
  entry: CanonicalQueryRegistryEntry,
): void {
  for (const f of draft.filters) {
    const allowed = entry.allowedFields[f.field]?.operators ?? [];
    if (!(allowed as string[]).includes(f.operator)) {
      throw new ValidationError('operator_sanity', { field: f.field, operator: f.operator });
    }
  }
}

function checkOperatorSanityFull(
  draft: DraftQueryPlan,
  schemaContext: SchemaContext,
): void {
  const entitySchema = schemaContext.entities[draft.primaryEntity];
  if (!entitySchema) return;
  for (const f of draft.filters) {
    const fieldDef = entitySchema.fields[f.field];
    if (!fieldDef) continue;
    if (NUMERIC_OPERATORS.has(f.operator) && !fieldDef.numeric && fieldDef.type !== 'date') {
      throw new ValidationError('operator_sanity', { field: f.field, operator: f.operator });
    }
  }
}

// Rule 4 [plan-dependent]: date-range sanity
function checkDateRangeSanity(draft: DraftQueryPlan): void {
  if (draft.dateContext?.from && draft.dateContext?.to) {
    if (new Date(draft.dateContext.from) >= new Date(draft.dateContext.to)) {
      throw new ValidationError('date_range_sanity', draft.dateContext);
    }
  }
}

// Rule 5 [plan-dependent]: entity-relation validity (P1 stub)
function checkEntityRelationValidity(_draft: DraftQueryPlan, _schemaContext: SchemaContext | null): void {
  // P1: stub — passes for all. Full check requires schemaContext (P2).
}

// Rule 6 [plan-dependent]: aggregation compatibility
function checkAggregationCompatibility(
  draft: DraftQueryPlan,
  schemaContext: SchemaContext | null,
): void {
  if (!draft.aggregation) return;
  if (!schemaContext) return; // P1: pass without schema
  const entitySchema = schemaContext.entities[draft.primaryEntity];
  if (!entitySchema) return;
  const aggType = draft.aggregation.type;
  if ((aggType === 'sum' || aggType === 'avg') && draft.aggregation.field) {
    const fieldDef = entitySchema.fields[draft.aggregation.field];
    if (fieldDef && !fieldDef.numeric) {
      throw new ValidationError('aggregation_compatibility', { type: aggType, field: draft.aggregation.field });
    }
  }
}

// Rule 7 [plan-dependent]: hybrid pattern check
function checkHybridPattern(
  draft: DraftQueryPlan,
  registry: CanonicalQueryRegistry,
): void {
  if (draft.source !== 'hybrid') return;
  if (!draft.canonicalCandidateKey) {
    throw new ValidationError('hybrid_pattern_check', { reason: 'missing_canonicalCandidateKey' });
  }
  if (!registry[draft.canonicalCandidateKey]) {
    throw new ValidationError('hybrid_pattern_check', { reason: 'unknown_registry_key', key: draft.canonicalCandidateKey });
  }
  // v1: basic shape check (exactly one live filter would be verified here in P2)
}

// Rule 8 [plan-dependent]: canonical-precedence tie-breaker (spec §11.2)
// Three cases when the plan's source is 'live' and a canonicalCandidateKey
// points at a real registry entry:
//   (a) no live-only filters present          → promote to 'canonical'
//   (b) live-only filters present AND plan
//       matches canonical_base_with_live_filter → promote to 'hybrid'
//   (c) live-only filters present AND no
//       hybrid shape match                    → stay 'live'
//
// Hybrid shape (spec §11.2 rule 7 / §14.2): exactly one live filter, and
// "other filters are canonical-resolvable". A promoted plan with a non-
// live-only filter the registry entry doesn't know about would otherwise
// escape `canonicalExecutor.assertFieldsSubset` as a `FieldOutOfScopeError`
// (uncaught → 500) or silently slip into the hybrid executor's live-filter
// intersection. Stay on the live plan in that case — the user's filters
// are preserved and the live executor handles them.
function applyCanonicalPrecedence(
  draft: DraftQueryPlan,
  registry: CanonicalQueryRegistry,
): DraftQueryPlan {
  if (draft.source !== 'live') return draft;
  if (!draft.canonicalCandidateKey) return draft;
  const entry = registry[draft.canonicalCandidateKey];
  if (!entry) return draft;

  const filters = draft.filters ?? [];
  const hasLiveOnlyFilter = filters.some(f => isLiveOnlyField(f.field));

  // Canonical-resolvable check: every non-live-only filter AND every sort /
  // projection / aggregation field referenced by the draft must be a field
  // the registry entry's `allowedFields` lists. The canonical executor's
  // `assertFieldsSubset` (§12.1) enforces this same subset across filters,
  // sort, projection, and aggregation; promoting a draft with any out-of-
  // scope field would escape that check as `FieldOutOfScopeError` → 500.
  // Stay on live when any of those fields is not canonical-resolvable —
  // the live executor handles the user's request without this constraint.
  const nonLiveFilters = filters.filter(f => !isLiveOnlyField(f.field));
  const allNonLiveFiltersCanonical = nonLiveFilters.every(f => f.field in entry.allowedFields);
  const allSortCanonical = (draft.sort ?? []).every(s => s.field in entry.allowedFields);
  const allProjectionCanonical = (draft.projection ?? []).every(p => p in entry.allowedFields);
  const aggregation = draft.aggregation;
  const allAggregationFieldsCanonical =
    (!aggregation?.field    || aggregation.field   in entry.allowedFields) &&
    (aggregation?.groupBy  ?? []).every(g => g in entry.allowedFields);

  if (
    !allNonLiveFiltersCanonical ||
    !allSortCanonical ||
    !allProjectionCanonical ||
    !allAggregationFieldsCanonical
  ) {
    // Case (c'): base isn't canonical-resolvable — keep as live (spec §11.2 rule 7 shape).
    return draft;
  }

  if (!hasLiveOnlyFilter) {
    // Case (a): no live-only filters — promote to canonical
    return { ...draft, source: 'canonical' as const };
  }

  // v1 hybrid shape: exactly one live-only filter on top of an otherwise
  // canonical-compatible plan (spec §14 canonical_base_with_live_filter).
  const liveOnlyCount = filters.filter(f => isLiveOnlyField(f.field)).length;
  if (liveOnlyCount === 1) {
    // Case (b): hybrid shape match — promote to hybrid
    return {
      ...draft,
      source: 'hybrid' as const,
      hybridPattern: 'canonical_base_with_live_filter',
    };
  }

  // Case (c): live-only filters present but doesn't fit hybrid shape — stay live
  return draft;
}

// Rule 9 [principal-dependent] [stage1-subset]: projection overlap
function checkProjectionOverlapStage1(
  draft: DraftQueryPlan,
  entry: CanonicalQueryRegistryEntry,
): void {
  for (const field of draft.projection ?? []) {
    if (!(field in entry.allowedFields)) {
      throw new ValidationError('projection_overlap', field, `Field ${field} not allowed in projection`);
    }
    if (!entry.allowedFields[field]!.projectable) {
      throw new ValidationError('projection_overlap', field, `Field ${field} is not projectable`);
    }
  }
}

function checkProjectionOverlapFull(
  draft: DraftQueryPlan,
  schemaContext: SchemaContext | null,
): void {
  if (!schemaContext) return;
  const entitySchema = schemaContext.entities[draft.primaryEntity];
  if (!entitySchema) return;
  for (const field of draft.projection ?? []) {
    if (!(field in entitySchema.fields)) {
      throw new ValidationError('projection_overlap', field);
    }
  }
}

// Rule 10 [principal-dependent]: per-entry capability check
function checkCapabilities(
  draft: DraftQueryPlan,
  registry: CanonicalQueryRegistry,
  callerCapabilities: Set<string>,
): void {
  if (draft.source === 'live') return; // only for canonical / hybrid
  if (!draft.canonicalCandidateKey) return;
  const entry = registry[draft.canonicalCandidateKey];
  if (!entry) return;
  for (const cap of entry.requiredCapabilities) {
    if (callerCapabilities.has(cap)) continue;
    // Skip unknown / forward-looking slugs (same as canonicalExecutor §12.1)
    if (cap.startsWith('canonical.') || cap.startsWith('clientpulse.')) continue;
    throw new ValidationError('capability_check', cap, `Caller lacks required capability: ${cap}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function validatePlanPure(
  draft: DraftQueryPlan,
  options: ValidatorOptions,
): QueryPlan {
  const { mode, entry, schemaContext, registry, callerCapabilities, stageResolved, costPreview } = options;

  if (mode === 'stage1') {
    if (!entry) throw new Error('validatePlanPure: stage1 mode requires entry');
    // Reduced subset: Rules 2, 3, 9
    checkFieldExistenceStage1(draft, entry);
    checkOperatorSanityStage1(draft, entry);
    checkProjectionOverlapStage1(draft, entry);
  } else {
    // Full rule set (Rules 1–10)
    checkEntityExistence(draft);
    if (schemaContext) {
      checkFieldExistenceFull(draft, schemaContext);
      checkOperatorSanityFull(draft, schemaContext);
    }
    checkDateRangeSanity(draft);
    checkEntityRelationValidity(draft, schemaContext ?? null);
    checkAggregationCompatibility(draft, schemaContext ?? null);
    checkHybridPattern(draft, registry);
    const promoted = applyCanonicalPrecedence(draft, registry);
    draft = promoted;
    checkProjectionOverlapFull(draft, schemaContext ?? null);
    checkCapabilities(draft, registry, callerCapabilities);
  }

  return {
    ...draft,
    stageResolved,
    costPreview,
    validated: true,
  } as QueryPlan;
}
