import { eq } from 'drizzle-orm';
import { referenceDocuments, referenceDocumentVersions } from '../db/schema/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { routeCall } from './llmRouter.js';

export async function summariseDocumentVersion(input: {
  documentId: string;
  versionId: string;
  organisationId: string;
}): Promise<void> {
  const { documentId, versionId, organisationId } = input;
  const db = getOrgScopedDb('documentSummariseService.summariseDocumentVersion');

  const [version] = await db
    .select({
      content: referenceDocumentVersions.content,
      createdAt: referenceDocumentVersions.createdAt,
    })
    .from(referenceDocumentVersions)
    .where(eq(referenceDocumentVersions.id, versionId));

  if (!version) return;

  const [doc] = await db
    .select({
      summaryGeneratedAt: referenceDocuments.summaryGeneratedAt,
    })
    .from(referenceDocuments)
    .where(eq(referenceDocuments.id, documentId));

  if (doc?.summaryGeneratedAt && doc.summaryGeneratedAt >= version.createdAt) return;

  const response = await routeCall({
    messages: [
      {
        role: 'user',
        content: `Summarise the following document in 2-3 sentences for use as a retrieval hint:\n\n${version.content}`,
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

  await db
    .update(referenceDocuments)
    .set({
      summary,
      summaryStale: false,
      summaryGeneratedAt: new Date(),
    })
    .where(eq(referenceDocuments.id, documentId));
}
