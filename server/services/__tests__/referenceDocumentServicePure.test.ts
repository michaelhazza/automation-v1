import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
  assert.equal(hashContent(content), expected);
});

test('hashContent is deterministic', () => {
  const c = 'same content twice';
  assert.equal(hashContent(c), hashContent(c));
});

test('hashContent differs for different content', () => {
  assert.notEqual(hashContent('a'), hashContent('b'));
});

test('hashContent of empty string is SHA-256 of empty bytes', () => {
  const expected = createHash('sha256').update('', 'utf8').digest('hex');
  assert.equal(hashContent(''), expected);
});

// ---------------------------------------------------------------------------
// serializeDocument — delimiter structure
// ---------------------------------------------------------------------------

test('serializeDocument contains DOC_START and DOC_END delimiters', () => {
  const out = serializeDocument({ documentId: 'doc-1', version: 1, content: 'test content' });
  assert.ok(out.includes(DOC_DELIMITER_START), 'should contain DOC_START');
  assert.ok(out.includes(DOC_DELIMITER_END), 'should contain DOC_END');
});

test('serializeDocument embeds document id and version in metadata header', () => {
  const out = serializeDocument({ documentId: 'doc-abc', version: 3, content: 'content here' });
  assert.ok(out.includes('id: doc-abc'), 'should contain document id');
  assert.ok(out.includes('version: 3'), 'should contain version');
});

test('serializeDocument embeds the content after the metadata separator', () => {
  const out = serializeDocument({ documentId: 'doc-1', version: 1, content: 'my content' });
  // Split on '\n---\n' (metadata separator) to isolate the content section.
  // Splitting on '---\n' would also match the '---DOC_START---\n' delimiter.
  const contentSection = out.split('\n---\n')[1];
  assert.ok(contentSection?.includes('my content'), 'content should appear after --- separator');
});

test('serializeDocument output matches exact expected format', () => {
  const out = serializeDocument({ documentId: 'doc-1', version: 2, content: 'line one\nline two' });
  const expected = `${DOC_DELIMITER_START}\nid: doc-1\nversion: 2\n---\nline one\nline two\n${DOC_DELIMITER_END}\n`;
  assert.equal(out, expected);
});

test('serializeDocument is deterministic for the same inputs', () => {
  const args = { documentId: 'doc-x', version: 5, content: 'hello' };
  assert.equal(serializeDocument(args), serializeDocument(args));
});

test('serializeDocument output differs when documentId changes (rename-invariance: name is NOT in hash input)', () => {
  // Two calls with different documentIds should produce different output.
  const a = serializeDocument({ documentId: 'doc-a', version: 1, content: 'same content' });
  const b = serializeDocument({ documentId: 'doc-b', version: 1, content: 'same content' });
  assert.notEqual(a, b, 'different document ids must produce different serialized output');
});

// ---------------------------------------------------------------------------
// hashSerialized — SHA-256 over serialized bytes
// ---------------------------------------------------------------------------

test('hashSerialized produces a hex SHA-256 of the serialized form', () => {
  const serialized = serializeDocument({ documentId: 'doc-1', version: 1, content: 'test' });
  const expected = createHash('sha256').update(serialized, 'utf8').digest('hex');
  assert.equal(hashSerialized(serialized), expected);
});

test('hashSerialized is deterministic', () => {
  const s = serializeDocument({ documentId: 'doc-1', version: 1, content: 'hello' });
  assert.equal(hashSerialized(s), hashSerialized(s));
});

test('hashSerialized differs from hashContent for the same content string', () => {
  const content = 'raw content';
  const serialized = serializeDocument({ documentId: 'doc-1', version: 1, content });
  // The hashes must differ because hashSerialized wraps content in delimiters.
  assert.notEqual(hashContent(content), hashSerialized(serialized));
});

test('hashSerialized changes when the document id changes', () => {
  const a = serializeDocument({ documentId: 'doc-a', version: 1, content: 'same' });
  const b = serializeDocument({ documentId: 'doc-b', version: 1, content: 'same' });
  assert.notEqual(hashSerialized(a), hashSerialized(b));
});

test('hashSerialized changes when the version changes', () => {
  const a = serializeDocument({ documentId: 'doc-1', version: 1, content: 'same' });
  const b = serializeDocument({ documentId: 'doc-1', version: 2, content: 'same' });
  assert.notEqual(hashSerialized(a), hashSerialized(b));
});
