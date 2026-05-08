import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { referenceDocumentDataSources, referenceDocuments } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { ReferenceDocumentMode } from '../db/schema/referenceDocuments.js';

// ---------------------------------------------------------------------------
// documentDataSourceService — scope-link CRUD + document mode transitions
//
// All mutations are org-scoped via getOrgScopedDb() (Layer 2 isolation).
// RLS is the silent Layer 3 backstop.
// ---------------------------------------------------------------------------

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
  const db = getOrgScopedDb('documentDataSourceService.linkDocumentToScope');
  try {
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
  await db
    .update(referenceDocuments)
    .set({ mode: input.newMode, updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, input.documentId),
      eq(referenceDocuments.organisationId, input.organisationId),
      isNull(referenceDocuments.deletedAt),
    ));
}
