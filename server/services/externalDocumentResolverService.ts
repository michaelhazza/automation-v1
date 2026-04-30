import { eq, and, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { OrgScopedTx } from '../db/index.js';
import { logger } from '../lib/logger.js';
import {
  EXTERNAL_DOC_HARD_TOKEN_LIMIT,
  EXTERNAL_DOC_MAX_STALENESS_MINUTES,
  EXTERNAL_DOC_MIN_CONTENT_TOKENS,
  EXTERNAL_DOC_NULL_REVISION_TTL_MINUTES,
  EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS,
  EXTERNAL_DOC_SINGLE_FLIGHT_MAX_ENTRIES,
} from '../lib/constants.js';
import { documentCache } from '../db/schema/documentCache.js';
import { documentFetchEvents, type FetchFailureReason } from '../db/schema/documentFetchEvents.js';
import { referenceDocuments } from '../db/schema/referenceDocuments.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { googleDriveResolver, ResolverError } from './resolvers/googleDriveResolver.js';
import {
  countTokensApprox,
  isPastStalenessBoundary,
  isResolverVersionStale,
  truncateContentToTokenBudget,
} from './externalDocumentResolverPure.js';
import { SingleFlightGuard } from './externalDocumentSingleFlight.js';
import { RetrySuppressor } from './externalDocumentRetrySuppression.js';
import type { ResolveParams, ResolvedDocument } from './externalDocumentResolverTypes.js';

const singleFlight = new SingleFlightGuard<ResolvedDocument>(EXTERNAL_DOC_SINGLE_FLIGHT_MAX_ENTRIES);
const retrySuppressor = new RetrySuppressor(EXTERNAL_DOC_RETRY_SUPPRESSION_WINDOW_MS);

// hashtext returns int4; widen to bigint for pg_advisory_xact_lock(bigint).
// Lock auto-releases on transaction commit/rollback.
// Caller MUST be inside a Drizzle transaction (tx).
async function withAdvisoryLock<T>(tx: any, key: string, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`);
  return fn();
}

export const externalDocumentResolverService = {
  async resolve(params: ResolveParams): Promise<ResolvedDocument> {
    const key = `google_drive:${params.fileId}:${params.connectionId}`;
    return singleFlight.run(key, () => doResolve(params));
  },
};

async function doResolve(p: ResolveParams): Promise<ResolvedDocument> {
  const db = getOrgScopedDb('externalDocumentResolverService.resolve');
  const resolver = googleDriveResolver;
  const startedAt = Date.now();
  // Invariant #11: TTL boundary uses fetch-start time. Captured ONCE at the top.
  const fetchStart = new Date();

  // 1. Token refresh
  let accessToken: string;
  try {
    if (p.accessToken) {
      accessToken = p.accessToken;
    } else {
      const conn = await integrationConnectionService.getDecryptedConnection(
        p.subaccountId,
        'google_drive',
        p.organisationId,
        p.connectionId,
      );
      accessToken = conn.accessToken;
    }
  } catch {
    return emitFailure(db, p, resolver.resolverVersion, 'auth_revoked', null, startedAt);
  }

  // 2. Cache lookup
  const cached = await db.select().from(documentCache).where(and(
    eq(documentCache.organisationId, p.organisationId),
    eq(documentCache.provider, 'google_drive'),
    eq(documentCache.fileId, p.fileId),
    eq(documentCache.connectionId, p.connectionId),
  )).limit(1);
  let cacheRow = cached[0];

  // Suppression check: skip re-attempt if this ref recently failed with a suppressible reason.
  const suppressibleReasons = ['auth_revoked', 'rate_limited'] as const;
  for (const reason of suppressibleReasons) {
    if (retrySuppressor.shouldSuppress(p.referenceId, reason)) {
      if (cacheRow) {
        const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
        if (!stale) return serveCacheAsDegraded(db, p, resolver.resolverVersion, cacheRow, reason, startedAt);
      }
      return emitFailure(db, p, resolver.resolverVersion, reason, null, startedAt);
    }
  }

  // 3. Resolver-version check
  const versionStale = cacheRow ? isResolverVersionStale(cacheRow.resolverVersion, resolver.resolverVersion) : true;

  // 4. Change detection
  let revisionMatches = false;
  let providerMimeType: string | null = null;
  let providerName: string | null = null;
  let providerRevisionId: string | null = null;
  if (cacheRow && !versionStale) {
    try {
      const meta = await resolver.checkRevision(p.fileId, accessToken);
      if (meta) {
        providerMimeType = meta.mimeType;
        providerName = meta.name;
        providerRevisionId = meta.revisionId;
        const mimeMismatch = meta.mimeType !== p.expectedMimeType;
        if (mimeMismatch) {
          logger.warn('document_resolve_mime_mismatch', {
            referenceId: p.referenceId,
            fileId: p.fileId,
            expectedMimeType: p.expectedMimeType,
            providerMimeType: meta.mimeType,
            mimeMismatch: true,
          });
        }
        revisionMatches = !mimeMismatch && meta.revisionId !== null && meta.revisionId === cacheRow.revisionId;
        // Null-revisionId TTL fallback: if provider exposes no revision ID, treat
        // cache as fresh if fetched within the null-revision TTL window.
        if (!revisionMatches && !mimeMismatch && meta.revisionId === null) {
          const nullRevisionStale = isPastStalenessBoundary(
            cacheRow.fetchedAt,
            fetchStart,
            EXTERNAL_DOC_NULL_REVISION_TTL_MINUTES,
          );
          if (!nullRevisionStale) revisionMatches = true;
        }
      }
    } catch (err) {
      if (cacheRow) {
        const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
        if (!stale) {
          return serveCacheAsDegraded(db, p, resolver.resolverVersion, cacheRow, mapResolverError(err), startedAt);
        }
      }
      return emitFailure(db, p, resolver.resolverVersion, mapResolverError(err), null, startedAt);
    }
  }

  // 5a. Cache hit + revision match + version current — serve cache
  if (cacheRow && !versionStale && revisionMatches) {
    return serveCacheAsActive(db, p, resolver.resolverVersion, cacheRow, providerRevisionId, startedAt);
  }

  // 5b. Fetch
  let rawContent: string;
  try {
    rawContent = await resolver.fetchContent(p.fileId, providerMimeType ?? p.expectedMimeType, accessToken);
  } catch (err) {
    const reason = mapResolverError(err);
    if (cacheRow) {
      const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
      if (!stale) return serveCacheAsDegraded(db, p, resolver.resolverVersion, cacheRow, reason, startedAt);
    }
    return emitFailure(db, p, resolver.resolverVersion, reason, null, startedAt);
  }

  // 6. Minimum-content check
  const rawTokens = countTokensApprox(rawContent);
  if (rawTokens < EXTERNAL_DOC_MIN_CONTENT_TOKENS) {
    if (cacheRow) {
      const stale = isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_MAX_STALENESS_MINUTES);
      if (!stale) return serveCacheAsDegraded(db, p, resolver.resolverVersion, cacheRow, 'unsupported_content', startedAt);
    }
    return emitFailure(db, p, resolver.resolverVersion, 'unsupported_content', null, startedAt);
  }

  // 7. Truncate to per-document hard limit
  const truncation = truncateContentToTokenBudget(rawContent, EXTERNAL_DOC_HARD_TOKEN_LIMIT);
  const tokensUsed = countTokensApprox(truncation.content);
  const tokensBeforeTruncation = truncation.truncated ? rawTokens : null;

  // 8. Cache upsert inside advisory lock (fetch-outside-lock, write-inside-lock)
  // Steps 9 (state transition) and 10 (audit log) are inside the same transaction
  // to satisfy §17.8 atomicity.
  const contentHash = createHash('sha256').update(truncation.content).digest('hex');
  let fetchedAt = new Date();
  let peerBeatUs = false;
  await db.transaction(async (tx) => {
    await withAdvisoryLock(tx, `external_doc:google_drive:${p.fileId}:${p.connectionId}`, async () => {
      // Double-check: did a peer worker write a matching row while we were fetching?
      const peer = await tx.select().from(documentCache).where(and(
        eq(documentCache.organisationId, p.organisationId),
        eq(documentCache.provider, 'google_drive'),
        eq(documentCache.fileId, p.fileId),
        eq(documentCache.connectionId, p.connectionId),
      )).limit(1);
      const peerRow = peer[0];
      if (
        peerRow &&
        peerRow.resolverVersion === resolver.resolverVersion &&
        peerRow.revisionId !== null &&
        peerRow.revisionId === providerRevisionId &&
        peerRow.fetchedAt >= fetchStart
      ) {
        // Peer beat us; discard our fetch and use their row.
        // serveCacheAsActive handles state + audit for this path.
        cacheRow = peerRow;
        fetchedAt = peerRow.fetchedAt;
        peerBeatUs = true;
        return;
      }
      // No matching peer row — write our content
      await tx.insert(documentCache).values({
        organisationId: p.organisationId,
        subaccountId: p.subaccountId,
        provider: 'google_drive',
        fileId: p.fileId,
        connectionId: p.connectionId,
        content: truncation.content,
        revisionId: providerRevisionId,
        fetchedAt,
        contentSizeTokens: tokensUsed,
        contentHash,
        resolverVersion: resolver.resolverVersion,
      }).onConflictDoUpdate({
        target: [documentCache.provider, documentCache.fileId, documentCache.connectionId],
        set: {
          content: truncation.content,
          revisionId: providerRevisionId,
          fetchedAt,
          contentSizeTokens: tokensUsed,
          contentHash,
          resolverVersion: resolver.resolverVersion,
          updatedAt: sql`now()`,
        },
      });

      // 9. State transition (inline with tx for atomicity — §17.8)
      if (p.referenceType === 'reference_document') {
        await tx.update(referenceDocuments)
          .set({ attachmentState: 'active', updatedAt: sql`now()` })
          .where(and(
            eq(referenceDocuments.id, p.referenceId),
            eq(referenceDocuments.organisationId, p.organisationId),
          ));
      }

      // 10. Audit-log write (inside transaction — §17.8)
      await tx.insert(documentFetchEvents).values({
        organisationId: p.organisationId,
        subaccountId: p.subaccountId,
        referenceId: p.referenceId,
        referenceType: p.referenceType,
        runId: p.runId,
        cacheHit: false,
        provider: 'google_drive',
        docName: providerName ?? p.docName,
        revisionId: providerRevisionId,
        tokensUsed,
        tokensBeforeTruncation,
        resolverVersion: resolver.resolverVersion,
        failureReason: null,
      });
    });
  });

  // If a peer beat us, delegate to serveCacheAsActive which handles its own state + audit.
  if (peerBeatUs) {
    return serveCacheAsActive(db, p, resolver.resolverVersion, cacheRow!, providerRevisionId, startedAt);
  }

  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    tokensUsed,
    failureReason: null,
  });

  return {
    referenceId: p.referenceId,
    content: truncation.content,
    provenance: {
      provider: 'google_drive',
      docName: providerName ?? p.docName,
      fetchedAt: fetchedAt.toISOString(),
      revisionId: providerRevisionId,
      isStale: false,
      truncated: truncation.truncated,
      tokensRemovedByTruncation: truncation.truncated ? truncation.tokensRemoved : null,
    },
    tokensUsed,
    cacheHit: false,
    failureReason: null,
  };
}

async function serveCacheAsActive(
  db: OrgScopedTx,
  p: ResolveParams,
  resolverVersion: number,
  cacheRow: typeof documentCache.$inferSelect,
  revisionId: string | null,
  startedAt: number,
): Promise<ResolvedDocument> {
  await transitionState(db, p.referenceType, p.referenceId, p.organisationId, 'active');
  await db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: true,
    provider: 'google_drive',
    docName: p.docName,
    revisionId: revisionId ?? cacheRow.revisionId,
    tokensUsed: cacheRow.contentSizeTokens,
    tokensBeforeTruncation: null,
    resolverVersion,
    failureReason: null,
  });
  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: true,
    durationMs: Date.now() - startedAt,
    tokensUsed: cacheRow.contentSizeTokens,
    failureReason: null,
  });
  return {
    referenceId: p.referenceId,
    content: cacheRow.content,
    provenance: {
      provider: 'google_drive',
      docName: p.docName,
      fetchedAt: cacheRow.fetchedAt.toISOString(),
      revisionId: cacheRow.revisionId,
      isStale: false,
      truncated: false,
      tokensRemovedByTruncation: null,
    },
    tokensUsed: cacheRow.contentSizeTokens,
    cacheHit: true,
    failureReason: null,
  };
}

async function serveCacheAsDegraded(
  db: OrgScopedTx,
  p: ResolveParams,
  resolverVersion: number,
  cacheRow: typeof documentCache.$inferSelect,
  reason: FetchFailureReason,
  startedAt: number,
): Promise<ResolvedDocument> {
  if (reason === 'auth_revoked' || reason === 'rate_limited') {
    retrySuppressor.recordFailure(p.referenceId, reason);
  }
  await transitionState(db, p.referenceType, p.referenceId, p.organisationId, 'degraded');
  // Invariant #12: idempotent failure writes via onConflictDoNothing
  await db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: true,
    provider: 'google_drive',
    docName: p.docName,
    revisionId: cacheRow.revisionId,
    tokensUsed: cacheRow.contentSizeTokens,
    tokensBeforeTruncation: null,
    resolverVersion,
    failureReason: reason,
  }).onConflictDoNothing();
  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: true,
    durationMs: Date.now() - startedAt,
    tokensUsed: cacheRow.contentSizeTokens,
    failureReason: reason,
  });
  return {
    referenceId: p.referenceId,
    content: cacheRow.content,
    provenance: {
      provider: 'google_drive',
      docName: p.docName,
      fetchedAt: cacheRow.fetchedAt.toISOString(),
      revisionId: cacheRow.revisionId,
      isStale: true,
      truncated: false,
      tokensRemovedByTruncation: null,
    },
    tokensUsed: cacheRow.contentSizeTokens,
    cacheHit: true,
    failureReason: reason,
  };
}

async function emitFailure(
  db: OrgScopedTx,
  p: ResolveParams,
  resolverVersion: number,
  reason: FetchFailureReason,
  revisionId: string | null,
  startedAt: number,
): Promise<ResolvedDocument> {
  if (reason === 'auth_revoked' || reason === 'rate_limited') {
    retrySuppressor.recordFailure(p.referenceId, reason);
  }
  await transitionState(db, p.referenceType, p.referenceId, p.organisationId, 'broken');
  // Invariant #12: idempotent failure writes
  await db.insert(documentFetchEvents).values({
    organisationId: p.organisationId,
    subaccountId: p.subaccountId,
    referenceId: p.referenceId,
    referenceType: p.referenceType,
    runId: p.runId,
    cacheHit: false,
    provider: 'google_drive',
    docName: p.docName,
    revisionId,
    tokensUsed: 0,
    tokensBeforeTruncation: null,
    resolverVersion,
    failureReason: reason,
  }).onConflictDoNothing();
  emitStructuredLog({
    runId: p.runId,
    referenceId: p.referenceId,
    provider: 'google_drive',
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    tokensUsed: 0,
    failureReason: reason,
  });
  return {
    referenceId: p.referenceId,
    content: '',
    provenance: {
      provider: 'google_drive',
      docName: p.docName,
      fetchedAt: new Date().toISOString(),
      revisionId,
      isStale: false,
      truncated: false,
      tokensRemovedByTruncation: null,
    },
    tokensUsed: 0,
    cacheHit: false,
    failureReason: reason,
  };
}

async function transitionState(
  db: OrgScopedTx,
  referenceType: 'reference_document' | 'agent_data_source',
  referenceId: string,
  organisationId: string,
  newState: 'active' | 'degraded' | 'broken',
): Promise<void> {
  if (referenceType !== 'reference_document') return;
  await db.update(referenceDocuments)
    .set({ attachmentState: newState, updatedAt: sql`now()` })
    .where(and(
      eq(referenceDocuments.id, referenceId),
      eq(referenceDocuments.organisationId, organisationId),
    ));
}

function mapResolverError(err: unknown): FetchFailureReason {
  if (err instanceof ResolverError) return err.reason as FetchFailureReason;
  if (err instanceof Error && err.name === 'AbortError') return 'network_error';
  return 'network_error';
}

function emitStructuredLog(entry: {
  runId: string | null;
  referenceId: string;
  provider: string;
  cacheHit: boolean;
  durationMs: number;
  tokensUsed: number;
  failureReason: FetchFailureReason | null;
}): void {
  logger.info('document_resolve', entry);
}
