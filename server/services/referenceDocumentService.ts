import type PgBoss from 'pg-boss';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { referenceDocuments, referenceDocumentVersions, referenceDocumentChunks } from '../db/schema/index.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { ReferenceDocument, NewReferenceDocument } from '../db/schema/referenceDocuments.js';
import type { ReferenceDocumentVersion } from '../db/schema/referenceDocumentVersions.js';
import { hashContent, hashSerialized, serializeDocument, DOC_DELIMITER_END } from './referenceDocumentServicePure.js';
import { countTokens, SUPPORTED_MODEL_FAMILIES } from './llmRouter.js';
import { logCachedContextWrite } from '../lib/cachedContextWriteScope.js';

// ---------------------------------------------------------------------------
// Reference Document Service — stateful I/O
// Owns the CRUD + versioning + token-counting lifecycle for reference_documents
// and reference_document_versions.
//
// Every public method takes `organisationId` explicitly and scopes queries to
// it (Layer 2 of the three-layer isolation contract). All DB access goes
// through `getOrgScopedDb()` (Layer 1B). RLS is the silent Layer 3 backstop.
// ---------------------------------------------------------------------------

export {
  CACHED_CONTEXT_DOC_NAME_TAKEN,
  CACHED_CONTEXT_DOC_NOT_FOUND,
  CACHED_CONTEXT_DOC_ALREADY_DEPRECATED,
  CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED,
  CACHED_CONTEXT_DOC_CONTAINS_DELIMITER,
  CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING,
};

const CACHED_CONTEXT_DOC_NAME_TAKEN       = 'CACHED_CONTEXT_DOC_NAME_TAKEN';
const CACHED_CONTEXT_DOC_NOT_FOUND        = 'CACHED_CONTEXT_DOC_NOT_FOUND';
const CACHED_CONTEXT_DOC_ALREADY_DEPRECATED = 'CACHED_CONTEXT_DOC_ALREADY_DEPRECATED';
const CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED = 'CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED';
const CACHED_CONTEXT_DOC_CONTAINS_DELIMITER = 'CACHED_CONTEXT_DOC_CONTAINS_DELIMITER';
const CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING = 'CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING';

function assertNoDelimiter(content: string): void {
  if (content.includes(DOC_DELIMITER_END)) {
    throw { statusCode: 400, code: CACHED_CONTEXT_DOC_CONTAINS_DELIMITER, message: 'Document content contains reserved delimiter ---DOC_END---' };
  }
}

async function computeAllTokenCounts(content: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const family of SUPPORTED_MODEL_FAMILIES) {
    counts[family] = await countTokens({ modelFamily: family, content });
  }
  return counts;
}

// ---------------------------------------------------------------------------
// create — insert a document row + version 1, all in one transaction.
// ---------------------------------------------------------------------------

export async function create(input: {
  organisationId: string;
  subaccountId: string | null;
  name: string;
  description?: string;
  content: string;
  createdByUserId: string;
}): Promise<ReferenceDocument> {
  assertNoDelimiter(input.content);

  // F2b — observability surface for cached-context writes. Logs the scope
  // tuple once per logical write boundary so a future leak (forgotten
  // subaccount, accidental org-scope) surfaces in logs.
  logCachedContextWrite('referenceDocumentService.create', {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    table: 'reference_documents',
    operation: 'insert',
  }, { name: input.name });

  // Count tokens for all model families before any DB write. If this fails the
  // document is not persisted — strict failure policy per spec §6.1.
  const tokenCounts = await computeAllTokenCounts(input.content);
  const contentHash = hashContent(input.content);

  const db = getOrgScopedDb('referenceDocumentService.create');
  return db.transaction(async (tx) => {
    // Insert the document row first (current_version_id starts NULL).
    let docRow: ReferenceDocument;
    try {
      [docRow] = await tx
        .insert(referenceDocuments)
        .values({
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          name: input.name,
          description: input.description ?? null,
          sourceType: 'manual',
          currentVersion: 0,
        })
        .returning();
    } catch (err: unknown) {
      const e = err as { constraint?: string; code?: string };
      if (e?.constraint === 'reference_documents_org_name_uq' || e?.code === '23505') {
        throw { statusCode: 409, code: CACHED_CONTEXT_DOC_NAME_TAKEN, message: `A document named "${input.name}" already exists in this organisation` };
      }
      throw err;
    }

    // Serialize with the real document ID for version 1.
    const realSerialized = serializeDocument({ documentId: docRow.id, version: 1, content: input.content });
    const serializedBytesHash = hashSerialized(realSerialized);

    // Insert version 1.
    const [versionRow] = await tx
      .insert(referenceDocumentVersions)
      .values({
        documentId: docRow.id,
        version: 1,
        content: input.content,
        contentHash,
        tokenCounts: tokenCounts as ReferenceDocumentVersion['tokenCounts'],
        serializedBytesHash,
        createdByUserId: input.createdByUserId,
        changeSource: 'manual_upload',
      })
      .returning();

    // Advance current_version_id + current_version on the document row.
    const [updated] = await tx
      .update(referenceDocuments)
      .set({ currentVersionId: versionRow.id, currentVersion: 1, updatedAt: new Date() })
      .where(and(
        eq(referenceDocuments.id, docRow.id),
        eq(referenceDocuments.organisationId, input.organisationId),
      ))
      .returning();

    return updated;
  });
}

