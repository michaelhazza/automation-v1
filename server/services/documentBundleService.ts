import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  documentBundles,
  documentBundleMembers,
  documentBundleAttachments,
  bundleSuggestionDismissals,
  referenceDocuments,
} from '../db/schema/index.js';
import { agents } from '../db/schema/agents.js';
import { tasks } from '../db/schema/tasks.js';
import { scheduledTasks } from '../db/schema/scheduledTasks.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import type { DocumentBundle, NewDocumentBundle } from '../db/schema/documentBundles.js';
import type { DocumentBundleMember } from '../db/schema/documentBundleMembers.js';
import type { DocumentBundleAttachment } from '../db/schema/documentBundleAttachments.js';
import type { AttachmentSubjectType } from '../db/schema/documentBundleAttachments.js';
import type { ReferenceDocument } from '../db/schema/referenceDocuments.js';
import { computeDocSetHash } from './documentBundleServicePure.js';
import { logCachedContextWrite } from '../lib/cachedContextWriteScope.js';

// ---------------------------------------------------------------------------
// documentBundleService — stateful I/O for document bundles
// Owns CRUD for document_bundles, document_bundle_members,
// document_bundle_attachments, and bundle_suggestion_dismissals.
//
// Every public method takes `organisationId` explicitly and scopes queries to
// it (Layer 2 of the three-layer isolation contract). All DB access goes
// through `getOrgScopedDb()` (Layer 1B). RLS is the silent Layer 3 backstop.
// ---------------------------------------------------------------------------

export type {
  DocumentBundle,
  DocumentBundleMember,
  DocumentBundleAttachment,
  AttachmentSubjectType,
};
export { computeDocSetHash };

export type BundleSuggestion =
  | { suggest: false }
  | {
      suggest: true;
      alsoUsedOn: number;
      docSetHash: string;
      unnamedBundleId: string;
    };

export interface BundleSuggestionDismissalResult {
  id: string;
  userId: string;
  docSetHash: string;
  dismissedAt: string;
}

// Error code constants
export const CACHED_CONTEXT_BUNDLE_NAME_TAKEN      = 'CACHED_CONTEXT_BUNDLE_NAME_TAKEN';
export const CACHED_CONTEXT_BUNDLE_ALREADY_NAMED   = 'CACHED_CONTEXT_BUNDLE_ALREADY_NAMED';
export const CACHED_CONTEXT_BUNDLE_NOT_FOUND       = 'CACHED_CONTEXT_BUNDLE_NOT_FOUND';
export const CACHED_CONTEXT_DOC_CANT_ADD_DEPRECATED = 'CACHED_CONTEXT_DOC_CANT_ADD_DEPRECATED';
export const CACHED_CONTEXT_BUNDLE_SUBJECT_NOT_FOUND = 'CACHED_CONTEXT_BUNDLE_SUBJECT_NOT_FOUND';
export const CACHED_CONTEXT_BUNDLE_SUBJECT_ORG_MISMATCH = 'CACHED_CONTEXT_BUNDLE_SUBJECT_ORG_MISMATCH';
export const CACHED_CONTEXT_BUNDLE_NAME_EMPTY      = 'CACHED_CONTEXT_BUNDLE_NAME_EMPTY';

