import type PgBoss from 'pg-boss';
import { createWorker } from '../lib/createWorker.js';
import { summariseDocumentVersion } from '../services/documentSummariseService.js';

export interface DocumentSummariseJobPayload {
  organisationId: string;
  documentId: string;
  versionId: string;
}

export function registerDocumentSummariseWorker(boss: PgBoss): void {
  createWorker<DocumentSummariseJobPayload>({
    queue: 'document:summarise',
    boss,
    handler: async (job) => {
      const { organisationId, documentId, versionId } = job.data;
      await summariseDocumentVersion({ documentId, versionId, organisationId });
    },
  });
}
