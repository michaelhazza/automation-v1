// server/services/externalDocumentResolverTypes.ts

import type { FetchFailureReason } from '../db/schema/documentFetchEvents';

export interface ExternalDocumentResolver {
  checkRevision(fileId: string, accessToken: string): Promise<{ revisionId: string | null; mimeType: string; name: string } | null>;
  fetchContent(fileId: string, mimeType: string, accessToken: string): Promise<string>;
  readonly resolverVersion: number;
  readonly providerKey: 'google_drive';
}

export interface ResolvedDocument {
  referenceId: string;
  content: string;
  provenance: {
    provider: 'google_drive';
    docName: string;
    fetchedAt: string;
    revisionId: string | null;
    isStale: boolean;
    truncated: boolean;
    tokensRemovedByTruncation: number | null;
  };
  tokensUsed: number;
  cacheHit: boolean;
  failureReason: FetchFailureReason | null;
}

export interface ResolveParams {
  referenceId: string;
  referenceType: 'reference_document' | 'agent_data_source';
  organisationId: string;
  subaccountId: string;
  connectionId: string;
  fileId: string;
  expectedMimeType: string;
  docName: string;
  runId: string | null;
  accessToken?: string;
}
