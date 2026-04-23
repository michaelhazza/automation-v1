import { db } from '../db/index.js';
import { referenceDocuments, referenceDocumentVersions } from '../db/schema/index.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { ReferenceDocument, NewReferenceDocument } from '../db/schema/referenceDocuments.js';
import type { ReferenceDocumentVersion } from '../db/schema/referenceDocumentVersions.js';
import { hashContent, hashSerialized, serializeDocument, DOC_DELIMITER_END } from './referenceDocumentServicePure.js';
import { countTokens, SUPPORTED_MODEL_FAMILIES } from './providers/anthropicAdapter.js';

// ---------------------------------------------------------------------------
// Reference Document Service — stateful I/O
// Owns the CRUD + versioning + token-counting lifecycle for reference_documents
// and reference_document_versions.
//
// Auth: service trusts pre-validated organisationId / subaccountId from route
// handlers. Route handlers enforce org scope and permission keys.
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

  // Count tokens for all model families before any DB write. If this fails the
  // document is not persisted — strict failure policy per spec §6.1.
  const tokenCounts = await computeAllTokenCounts(input.content);
  const serialized = serializeDocument({ documentId: 'placeholder', version: 1, content: input.content });
  const contentHash = hashContent(input.content);

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

    // Now serialize with the real document ID.
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
      .where(eq(referenceDocuments.id, docRow.id))
      .returning();

    return updated;
  });
}

// ---------------------------------------------------------------------------
// updateContent — idempotent by contentHash; rolls back on token-count failure.
// ---------------------------------------------------------------------------

export async function updateContent(input: {
  documentId: string;
  content: string;
  updatedByUserId: string;
  notes?: string;
}): Promise<ReferenceDocumentVersion> {
  assertNoDelimiter(input.content);

  const doc = await getDoc(input.documentId);

  // Idempotent: if content matches current version, return existing.
  if (doc.currentVersionId) {
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
      .where(eq(referenceDocuments.id, doc.id));

    return versionRow;
  });
}

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

export async function rename(input: { documentId: string; newName: string }): Promise<ReferenceDocument> {
  const doc = await getDoc(input.documentId);
  try {
    const [updated] = await db
      .update(referenceDocuments)
      .set({ name: input.newName, updatedAt: new Date() })
      .where(eq(referenceDocuments.id, doc.id))
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

export async function pause(documentId: string, _userId: string): Promise<void> {
  await getDoc(documentId);
  await db
    .update(referenceDocuments)
    .set({ pausedAt: new Date(), updatedAt: new Date() })
    .where(eq(referenceDocuments.id, documentId));
}

export async function resume(documentId: string, _userId: string): Promise<void> {
  await getDoc(documentId);
  await db
    .update(referenceDocuments)
    .set({ pausedAt: null, updatedAt: new Date() })
    .where(eq(referenceDocuments.id, documentId));
}

export async function deprecate(input: { documentId: string; reason: string; userId: string }): Promise<void> {
  const doc = await getDoc(input.documentId);
  if (doc.deprecatedAt) {
    throw { statusCode: 409, code: CACHED_CONTEXT_DOC_ALREADY_DEPRECATED, message: 'Document is already deprecated' };
  }
  await db
    .update(referenceDocuments)
    .set({ deprecatedAt: new Date(), deprecationReason: input.reason, updatedAt: new Date() })
    .where(eq(referenceDocuments.id, input.documentId));
}

export async function softDelete(documentId: string, _userId: string): Promise<void> {
  await getDoc(documentId);
  await db
    .update(referenceDocuments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(referenceDocuments.id, documentId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listByOrg(
  organisationId: string,
  filters?: { subaccountId?: string | null; includeDeleted?: boolean },
): Promise<ReferenceDocument[]> {
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
  return db
    .select()
    .from(referenceDocuments)
    .where(and(...conditions))
    .orderBy(desc(referenceDocuments.createdAt));
}

export async function getByIdWithCurrentVersion(
  documentId: string,
): Promise<{ doc: ReferenceDocument; version: ReferenceDocumentVersion } | null> {
  const [doc] = await db
    .select()
    .from(referenceDocuments)
    .where(eq(referenceDocuments.id, documentId))
    .limit(1);
  if (!doc) return null;

  if (!doc.currentVersionId) return { doc, version: null as unknown as ReferenceDocumentVersion };

  const [version] = await db
    .select()
    .from(referenceDocumentVersions)
    .where(eq(referenceDocumentVersions.id, doc.currentVersionId))
    .limit(1);

  return { doc, version: version ?? null as unknown as ReferenceDocumentVersion };
}

export async function listVersions(documentId: string): Promise<ReferenceDocumentVersion[]> {
  return db
    .select()
    .from(referenceDocumentVersions)
    .where(eq(referenceDocumentVersions.documentId, documentId))
    .orderBy(desc(referenceDocumentVersions.version));
}

export async function getVersion(documentId: string, version: number): Promise<ReferenceDocumentVersion | null> {
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
// Internal helper
// ---------------------------------------------------------------------------

async function getDoc(documentId: string): Promise<ReferenceDocument> {
  const [doc] = await db
    .select()
    .from(referenceDocuments)
    .where(eq(referenceDocuments.id, documentId))
    .limit(1);
  if (!doc) {
    throw { statusCode: 404, code: CACHED_CONTEXT_DOC_NOT_FOUND, message: `Reference document ${documentId} not found` };
  }
  return doc;
}
