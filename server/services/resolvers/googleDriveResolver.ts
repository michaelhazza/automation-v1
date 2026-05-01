// server/services/resolvers/googleDriveResolver.ts

import {
  EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS,
  EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS,
  EXTERNAL_DOC_RATE_LIMIT_RETRIES,
  EXTERNAL_DOC_RATE_LIMIT_INITIAL_BACKOFF_MS,
  EXTERNAL_DOC_SHEETS_MAX_RAW_BYTES,
  EXTERNAL_DOC_PDF_MAX_BYTES,
} from '../../lib/constants';
import type { ExternalDocumentResolver } from '../externalDocumentResolverTypes';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/pdf',
]);

export function isSupportedDriveMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

export function normaliseDriveDocsText(text: string): string {
  return text;
}

export function normaliseSheetsCsv(csv: string): string {
  return csv;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let backoff = EXTERNAL_DOC_RATE_LIMIT_INITIAL_BACKOFF_MS;
  for (let attempt = 0; attempt <= EXTERNAL_DOC_RATE_LIMIT_RETRIES; attempt++) {
    const res = await fetchWithTimeout(url, init, timeoutMs);
    if (res.status !== 429) return res;
    if (attempt === EXTERNAL_DOC_RATE_LIMIT_RETRIES) return res;
    await new Promise(r => setTimeout(r, backoff));
    backoff *= 2;
  }
  throw new Error('unreachable');
}

function classifyDriveResponse(res: Response): void {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw new ResolverError('auth_revoked');
  if (res.status === 404) throw new ResolverError('file_deleted');
  if (res.status === 429) throw new ResolverError('rate_limited');
  throw new ResolverError('network_error');
}

export class ResolverError extends Error {
  constructor(public reason:
    | 'auth_revoked'
    | 'file_deleted'
    | 'rate_limited'
    | 'network_error'
    | 'quota_exceeded'
    | 'unsupported_content'
  ) {
    super(reason);
  }
}

export const googleDriveResolver: ExternalDocumentResolver = {
  resolverVersion: 1,
  providerKey: 'google_drive',

  async checkRevision(fileId, accessToken) {
    const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,headRevisionId`;
    const res = await fetchWithRetry(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      EXTERNAL_DOC_CHECK_REVISION_TIMEOUT_MS
    );
    if (res.status === 401 || res.status === 403) throw new ResolverError('auth_revoked');
    if (res.status === 404) throw new ResolverError('file_deleted');
    if (res.status === 429) throw new ResolverError('rate_limited');
    if (!res.ok) throw new ResolverError('network_error');
    const meta = (await res.json()) as { id: string; name: string; mimeType: string; modifiedTime: string; headRevisionId?: string };
    return { revisionId: meta.headRevisionId ?? null, mimeType: meta.mimeType, name: meta.name };
  },

  async fetchContent(fileId, mimeType, accessToken) {
    if (!isSupportedDriveMimeType(mimeType)) throw new ResolverError('unsupported_content');

    if (mimeType === 'application/vnd.google-apps.document') {
      const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } }, EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS);
      classifyDriveResponse(res);
      return normaliseDriveDocsText(await res.text());
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } }, EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS);
      classifyDriveResponse(res);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > EXTERNAL_DOC_SHEETS_MAX_RAW_BYTES) throw new ResolverError('quota_exceeded');
      return normaliseSheetsCsv(buf.toString('utf8'));
    }

    if (mimeType === 'application/pdf') {
      const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } }, EXTERNAL_DOC_FETCH_CONTENT_TIMEOUT_MS);
      classifyDriveResponse(res);
      const pdfBuf = Buffer.from(await res.arrayBuffer());
      if (pdfBuf.byteLength > EXTERNAL_DOC_PDF_MAX_BYTES) throw new ResolverError('quota_exceeded');
      // pdf-parse is an optional dependency; if not installed, PDF extraction is unavailable.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { default: pdfParse } = await import('pdf-parse' as any);
        const parsed = await pdfParse(pdfBuf);
        return parsed.text as string;
      } catch {
        throw new ResolverError('unsupported_content');
      }
    }

    throw new ResolverError('unsupported_content');
  },
};
