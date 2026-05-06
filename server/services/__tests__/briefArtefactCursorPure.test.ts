/**
 * briefArtefactCursorPure.test.ts
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/briefArtefactCursorPure.test.ts
 */

import { expect, test } from 'vitest';
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

test('round-trip encode → decode returns the original position', () => {
  const encoded = encodeCursor(validPosition);
  const decoded = decodeCursor(encoded);
  expect(decoded).toEqual(validPosition);
});

test('isValidCursor returns true for a valid cursor', () => {
  const encoded = encodeCursor(validPosition);
  expect(isValidCursor(encoded)).toBe(true);
});

test('decode of garbage string returns null', () => {
  expect(decodeCursor('not-valid-base64!!!')).toBe(null);
});

test('decode of empty string returns null', () => {
  expect(decodeCursor('')).toBe(null);
});

test('decode of valid base64url but not JSON returns null', () => {
  const notJson = Buffer.from('this is not json').toString('base64url');
  expect(decodeCursor(notJson)).toBe(null);
});

test('decode of valid JSON but wrong shape (missing msgId) returns null', () => {
  const wrongShape = Buffer.from(JSON.stringify({ ts: '2026-04-28T00:00:00Z' })).toString('base64url');
  expect(decodeCursor(wrongShape)).toBe(null);
});

test('decode of valid JSON but wrong shape (missing ts) returns null', () => {
  const wrongShape = Buffer.from(JSON.stringify({ msgId: 'some-uuid' })).toString('base64url');
  expect(decodeCursor(wrongShape)).toBe(null);
});

test('decode of valid JSON but both fields wrong type returns null', () => {
  const wrongTypes = Buffer.from(JSON.stringify({ ts: 123, msgId: false })).toString('base64url');
  expect(decodeCursor(wrongTypes)).toBe(null);
});

test('isValidCursor returns false for non-string', () => {
  expect(isValidCursor(null)).toBe(false);
  expect(isValidCursor(42)).toBe(false);
  expect(isValidCursor(undefined)).toBe(false);
});

test('isValidCursor returns false for garbage', () => {
  expect(isValidCursor('bad-cursor')).toBe(false);
});