// ---------------------------------------------------------------------------
// updateContent — idempotent by contentHash; rolls back on token-count failure.
// ---------------------------------------------------------------------------

export async function updateContent(input: {
  documentId: string;
  organisationId: string;
  content: string;
  updatedByUserId: string;
  notes?: string;
}): Promise<ReferenceDocumentVersion> {
  assertNoDelimiter(input.content);

  const doc = await getDoc(input.documentId, input.organisationId);
  const db = getOrgScopedDb('referenceDocumentService.updateContent');

  // Idempotent: if content matches current version, return existing.
  if (doc.currentVersionId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [currentVersion] = await db
      .select()
      .from(referenceDocumentVersions)
      .where(eq(referenceDocumentVersions.id, doc.currentVersionId))
      .limit(1);
    if (currentVersion && currentVersion.contentHash === hashContent(input.content)) {
      return currentVersion;
    }
  }

  const tokenCounts = await computeAllTokenCounts(input.content);
  const newVersion = (doc.currentVersion ?? 0) + 1;
  const serialized = serializeDocument({ documentId: doc.id, version: newVersion, content: input.content });
  const serializedBytesHash = hashSerialized(serialized);
  const contentHash = hashContent(input.content);

  return db.transaction(async (tx) => {
    const [versionRow] = await tx
      .insert(referenceDocumentVersions)
      .values({
        documentId: doc.id,
        version: newVersion,
        content: input.content,
        contentHash,
        tokenCounts: tokenCounts as ReferenceDocumentVersion['tokenCounts'],
        serializedBytesHash,
        createdByUserId: input.updatedByUserId,
        changeSource: 'manual_edit',
        notes: input.notes ?? null,
      })
      .returning();

    await tx
      .update(referenceDocuments)
      .set({ currentVersionId: versionRow.id, currentVersion: newVersion, updatedAt: new Date() })
      .where(and(
        eq(referenceDocuments.id, doc.id),
        eq(referenceDocuments.organisationId, input.organisationId),
      ));

    return versionRow;
  });
}

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

export async function rename(input: { documentId: string; organisationId: string; newName: string }): Promise<ReferenceDocument> {
  const doc = await getDoc(input.documentId, input.organisationId);
  const db = getOrgScopedDb('referenceDocumentService.rename');
  try {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [updated] = await db
      .update(referenceDocuments)
      .set({ name: input.newName, updatedAt: new Date() })
      .where(and(
        eq(referenceDocuments.id, doc.id),
        eq(referenceDocuments.organisationId, input.organisationId),
      ))
      .returning();
    return updated;
  } catch (err: unknown) {
    const e = err as { constraint?: string; code?: string };
    if (e?.constraint === 'reference_documents_org_name_uq' || e?.code === '23505') {
      throw { statusCode: 409, code: CACHED_CONTEXT_DOC_NAME_TAKEN, message: `A document named "${input.newName}" already exists in this organisation` };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle flag methods
// ---------------------------------------------------------------------------

export async function pause(documentId: string, organisationId: string, _userId: string): Promise<void> {
  await getDoc(documentId, organisationId);
  const db = getOrgScopedDb('referenceDocumentService.pause');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .update(referenceDocuments)
    .set({ pausedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, documentId),
      eq(referenceDocuments.organisationId, organisationId),
    ));
}

export async function resume(documentId: string, organisationId: string, _userId: string): Promise<void> {
  await getDoc(documentId, organisationId);
  const db = getOrgScopedDb('referenceDocumentService.resume');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .update(referenceDocuments)
    .set({ pausedAt: null, updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, documentId),
      eq(referenceDocuments.organisationId, organisationId),
    ));
}

export async function deprecate(input: { documentId: string; organisationId: string; reason: string; userId: string }): Promise<void> {
  const doc = await getDoc(input.documentId, input.organisationId);
  if (doc.deprecatedAt) {
    throw { statusCode: 409, code: CACHED_CONTEXT_DOC_ALREADY_DEPRECATED, message: 'Document is already deprecated' };
  }
  const db = getOrgScopedDb('referenceDocumentService.deprecate');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .update(referenceDocuments)
    .set({ deprecatedAt: new Date(), deprecationReason: input.reason, updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, input.documentId),
      eq(referenceDocuments.organisationId, input.organisationId),
    ));
}

