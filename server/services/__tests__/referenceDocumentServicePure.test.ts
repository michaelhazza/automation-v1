import { expect, test } from 'vitest';
import { createHash } from 'crypto';
import {
  hashContent,
  hashSerialized,
  serializeDocument,
  DOC_DELIMITER_START,
  DOC_DELIMITER_END,
} from '../referenceDocumentServicePure.js';

// ---------------------------------------------------------------------------
// hashContent — SHA-256 over raw content bytes
// ---------------------------------------------------------------------------

test('hashContent produces a hex SHA-256', () => {
  const content = 'Hello, world!';
  const expected = createHash('sha256').update(content, 'utf8').digest('hex');
  expect(hashContent(content)).toBe(expected);
});

test('hashContent is deterministic', () => {
  const c = 'same content twice';
  expect(hashContent(c)).toBe(hashContent(c));
});

test('hashContent differs for different content', () => {
  expect(hashContent('a')).not.toBe(hashContent('b'));
});

test('hashContent of empty string is SHA-256 of empty bytes', () => {
  const expected = createHash('sha256').update('', 'utf8').digest('hex');
  expect(hashContent('')).toBe(expected);
});

// ---------------------------------------------------------------------------
// serializeDocument — delimiter structure
// ---------------------------------------------------------------------------

test('serializeDocument contains DOC_START and DOC_END delimiters', () => {
  const out = serializeDocument({ documentId: 'doc-1', version: 1, content: 'test content' });
  expect(out.includes(DOC_DELIMITER_START)).toBeTruthy();
  expect(out.includes(DOC_DELIMITER_END)).toBeTruthy();
});

test('serializeDocument embeds document id and version in metadata header', () => {
  const out = serializeDocument({ documentId: 'doc-abc', version: 3, content: 'content here' });
  expect(out.includes('id: doc-abc')).toBeTruthy();
  expect(out.includes('version: 3')).toBeTruthy();
});

test('serializeDocument embeds the content after the metadata separator', () => {
  const out = serializeDocument({ documentId: 'doc-1', version: 1, content: 'my content' });
  // Split on '\n---\n' (metadata separator) to isolate the content section.
  // Splitting on '---\n' would also match the '---DOC_START---\n' delimiter.
  const contentSection = out.split('\n---\n')[1];
  expect(contentSection?.includes('my content')).toBeTruthy();
});

test('serializeDocument output matches exact expected format', () => {
  const out = serializeDocument({ documentId: 'doc-1', version: 2, content: 'line one\nline two' });
  const expected = `${DOC_DELIMITER_START}\nid: doc-1\nversion: 2\n---\nline one\nline two\n${DOC_DELIMITER_END}\n`;
  expect(out).toBe(expected);
});

test('serializeDocument is deterministic for the same inputs', () => {
  const args = { documentId: 'doc-x', version: 5, content: 'hello' };
  expect(serializeDocument(args)).toBe(serializeDocument(args));
});

test('serializeDocument output differs when documentId changes (rename-invariance: name is NOT in hash input)', () => {
  // Two calls with different documentIds should produce different output.
  const a = serializeDocument({ documentId: 'doc-a', version: 1, content: 'same content' });
  const b = serializeDocument({ documentId: 'doc-b', version: 1, content: 'same content' });
  expect(a, 'different document ids must produce different serialized output').not.toBe(b);
});

// ---------------------------------------------------------------------------
// hashSerialized — SHA-256 over serialized bytes
// ---------------------------------------------------------------------------

test('hashSerialized produces a hex SHA-256 of the serialized form', () => {
  const serialized = serializeDocument({ documentId: 'doc-1', version: 1, content: 'test' });
  const expected = createHash('sha256').update(serialized, 'utf8').digest('hex');
  expect(hashSerialized(serialized)).toBe(expected);
});

test('hashSerialized is deterministic', () => {
  const s = serializeDocument({ documentId: 'doc-1', version: 1, content: 'hello' });
  expect(hashSerialized(s)).toBe(hashSerialized(s));
});

test('hashSerialized differs from hashContent for the same content string', () => {
  const content = 'raw content';
  const serialized = serializeDocument({ documentId: 'doc-1', version: 1, content });
  // The hashes must differ because hashSerialized wraps content in delimiters.
  expect(hashContent(content)).not.toBe(hashSerialized(serialized));
});

test('hashSerialized changes when the document id changes', () => {
  const a = serializeDocument({ documentId: 'doc-a', version: 1, content: 'same' });
  const b = serializeDocument({ documentId: 'doc-b', version: 1, content: 'same' });
  expect(hashSerialized(a)).not.toBe(hashSerialized(b));
});

test('hashSerialized changes when the version changes', () => {
  const a = serializeDocument({ documentId: 'doc-1', version: 1, content: 'same' });
  const b = serializeDocument({ documentId: 'doc-1', version: 2, content: 'same' });
  expect(hashSerialized(a)).not.toBe(hashSerialized(b));
});
