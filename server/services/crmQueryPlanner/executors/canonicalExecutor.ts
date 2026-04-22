// Canonical executor — spec §12.1
// Dispatches a validated canonical QueryPlan to the matching registry handler.

import { canonicalQueryRegistry } from './canonicalQueryRegistry.js';
import type {
  QueryPlan,
  ExecutorContext,
  ExecutorResult,
} from '../../../../shared/types/crmQueryPlanner.js';

export class MissingPermissionError extends Error {
  readonly capabilitySlug: string;
  constructor(capabilitySlug: string) {
    super(`Caller lacks required capability: ${capabilitySlug}`);
    this.name = 'MissingPermissionError';
    this.capabilitySlug = capabilitySlug;
  }
}

export class FieldOutOfScopeError extends Error {
  constructor(field: string, registryKey: string) {
    super(`field out of registry scope: ${field} not in ${registryKey}.allowedFields`);
    this.name = 'FieldOutOfScopeError';
  }
}

function assertFieldsSubset(
  plan: QueryPlan,
  allowedFields: Record<string, unknown>,
  registryKey: string,
): void {
  const check = (field: string) => {
    if (!(field in allowedFields)) {
      throw new FieldOutOfScopeError(field, registryKey);
    }
  };
  for (const f of plan.filters) check(f.field);
  for (const s of plan.sort ?? []) check(s.field);
  for (const p of plan.projection ?? []) check(p);
  if (plan.aggregation?.field) check(plan.aggregation.field);
  for (const g of plan.aggregation?.groupBy ?? []) check(g);
}

export async function executeCanonical(
  plan: QueryPlan,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  if (plan.source !== 'canonical') {
    throw new Error('canonicalExecutor dispatched with non-canonical plan');
  }
  if (!plan.canonicalCandidateKey) {
    throw new Error('canonical plan missing canonicalCandidateKey');
  }

  const entry = canonicalQueryRegistry[plan.canonicalCandidateKey];
  if (!entry) {
    throw new Error(`registry key not found: ${plan.canonicalCandidateKey}`);
  }

  // Per-entry capability check (§12.1 skip-unknown-capability rule).
  // v1: all canonical.* slugs are forward-looking, so they are always skipped.
  // The only enforced gate in v1 is `crm.query` at the route layer.
  for (const cap of entry.requiredCapabilities) {
    if (context.callerCapabilities.has(cap)) continue; // caller has it — fine
    // Skip unknown / forward-looking capability slugs (no source of truth yet).
    // A concrete capability catalogue will light these up in v2.
    const isForwardLooking = cap.startsWith('canonical.') || cap.startsWith('clientpulse.');
    if (isForwardLooking) continue; // skipped_unknown_capability
    throw new MissingPermissionError(cap);
  }

  assertFieldsSubset(plan, entry.allowedFields, plan.canonicalCandidateKey);

  return entry.handler({
    orgId:        context.orgId,
    subaccountId: context.subaccountId,
    filters:      plan.filters,
    dateContext:  plan.dateContext,
    limit:        plan.limit,
    sort:         plan.sort,
    projection:   plan.projection,
  });
}