export async function softDelete(documentId: string, organisationId: string, _userId: string): Promise<void> {
  await getDoc(documentId, organisationId);
  const db = getOrgScopedDb('referenceDocumentService.softDelete');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .update(referenceDocuments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, documentId),
      eq(referenceDocuments.organisationId, organisationId),
    ));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listByOrg(
  organisationId: string,
  filters?: { subaccountId?: string | null; includeDeleted?: boolean },
): Promise<ReferenceDocument[]> {
  const db = getOrgScopedDb('referenceDocumentService.listByOrg');
  const conditions = [eq(referenceDocuments.organisationId, organisationId)];
  if (!filters?.includeDeleted) {
    conditions.push(isNull(referenceDocuments.deletedAt));
  }
  if (filters?.subaccountId !== undefined) {
    if (filters.subaccountId === null) {
      conditions.push(isNull(referenceDocuments.subaccountId));
    } else {
      conditions.push(eq(referenceDocuments.subaccountId, filters.subaccountId));
    }
  }
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  return db
    .select()
    .from(referenceDocuments)
    .where(and(...conditions))
    .orderBy(desc(referenceDocuments.createdAt));
}

export async function getByIdWithCurrentVersion(
  documentId: string,
  organisationId: string,
): Promise<{ doc: ReferenceDocument; version: ReferenceDocumentVersion | null } | null> {
  const db = getOrgScopedDb('referenceDocumentService.getByIdWithCurrentVersion');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [doc] = await db
    .select()
    .from(referenceDocuments)
    .where(and(
      eq(referenceDocuments.id, documentId),
      eq(referenceDocuments.organisationId, organisationId),
    ))
    .limit(1);
  if (!doc) return null;

  if (!doc.currentVersionId) return { doc, version: null };

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [version] = await db
    .select()
    .from(referenceDocumentVersions)
    .where(eq(referenceDocumentVersions.id, doc.currentVersionId))
    .limit(1);

  return { doc, version: version ?? null };
}

export async function listVersions(documentId: string, organisationId: string): Promise<ReferenceDocumentVersion[]> {
  // Parent-row check enforces org scope; version rows inherit via the parent.
  await getDoc(documentId, organisationId);
  const db = getOrgScopedDb('referenceDocumentService.listVersions');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  return db
    .select()
    .from(referenceDocumentVersions)
    .where(eq(referenceDocumentVersions.documentId, documentId))
    .orderBy(desc(referenceDocumentVersions.version));
}

export async function getVersion(
  documentId: string,
  organisationId: string,
  version: number,
): Promise<ReferenceDocumentVersion | null> {
  await getDoc(documentId, organisationId);
  const db = getOrgScopedDb('referenceDocumentService.getVersion');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [row] = await db
    .select()
    .from(referenceDocumentVersions)
    .where(and(
      eq(referenceDocumentVersions.documentId, documentId),
      eq(referenceDocumentVersions.version, version),
    ))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// persistChunks — bulk-insert embedding chunks (idempotent, used by jobs 3C/3D)
// Called from within the job handler's withOrgTx context.
// ON CONFLICT DO NOTHING makes replays safe per spec §10.1 / §10.6.
// ---------------------------------------------------------------------------

export async function persistChunks(input: {
  chunks: Array<{
    organisationId: string;
    documentId: string;
    versionId: string;
    chunkIndex: number;
    embeddingModel: string;
    embedding: number[];
    content: string;
    tokenCount: number;
  }>;
}): Promise<void> {
  if (input.chunks.length === 0) return;
  const db = getOrgScopedDb('referenceDocumentService.persistChunks');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .insert(referenceDocumentChunks)
    .values(input.chunks)
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// writeVersionAndEnqueueJobs — mark summary stale on version write, then
// enqueue document:summarise and document:chunk-embed jobs.
//
// Uses its own db.transaction() so that boss.send() fires strictly AFTER
// the transaction commits (spec invariant §1.5 #11). Never enqueue inside
// the transaction callback.
// ---------------------------------------------------------------------------

export async function writeVersionAndEnqueueJobs(input: {
  documentId: string;
  organisationId: string;
  versionId: string;
  boss: PgBoss;
}): Promise<void> {
  await getOrgScopedDb('referenceDocumentService.writeVersionAndEnqueueJobs').transaction(async (tx) => {
    await tx
      .update(referenceDocuments)
      .set({ summaryStale: true, updatedAt: new Date() })
      .where(and(
        eq(referenceDocuments.id, input.documentId),
        eq(referenceDocuments.organisationId, input.organisationId),
      ));
  });

  // Enqueue AFTER the transaction commits — spec invariant §1.5 #11.
  const payload = {
    organisationId: input.organisationId,
    documentId: input.documentId,
    versionId: input.versionId,
  };
  await input.boss.send('document:summarise', payload);
  await input.boss.send('document:chunk-embed', payload);
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function getDoc(documentId: string, organisationId: string): Promise<ReferenceDocument> {
  const db = getOrgScopedDb('referenceDocumentService.getDoc');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [doc] = await db
    .select()
    .from(referenceDocuments)
    .where(and(
      eq(referenceDocuments.id, documentId),
      eq(referenceDocuments.organisationId, organisationId),
    ))
    .limit(1);
  if (!doc) {
    throw { statusCode: 404, code: CACHED_CONTEXT_DOC_NOT_FOUND, message: `Reference document ${documentId} not found` };
  }
  return doc;
}
