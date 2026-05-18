import { eq, and } from 'drizzle-orm';
import { referenceDocuments, referenceDocumentVersions } from '../db/schema/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { routeCall } from './llmRouter.js';
import { truncateContentToTokenBudget } from './externalDocumentResolverPure.js';

// Cap injected document content to prevent prompt-injection amplification and
// runaway billing on large user uploads. 4000 tokens leaves headroom under any
// reasonable model context window after the fixed prompt prefix and 256-token
// response budget. (AKR-ADV-4)
const SUMMARISE_INPUT_TOKEN_BUDGET = 4000;

export async function summariseDocumentVersion(input: {
  documentId: string;
  versionId: string;
  organisationId: string;
}): Promise<void> {
  const { documentId, versionId, organisationId } = input;
  const db = getOrgScopedDb('documentSummariseService.summariseDocumentVersion');

  // Org-scoped JOIN: referenceDocumentVersions has no organisationId column;
  // tenant boundary is enforced via the parent referenceDocuments row.
  // (AKR-ADV-1)
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [version] = await db
    .select({
      content: referenceDocumentVersions.content,
      createdAt: referenceDocumentVersions.createdAt,
    })
    .from(referenceDocumentVersions)
    .innerJoin(referenceDocuments, eq(referenceDocuments.id, referenceDocumentVersions.documentId))
    .where(
      and(
        eq(referenceDocumentVersions.id, versionId),
        eq(referenceDocumentVersions.documentId, documentId),
        eq(referenceDocuments.organisationId, organisationId),
      ),
    );

  if (!version) return;

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [doc] = await db
    .select({
      summaryGeneratedAt: referenceDocuments.summaryGeneratedAt,
    })
    .from(referenceDocuments)
    .where(
      and(
        eq(referenceDocuments.id, documentId),
        eq(referenceDocuments.organisationId, organisationId),
      ),
    );

  if (doc?.summaryGeneratedAt && doc.summaryGeneratedAt >= version.createdAt) return;

  const truncation = truncateContentToTokenBudget(version.content, SUMMARISE_INPUT_TOKEN_BUDGET);

  const response = await routeCall({
    messages: [
      {
        role: 'user',
        content: `Summarise the following document in 2-3 sentences for use as a retrieval hint:\n\n${truncation.content}`,
      },
    ],
    maxTokens: 256,
    context: {
      organisationId,
      sourceType: 'system',
      taskType: 'general',
      agentName: 'document-summarise',
      featureTag: 'document-summarise',
    },
  });

  const summary =
    typeof response.content === 'string' ? response.content.trim() : '';

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  await db
    .update(referenceDocuments)
    .set({
      summary,
      summaryStale: false,
      summaryGeneratedAt: new Date(),
    })
    .where(
      and(
        eq(referenceDocuments.id, documentId),
        eq(referenceDocuments.organisationId, organisationId),
      ),
    );
}
