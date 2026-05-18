import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { referenceDocumentDataSources, referenceDocuments, agents, subaccounts, scheduledTasks, tasks } from '../db/schema/index.js';
import { auditService } from './auditService.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { ReferenceDocumentMode } from '../db/schema/referenceDocuments.js';

// ---------------------------------------------------------------------------
// documentDataSourceService — scope-link CRUD + document mode transitions
//
// All mutations are org-scoped via getOrgScopedDb() (Layer 2 isolation).
// RLS is the silent Layer 3 backstop.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// verifyScopeIdsBelongToOrg — cross-org scope ID rejection (C4)
//
// Runs four batched SELECT checks (one per scope kind), one for each non-null
// supplied ID. All checks must pass before any insert is performed.
// On failure, writes an auditEvents row and returns { ok: false, ... }.
// ---------------------------------------------------------------------------

export type ScopeVerificationResult =
  | { ok: true }
  | { ok: false; failedKind: 'agent' | 'subaccount' | 'scheduledTask' | 'taskInstance'; failedId: string };

export async function verifyScopeIdsBelongToOrg(
  orgId: string,
  ids: {
    agentId?: string;
    subaccountId?: string;
    scheduledTaskId?: string;
    taskInstanceId?: string;
  },
): Promise<ScopeVerificationResult> {
  const db = getOrgScopedDb('documentDataSourceService.verifyScopeIdsBelongToOrg');

  // Collect all checks to run; run ALL of them before deciding outcome (atomicity).
  const checks: Array<{ kind: 'agent' | 'subaccount' | 'scheduledTask' | 'taskInstance'; id: string; found: boolean }> = [];

  if (ids.agentId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, ids.agentId), eq(agents.organisationId, orgId)))
      .limit(1);
    checks.push({ kind: 'agent', id: ids.agentId, found: rows.length > 0 });
  }

  if (ids.subaccountId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, ids.subaccountId), eq(subaccounts.organisationId, orgId)))
      .limit(1);
    checks.push({ kind: 'subaccount', id: ids.subaccountId, found: rows.length > 0 });
  }

  if (ids.scheduledTaskId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, ids.scheduledTaskId), eq(scheduledTasks.organisationId, orgId)))
      .limit(1);
    checks.push({ kind: 'scheduledTask', id: ids.scheduledTaskId, found: rows.length > 0 });
  }

  if (ids.taskInstanceId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, ids.taskInstanceId), eq(tasks.organisationId, orgId)))
      .limit(1);
    checks.push({ kind: 'taskInstance', id: ids.taskInstanceId, found: rows.length > 0 });
  }

  // Find the first failing check (all verifications complete before this point).
  const failed = checks.find((c) => !c.found);
  if (failed) {
    // PTH-CGT-R7-F3: route through canonical auditService.log instead of
    // direct insert. The service wraps the insert in its own try/catch so
    // audit failure never masks the 403 (preserves the prior best-effort
    // contract). Switching keeps audit-event discipline (single namespace
    // gate, future factory changes, severity conventions) consistent across
    // the codebase.
    await auditService.log({
      organisationId: orgId,
      actorType: 'system',
      action: 'referenceDocument.scope_cross_org_rejected',
      metadata: { scopeKind: failed.kind, scopeId: failed.id },
    });
    return { ok: false, failedKind: failed.kind, failedId: failed.id };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// linkDocumentToScope — create a reference_document_data_sources row
// ---------------------------------------------------------------------------

export async function linkDocumentToScope(input: {
  documentId: string;
  subaccountId?: string;
  agentId?: string;
  scheduledTaskId?: string;
  taskInstanceId?: string;
  organisationId: string;
}): Promise<{ id: string }> {
  // Verify all supplied scope IDs belong to the org before any insert.
  const verification = await verifyScopeIdsBelongToOrg(input.organisationId, {
    agentId: input.agentId,
    subaccountId: input.subaccountId,
    scheduledTaskId: input.scheduledTaskId,
    taskInstanceId: input.taskInstanceId,
  });
  if (!verification.ok) {
    throw {
      statusCode: 403,
      message: 'Cross-org scope ID rejected',
      errorCode: 'referenceDocument.scope_cross_org',
    };
  }

  const db = getOrgScopedDb('documentDataSourceService.linkDocumentToScope');
  try {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [row] = await db
      .insert(referenceDocumentDataSources)
      .values({
        organisationId: input.organisationId,
        documentId: input.documentId,
        subaccountId: input.subaccountId ?? null,
        agentId: input.agentId ?? null,
        scheduledTaskId: input.scheduledTaskId ?? null,
        taskInstanceId: input.taskInstanceId ?? null,
      })
      .returning({ id: referenceDocumentDataSources.id });
    return { id: row.id };
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e?.code === '23505') {
      throw { statusCode: 409, errorCode: 'DOCUMENT_ALREADY_LINKED' };
    }
    // Migration 0290 CHECK constraint: exactly zero or one non-null scope FK.
    // Map to a 400 so a malformed multi-tier insert returns a useful error
    // rather than a generic 500. (PR-REV-S7)
    if (e?.code === '23514') {
      throw { statusCode: 400, errorCode: 'INVALID_SCOPE_TIER_COMBINATION' };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// unlinkDocumentFromScope — soft-delete a scope link row
// ---------------------------------------------------------------------------

export async function unlinkDocumentFromScope(input: {
  linkId: string;
  organisationId: string;
}): Promise<void> {
  const db = getOrgScopedDb('documentDataSourceService.unlinkDocumentFromScope');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const result = await db
    .update(referenceDocumentDataSources)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(referenceDocumentDataSources.id, input.linkId),
      eq(referenceDocumentDataSources.organisationId, input.organisationId),
      isNull(referenceDocumentDataSources.deletedAt),
    ))
    .returning({ id: referenceDocumentDataSources.id });
  if (result.length === 0) {
    throw { statusCode: 404, errorCode: 'LINK_NOT_FOUND' };
  }
}

// ---------------------------------------------------------------------------
// changeDocumentMode — update mode on reference_documents
// Predicate `mode <> :newMode` makes this idempotent: if mode already
// matches, no row is updated and the call is a no-op (not an error).
// ---------------------------------------------------------------------------

export async function changeDocumentMode(input: {
  documentId: string;
  newMode: ReferenceDocumentMode;
  organisationId: string;
  actorUserId: string;
}): Promise<void> {
  const db = getOrgScopedDb('documentDataSourceService.changeDocumentMode');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .update(referenceDocuments)
    .set({ mode: input.newMode, updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, input.documentId),
      eq(referenceDocuments.organisationId, input.organisationId),
      isNull(referenceDocuments.deletedAt),
    ));
}
