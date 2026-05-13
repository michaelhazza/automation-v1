import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export function deriveFileEventType(version: number): 'file.created' | 'file.modified' {
  return version === 1 ? 'file.created' : 'file.modified';
}

export function shouldWatcherSkip(existingSha256: string | null, observedSha256: string): boolean {
  return existingSha256 !== null && existingSha256 === observedSha256;
}

export function computeSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

const MIME_MAP: Record<string, string> = {
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.json': 'application/json',
  '.csv':  'text/csv',
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.ts':   'application/typescript',
  '.py':   'text/x-python',
  '.sh':   'application/x-sh',
  '.zip':  'application/zip',
  '.xml':  'application/xml',
};

export function detectMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

const UNSAFE_PATTERNS: RegExp[] = [
  /(?:^|\/)\.\.(\/|$)/,  // path traversal: reject any segment that is '..'
  /(?:^|\/)\.env(?:\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /(?:^|\/)\.ssh\//,
  /(?:^|\/)\.aws\//,
];

export function isPathSafe(path: string): boolean {
  if (!path || path.length === 0) return false;
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(path)) return false;
  }
  return true;
}