// ---------------------------------------------------------------------------
// create — explicit named-bundle creation (API completeness; not surfaced in
// the v1 UI per §3.6.7).
// ---------------------------------------------------------------------------
export async function create(input: {
  organisationId: string;
  subaccountId: string | null;
  name: string;
  description?: string;
  createdByUserId: string;
}): Promise<DocumentBundle> {
  if (!input.name.trim()) {
    throw { statusCode: 400, code: CACHED_CONTEXT_BUNDLE_NAME_EMPTY, message: 'Bundle name cannot be empty' };
  }
  // F2b — observability surface for cached-context writes (see
  // server/lib/cachedContextWriteScope.ts).
  logCachedContextWrite('documentBundleService.create', {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    table: 'document_bundles',
    operation: 'insert',
  }, { name: input.name });
  const db = getOrgScopedDb('documentBundleService.create');
  try {
    const [row] = await db.insert(documentBundles).values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      name: input.name.trim(),
      description: input.description,
      isAutoCreated: false,
      createdByUserId: input.createdByUserId,
      currentVersion: 1,
    }).returning();
    return row;
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      throw { statusCode: 409, code: CACHED_CONTEXT_BUNDLE_NAME_TAKEN, message: `A bundle named "${input.name}" already exists in this org` };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// findOrCreateUnnamedBundle — core attach-flow primitive.
// Idempotent: returns the same unnamed bundle for the same (org, subaccount,
// documentIds) set. Concurrent callers converge to one row.
// ---------------------------------------------------------------------------
export async function findOrCreateUnnamedBundle(input: {
  organisationId: string;
  subaccountId: string | null;
  documentIds: string[];
  createdByUserId: string;
}): Promise<DocumentBundle> {
  const docSetHash = computeDocSetHash(input.documentIds);
  const db = getOrgScopedDb('documentBundleService.findOrCreateUnnamedBundle');

  // Fast path: find an existing auto bundle whose member set exactly matches.
  // We store docSetHash as a description sentinel to enable fast lookup.
  // The canonical lookup uses doc_set_hash stored on the bundle as description
  // sentinel prefixed with 'doc_set_hash:' for fast match.
  const existing = await db
    .select()
    .from(documentBundles)
    .where(
      and(
        eq(documentBundles.organisationId, input.organisationId),
        input.subaccountId
          ? eq(documentBundles.subaccountId, input.subaccountId)
          : isNull(documentBundles.subaccountId),
        eq(documentBundles.isAutoCreated, true),
        isNull(documentBundles.deletedAt),
        // description sentinel carries the hash for O(1) lookup
        eq(documentBundles.description, `doc_set_hash:${docSetHash}`)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Slow path: insert the bundle and its members atomically.
  return db.transaction(async (tx) => {
    // Double-check inside the transaction (race guard).
    const raceCheck = await tx
      .select()
      .from(documentBundles)
      .where(
        and(
          eq(documentBundles.organisationId, input.organisationId),
          input.subaccountId
            ? eq(documentBundles.subaccountId, input.subaccountId)
            : isNull(documentBundles.subaccountId),
          eq(documentBundles.isAutoCreated, true),
          isNull(documentBundles.deletedAt),
          eq(documentBundles.description, `doc_set_hash:${docSetHash}`)
        )
      )
      .limit(1);

    if (raceCheck.length > 0) return raceCheck[0];

    const [bundle] = await tx.insert(documentBundles).values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      name: null,
      // Store doc_set_hash as a description sentinel for fast lookup.
      description: `doc_set_hash:${docSetHash}`,
      isAutoCreated: true,
      createdByUserId: input.createdByUserId,
      currentVersion: 1,
    }).returning();

    if (input.documentIds.length > 0) {
      await tx.insert(documentBundleMembers).values(
        input.documentIds.map((documentId) => ({
          bundleId: bundle.id,
          documentId,
          addedInBundleVersion: 1,
        }))
      );
    }

    return bundle;
  });
}

