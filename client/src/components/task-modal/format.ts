export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'img';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'txt';
  return 'file';
}

export function humanFileType(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.document') return 'Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Sheet';
  if (mimeType === 'application/pdf') return 'PDF';
  return 'File';
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function plainEnglishFailureReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'auth_revoked': return 'The Google Drive connection no longer has access to this file.';
    case 'file_deleted': return 'This file has been deleted from Google Drive.';
    case 'rate_limited': return 'Drive temporarily rate-limited the platform; the file is unavailable for this run.';
    case 'unsupported_content': return 'The file is empty or in an unsupported format.';
    case 'quota_exceeded': return 'The file is too large to fetch.';
    case 'network_error': return 'Could not reach Google Drive.';
    default: return 'The file could not be fetched.';
  }
}
