import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  attachmentIcon,
  humanFileType,
  relativeTime,
  plainEnglishFailureReason,
} from '../format.js';

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });
});

describe('attachmentIcon', () => {
  it('returns img for image types', () => {
    expect(attachmentIcon('image/png')).toBe('img');
  });
  it('returns pdf for application/pdf', () => {
    expect(attachmentIcon('application/pdf')).toBe('pdf');
  });
  it('returns txt for text types', () => {
    expect(attachmentIcon('text/plain')).toBe('txt');
  });
  it('returns file for unknown types', () => {
    expect(attachmentIcon('application/zip')).toBe('file');
  });
});

describe('humanFileType', () => {
  it('returns Doc for Google Docs', () => {
    expect(humanFileType('application/vnd.google-apps.document')).toBe('Doc');
  });
  it('returns Sheet for Google Sheets', () => {
    expect(humanFileType('application/vnd.google-apps.spreadsheet')).toBe('Sheet');
  });
  it('returns PDF for application/pdf', () => {
    expect(humanFileType('application/pdf')).toBe('PDF');
  });
  it('returns File for unknown types', () => {
    expect(humanFileType('application/zip')).toBe('File');
  });
});

describe('relativeTime', () => {
  it('returns never for null', () => {
    expect(relativeTime(null)).toBe('never');
  });
  it('returns never for undefined', () => {
    expect(relativeTime(undefined)).toBe('never');
  });
  it('returns just now for recent times', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
  });
  it('returns min ago for minutes-old times', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe('5 min ago');
  });
  it('returns hr ago for hours-old times', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoHoursAgo)).toBe('2 hr ago');
  });
  it('returns d ago for days-old times', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeDaysAgo)).toBe('3 d ago');
  });
});

describe('plainEnglishFailureReason', () => {
  it('handles auth_revoked', () => {
    expect(plainEnglishFailureReason('auth_revoked')).toContain('no longer has access');
  });
  it('handles file_deleted', () => {
    expect(plainEnglishFailureReason('file_deleted')).toContain('deleted from Google Drive');
  });
  it('returns fallback for unknown reasons', () => {
    expect(plainEnglishFailureReason('some_unknown')).toBe('The file could not be fetched.');
  });
  it('returns fallback for null', () => {
    expect(plainEnglishFailureReason(null)).toBe('The file could not be fetched.');
  });
});