// ---------------------------------------------------------------------------
// promoteToNamedBundle — one-way auto→named transition.
// Preserves bundle id, attachments, and snapshot rows.
// ---------------------------------------------------------------------------
export async function promoteToNamedBundle(input: {
  bundleId: string;
  organisationId: string;
  name: string;
  userId: string;
}): Promise<DocumentBundle> {
  if (!input.name.trim()) {
    throw { statusCode: 400, code: CACHED_CONTEXT_BUNDLE_NAME_EMPTY, message: 'Bundle name cannot be empty' };
  }

  const db = getOrgScopedDb('documentBundleService.promoteToNamedBundle');
  try {
    const updated = await db
      .update(documentBundles)
      .set({
        isAutoCreated: false,
        name: input.name.trim(),
        description: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentBundles.id, input.bundleId),
          eq(documentBundles.organisationId, input.organisationId),
          eq(documentBundles.isAutoCreated, true),
          isNull(documentBundles.deletedAt)
        )
      )
      .returning();

    if (updated.length === 0) {
      // Check if bundle exists at all within the org.
      const exists = await db.select({ id: documentBundles.id })
        .from(documentBundles)
        .where(and(
          eq(documentBundles.id, input.bundleId),
          eq(documentBundles.organisationId, input.organisationId),
        ))
        .limit(1);
      if (exists.length === 0) {
        throw { statusCode: 404, code: CACHED_CONTEXT_BUNDLE_NOT_FOUND, message: 'Bundle not found' };
      }
      throw { statusCode: 409, code: CACHED_CONTEXT_BUNDLE_ALREADY_NAMED, message: 'Bundle is already a named bundle' };
    }

    return updated[0];
  } catch (err: unknown) {
    const pgErr = err as { code?: string; statusCode?: number };
    if (pgErr?.statusCode) throw err;
    if (pgErr?.code === '23505') {
      throw { statusCode: 409, code: CACHED_CONTEXT_BUNDLE_NAME_TAKEN, message: `A bundle named "${input.name}" already exists in this org` };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// suggestBundle — check whether the post-save bundle suggestion should fire.
// Pure over queried DB state; returns same result for same inputs + same state.
// ---------------------------------------------------------------------------
export async function suggestBundle(input: {
  organisationId: string;
  subaccountId: string | null;
  userId: string;
  documentIds: string[];
  excludeSubjectId?: { subjectType: AttachmentSubjectType; subjectId: string };
}): Promise<BundleSuggestion> {
  if (input.documentIds.length < 2) return { suggest: false };

  const docSetHash = computeDocSetHash(input.documentIds);
  const db = getOrgScopedDb('documentBundleService.suggestBundle');

  // 1. Dismissal check
  const dismissed = await db
    .select({ id: bundleSuggestionDismissals.id })
    .from(bundleSuggestionDismissals)
    .where(
      and(
        eq(bundleSuggestionDismissals.organisationId, input.organisationId),
        eq(bundleSuggestionDismissals.userId, input.userId),
        eq(bundleSuggestionDismissals.docSetHash, docSetHash)
      )
    )
    .limit(1);
  if (dismissed.length > 0) return { suggest: false };

  // 2. Named bundle already exists for THIS doc set?
  // Joins document_bundles + document_bundle_members and matches by computed
  // doc-set hash. Named bundles don't retain the doc_set_hash sentinel (promote
  // clears description), so we compute from live membership.
  const namedBundles = await db
    .select({ id: documentBundles.id })
    .from(documentBundles)
    .where(
      and(
        eq(documentBundles.organisationId, input.organisationId),
        input.subaccountId
          ? eq(documentBundles.subaccountId, input.subaccountId)
          : isNull(documentBundles.subaccountId),
        eq(documentBundles.isAutoCreated, false),
        isNull(documentBundles.deletedAt)
      )
    );
  for (const nb of namedBundles) {
    const members = await db
      .select({ documentId: documentBundleMembers.documentId })
      .from(documentBundleMembers)
      .where(
        and(
          eq(documentBundleMembers.bundleId, nb.id),
          isNull(documentBundleMembers.deletedAt)
        )
      );
    const nbHash = computeDocSetHash(members.map((m) => m.documentId));
    if (nbHash === docSetHash) return { suggest: false };
  }

  // 3. Find the unnamed bundle for this doc set
  const unnamedBundle = await db
    .select({ id: documentBundles.id })
    .from(documentBundles)
    .where(
      and(
        eq(documentBundles.organisationId, input.organisationId),
        input.subaccountId
          ? eq(documentBundles.subaccountId, input.subaccountId)
          : isNull(documentBundles.subaccountId),
        eq(documentBundles.isAutoCreated, true),
        isNull(documentBundles.deletedAt),
        eq(documentBundles.description, `doc_set_hash:${docSetHash}`)
      )
    )
    .limit(1);

  if (unnamedBundle.length === 0) return { suggest: false };

  const bundleId = unnamedBundle[0].id;

  // 4. Count distinct active attachment subjects (excluding the current subject if provided)
  const attachments = await db
    .select({
      subjectType: documentBundleAttachments.subjectType,
      subjectId: documentBundleAttachments.subjectId,
    })
    .from(documentBundleAttachments)
    .where(
      and(
        eq(documentBundleAttachments.bundleId, bundleId),
        eq(documentBundleAttachments.organisationId, input.organisationId),
        isNull(documentBundleAttachments.deletedAt)
      )
    );

  let distinctSubjects = attachments.filter((a) => {
    if (!input.excludeSubjectId) return true;
    return !(a.subjectType === input.excludeSubjectId.subjectType && a.subjectId === input.excludeSubjectId.subjectId);
  });

  const count = distinctSubjects.length;

  if (count < 1) return { suggest: false };

  return {
    suggest: true,
    alsoUsedOn: count,
    docSetHash,
    unnamedBundleId: bundleId,
  };
}

// ---------------------------------------------------------------------------
// dismissBundleSuggestion — record a permanent dismissal. Idempotent.
// ---------------------------------------------------------------------------
export async function dismissBundleSuggestion(input: {
  organisationId: string;
  subaccountId: string | null;
  userId: string;
  documentIds: string[];
}): Promise<BundleSuggestionDismissalResult> {
  const docSetHash = computeDocSetHash(input.documentIds);
  const db = getOrgScopedDb('documentBundleService.dismissBundleSuggestion');

  const [row] = await db
    .insert(bundleSuggestionDismissals)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      userId: input.userId,
      docSetHash,
    })
    .onConflictDoUpdate({
      // BUNDLE-DISMISS-RLS: target matches the 3-column unique index
      // (migration 0231) — organisation_id scopes dismissals per org.
      target: [bundleSuggestionDismissals.organisationId, bundleSuggestionDismissals.userId, bundleSuggestionDismissals.docSetHash],
      set: { dismissedAt: sql`now()` },
    })
    .returning();

  return {
    id: row.id,
    userId: row.userId,
    docSetHash: row.docSetHash,
    dismissedAt: row.dismissedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// addMember / removeMember — membership edits; each bumps currentVersion.
// ---------------------------------------------------------------------------
export async function addMember(input: {
  bundleId: string;
  organisationId: string;
  documentId: string;
}): Promise<DocumentBundleMember> {
  const db = getOrgScopedDb('documentBundleService.addMember');
  return db.transaction(async (tx) => {
    // Verify document isn't deprecated (and belongs to same org).
    const [doc] = await tx
      .select({ id: referenceDocuments.id, deprecatedAt: referenceDocuments.deprecatedAt })
      .from(referenceDocuments)
      .where(and(
        eq(referenceDocuments.id, input.documentId),
        eq(referenceDocuments.organisationId, input.organisationId),
      ))
      .limit(1);
    if (!doc) {
      throw { statusCode: 404, code: CACHED_CONTEXT_BUNDLE_SUBJECT_NOT_FOUND, message: 'Document not found' };
    }
    if (doc.deprecatedAt) {
      throw { statusCode: 409, code: CACHED_CONTEXT_DOC_CANT_ADD_DEPRECATED, message: 'Cannot add a deprecated document to a bundle' };
    }

    // Bump bundle version (scoped to org).
    const [bundle] = await tx
      .update(documentBundles)
      .set({ currentVersion: sql`current_version + 1`, updatedAt: new Date() })
      .where(and(
        eq(documentBundles.id, input.bundleId),
        eq(documentBundles.organisationId, input.organisationId),
        isNull(documentBundles.deletedAt),
      ))
      .returning({ currentVersion: documentBundles.currentVersion });

    if (!bundle) {
      throw { statusCode: 404, code: CACHED_CONTEXT_BUNDLE_NOT_FOUND, message: 'Bundle not found' };
    }

    const [member] = await tx.insert(documentBundleMembers).values({
      bundleId: input.bundleId,
      documentId: input.documentId,
      addedInBundleVersion: bundle.currentVersion,
    }).returning();

    return member;
  });
}

export async function removeMember(input: {
  bundleId: string;
  organisationId: string;
  documentId: string;
}): Promise<void> {
  const db = getOrgScopedDb('documentBundleService.removeMember');
  await db.transaction(async (tx) => {
    const [bundle] = await tx
      .update(documentBundles)
      .set({ currentVersion: sql`current_version + 1`, updatedAt: new Date() })
      .where(and(
        eq(documentBundles.id, input.bundleId),
        eq(documentBundles.organisationId, input.organisationId),
        isNull(documentBundles.deletedAt),
      ))
      .returning({ currentVersion: documentBundles.currentVersion });

    if (!bundle) {
      throw { statusCode: 404, code: CACHED_CONTEXT_BUNDLE_NOT_FOUND, message: 'Bundle not found' };
    }

    await tx
      .update(documentBundleMembers)
      .set({ deletedAt: new Date(), removedInBundleVersion: bundle.currentVersion })
      .where(
        and(
          eq(documentBundleMembers.bundleId, input.bundleId),
          eq(documentBundleMembers.documentId, input.documentId),
          isNull(documentBundleMembers.deletedAt)
        )
      );
  });
}

// ---------------------------------------------------------------------------
// attach / detach — link a bundle to an agent / task / scheduled_task.
// ---------------------------------------------------------------------------
export async function attach(input: {
  bundleId: string;
  subjectType: AttachmentSubjectType;
  subjectId: string;
  attachedByUserId: string;
  organisationId: string;
  subaccountId: string | null;
}): Promise<DocumentBundleAttachment> {
  const db = getOrgScopedDb('documentBundleService.attach');

  // Verify bundle exists and belongs to the caller's org.
  const [bundle] = await db
    .select({ id: documentBundles.id })
    .from(documentBundles)
    .where(and(
      eq(documentBundles.id, input.bundleId),
      eq(documentBundles.organisationId, input.organisationId),
      isNull(documentBundles.deletedAt),
    ))
    .limit(1);
  if (!bundle) {
    throw { statusCode: 404, code: CACHED_CONTEXT_BUNDLE_NOT_FOUND, message: 'Bundle not found' };
  }

  // Verify subject exists and belongs to same org.
  await verifySubjectExists(input.subjectType, input.subjectId, input.organisationId);

  // Idempotent: check for existing live attachment.
  const existing = await db
    .select()
    .from(documentBundleAttachments)
    .where(
      and(
        eq(documentBundleAttachments.bundleId, input.bundleId),
        eq(documentBundleAttachments.organisationId, input.organisationId),
        eq(documentBundleAttachments.subjectType, input.subjectType),
        eq(documentBundleAttachments.subjectId, input.subjectId),
        isNull(documentBundleAttachments.deletedAt)
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [row] = await db.insert(documentBundleAttachments).values({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    bundleId: input.bundleId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    attachmentMode: 'always_load',
    attachedByUserId: input.attachedByUserId,
  }).returning();

  return row;
}

export async function detach(input: {
  bundleId: string;
  organisationId: string;
  subjectType: AttachmentSubjectType;
  subjectId: string;
}): Promise<void> {
  const db = getOrgScopedDb('documentBundleService.detach');
  await db
    .update(documentBundleAttachments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(documentBundleAttachments.bundleId, input.bundleId),
        eq(documentBundleAttachments.organisationId, input.organisationId),
        eq(documentBundleAttachments.subjectType, input.subjectType),
        eq(documentBundleAttachments.subjectId, input.subjectId),
        isNull(documentBundleAttachments.deletedAt)
      )
    );
}

// ---------------------------------------------------------------------------
// List / get methods
// ---------------------------------------------------------------------------
export async function listBundles(
  organisationId: string,
  filters?: { subaccountId?: string | null }
): Promise<DocumentBundle[]> {
  const db = getOrgScopedDb('documentBundleService.listBundles');
  const conds = [
    eq(documentBundles.organisationId, organisationId),
    eq(documentBundles.isAutoCreated, false),
    isNull(documentBundles.deletedAt),
  ];
  if (filters?.subaccountId !== undefined) {
    conds.push(
      filters.subaccountId
        ? eq(documentBundles.subaccountId, filters.subaccountId)
        : isNull(documentBundles.subaccountId)
    );
  }
  return db.select().from(documentBundles).where(and(...conds));
}

export async function listAllBundles(
  organisationId: string,
  filters?: { subaccountId?: string | null }
): Promise<DocumentBundle[]> {
  const db = getOrgScopedDb('documentBundleService.listAllBundles');
  const conds = [
    eq(documentBundles.organisationId, organisationId),
    isNull(documentBundles.deletedAt),
  ];
  if (filters?.subaccountId !== undefined) {
    conds.push(
      filters.subaccountId
        ? eq(documentBundles.subaccountId, filters.subaccountId)
        : isNull(documentBundles.subaccountId)
    );
  }
  return db.select().from(documentBundles).where(and(...conds));
}

export async function getBundleWithMembers(bundleId: string, organisationId: string): Promise<{
  bundle: DocumentBundle;
  members: Array<{ member: DocumentBundleMember; document: ReferenceDocument }>;
} | null> {
  const db = getOrgScopedDb('documentBundleService.getBundleWithMembers');
  const [bundle] = await db
    .select()
    .from(documentBundles)
    .where(and(
      eq(documentBundles.id, bundleId),
      eq(documentBundles.organisationId, organisationId),
    ))
    .limit(1);

  if (!bundle) return null;

  const rows = await db
    .select({ member: documentBundleMembers, document: referenceDocuments })
    .from(documentBundleMembers)
    .innerJoin(referenceDocuments, eq(documentBundleMembers.documentId, referenceDocuments.id))
    .where(
      and(
        eq(documentBundleMembers.bundleId, bundleId),
        eq(referenceDocuments.organisationId, organisationId),
        isNull(documentBundleMembers.deletedAt)
      )
    );

  return { bundle, members: rows };
}

export async function listAttachmentsForSubject(input: {
  organisationId: string;
  subjectType: AttachmentSubjectType;
  subjectId: string;
}): Promise<DocumentBundleAttachment[]> {
  const db = getOrgScopedDb('documentBundleService.listAttachmentsForSubject');
  return db
    .select()
    .from(documentBundleAttachments)
    .innerJoin(documentBundles, eq(documentBundleAttachments.bundleId, documentBundles.id))
    .where(
      and(
        eq(documentBundleAttachments.organisationId, input.organisationId),
        eq(documentBundleAttachments.subjectType, input.subjectType),
        eq(documentBundleAttachments.subjectId, input.subjectId),
        isNull(documentBundleAttachments.deletedAt),
        isNull(documentBundles.deletedAt)
      )
    )
    .then((rows) => rows.map((r) => r.document_bundle_attachments));
}

export async function softDelete(bundleId: string, organisationId: string): Promise<void> {
  const db = getOrgScopedDb('documentBundleService.softDelete');
  await db
    .update(documentBundles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(documentBundles.id, bundleId),
      eq(documentBundles.organisationId, organisationId),
      isNull(documentBundles.deletedAt),
    ));
}

// ---------------------------------------------------------------------------
// Internal helper — verify the subject row exists and belongs to the org.
// ---------------------------------------------------------------------------
async function verifySubjectExists(
  subjectType: AttachmentSubjectType,
  subjectId: string,
  organisationId: string
): Promise<void> {
  const db = getOrgScopedDb('documentBundleService.verifySubjectExists');
  let row: Array<{ organisationId: string }> = [];

  if (subjectType === 'agent') {
    row = await db
      .select({ organisationId: agents.organisationId })
      .from(agents)
      .where(and(eq(agents.id, subjectId), eq(agents.organisationId, organisationId)))
      .limit(1);
  } else if (subjectType === 'task') {
    row = await db
      .select({ organisationId: tasks.organisationId })
      .from(tasks)
      .where(and(eq(tasks.id, subjectId), eq(tasks.organisationId, organisationId)))
      .limit(1);
  } else if (subjectType === 'scheduled_task') {
    row = await db
      .select({ organisationId: scheduledTasks.organisationId })
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, subjectId), eq(scheduledTasks.organisationId, organisationId)))
      .limit(1);
  }

  if (row.length === 0) {
    throw { statusCode: 404, code: CACHED_CONTEXT_BUNDLE_SUBJECT_NOT_FOUND, message: `${subjectType} not found` };
  }
  if (row[0].organisationId !== organisationId) {
    throw { statusCode: 403, code: CACHED_CONTEXT_BUNDLE_SUBJECT_ORG_MISMATCH, message: 'Subject belongs to a different organisation' };
  }
}
