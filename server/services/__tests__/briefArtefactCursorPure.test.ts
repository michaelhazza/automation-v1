/**
 * briefArtefactCursorPure.test.ts
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/briefArtefactCursorPure.test.ts
 */

import { strict as assert } from 'node:assert';
import {
  encodeCursor,
  decodeCursor,
  isValidCursor,
  type CursorPosition,
} from '../briefArtefactCursorPure.js';

const validPosition: CursorPosition = {
  ts: '2026-04-28T10:00:00.000Z',
  msgId: '123e4567-e89b-12d3-a456-426614174000',
};

// Round-trip encode → decode returns the original position
{
  const encoded = encodeCursor(validPosition);
  const decoded = decodeCursor(encoded);
  assert.deepStrictEqual(decoded, validPosition, 'round-trip should return original position');
}

// isValidCursor returns true for a valid cursor
{
  const encoded = encodeCursor(validPosition);
  assert.strictEqual(isValidCursor(encoded), true, 'valid cursor should be accepted');
}

// Decode of garbage string returns null
{
  assert.strictEqual(decodeCursor('not-valid-base64!!!'), null, 'garbage string → null');
}

// Decode of empty string returns null
{
  assert.strictEqual(decodeCursor(''), null, 'empty string → null');
}

// Decode of valid base64url but not JSON returns null
{
  const notJson = Buffer.from('this is not json').toString('base64url');
  assert.strictEqual(decodeCursor(notJson), null, 'valid base64url but not JSON → null');
}

// Decode of valid JSON but wrong shape (missing msgId) returns null
{
  const wrongShape = Buffer.from(JSON.stringify({ ts: '2026-04-28T00:00:00Z' })).toString('base64url');
  assert.strictEqual(decodeCursor(wrongShape), null, 'missing msgId field → null');
}

// Decode of valid JSON but wrong shape (missing ts) returns null
{
  const wrongShape = Buffer.from(JSON.stringify({ msgId: 'some-uuid' })).toString('base64url');
  assert.strictEqual(decodeCursor(wrongShape), null, 'missing ts field → null');
}

// Decode of valid JSON but both fields wrong type returns null
{
  const wrongTypes = Buffer.from(JSON.stringify({ ts: 123, msgId: false })).toString('base64url');
  assert.strictEqual(decodeCursor(wrongTypes), null, 'wrong field types → null');
}

// isValidCursor returns false for non-string
{
  assert.strictEqual(isValidCursor(null), false, 'null → false');
  assert.strictEqual(isValidCursor(42), false, 'number → false');
  assert.strictEqual(isValidCursor(undefined), false, 'undefined → false');
}

// isValidCursor returns false for garbage
{
  assert.strictEqual(isValidCursor('bad-cursor'), false, 'garbage → false');
}

console.log('briefArtefactCursorPure: all assertions passed');
