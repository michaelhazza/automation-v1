import { describe, expect, test } from 'vitest';
import {
  computeSha256,
  deriveFileEventType,
  detectMimeType,
  isPathSafe,
  shouldWatcherSkip,
} from '../operatorSandboxFileEventBridgePure.js';

describe('deriveFileEventType', () => {
  test('version 1 returns file.created', () => {
    expect(deriveFileEventType(1)).toBe('file.created');
  });

  test('version 2 returns file.modified', () => {
    expect(deriveFileEventType(2)).toBe('file.modified');
  });

  test('version 100 returns file.modified', () => {
    expect(deriveFileEventType(100)).toBe('file.modified');
  });
});

describe('shouldWatcherSkip', () => {
  test('returns true when sha256 matches existing', () => {
    expect(shouldWatcherSkip('abc123', 'abc123')).toBe(true);
  });

  test('returns false when sha256 differs', () => {
    expect(shouldWatcherSkip('abc123', 'def456')).toBe(false);
  });

  test('returns false when existing is null', () => {
    expect(shouldWatcherSkip(null, 'abc123')).toBe(false);
  });
});

describe('computeSha256', () => {
  test('returns a non-empty hex string', () => {
    const result = computeSha256(Buffer.from('hello'));
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic — same input produces same output', () => {
    const buf = Buffer.from('test content');
    expect(computeSha256(buf)).toBe(computeSha256(buf));
  });

  test('different inputs produce different hashes', () => {
    expect(computeSha256(Buffer.from('input-a'))).not.toBe(
      computeSha256(Buffer.from('input-b')),
    );
  });
});

describe('detectMimeType', () => {
  test('.json -> application/json', () => {
    expect(detectMimeType('data.json')).toBe('application/json');
  });

  test('.pdf -> application/pdf', () => {
    expect(detectMimeType('doc.pdf')).toBe('application/pdf');
  });

  test('.png -> image/png', () => {
    expect(detectMimeType('image.png')).toBe('image/png');
  });

  test('.txt -> text/plain', () => {
    expect(detectMimeType('readme.txt')).toBe('text/plain');
  });

  test('unknown extension -> application/octet-stream', () => {
    expect(detectMimeType('file.xyz')).toBe('application/octet-stream');
  });
});

describe('isPathSafe', () => {
  test('.env is rejected', () => {
    expect(isPathSafe('.env')).toBe(false);
  });

  test('.ssh/id_rsa is rejected', () => {
    expect(isPathSafe('.ssh/id_rsa')).toBe(false);
  });

  test('key.pem is rejected', () => {
    expect(isPathSafe('key.pem')).toBe(false);
  });

  test('report.csv is safe', () => {
    expect(isPathSafe('report.csv')).toBe(true);
  });

  test('empty string is rejected', () => {
    expect(isPathSafe('')).toBe(false);
  });
});
