import api from '../lib/api';

export interface FileEntry {
  id: string;
  fileName: string;
  fileType: 'input' | 'output';
  mimeType: string | null;
  fileSizeBytes: number | null;
  expiresAt: string;
  createdAt: string;
  executionId: string;
  subaccountId: string | null;
  promotedDocumentId: string | null;
}

export interface FilesListResponse {
  files: FileEntry[];
  hasMore: boolean;
}

export interface FilesQueryParams {
  subaccountId?: string;
  linkedToKnowledge?: boolean;
  cursor?: string;
  limit?: number;
}

export const listFiles = (params: FilesQueryParams): Promise<FilesListResponse> => {
  const query: Record<string, string> = {};
  if (params.subaccountId !== undefined) query.subaccountId = params.subaccountId;
  if (params.linkedToKnowledge !== undefined) query.linkedToKnowledge = String(params.linkedToKnowledge);
  if (params.cursor !== undefined) query.cursor = params.cursor;
  if (params.limit !== undefined) query.limit = String(params.limit);
  return api.get('/api/files', { params: query }).then((r) => r.data);
};
