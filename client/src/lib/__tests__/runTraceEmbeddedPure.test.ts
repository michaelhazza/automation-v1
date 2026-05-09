/**
 * runTraceEmbeddedPure.test.ts
 *
 * Tests for parseEmbeddedFlag — the pure URL-search parser that decides
 * whether a run-trace page is rendered in embedded (iframe) mode.
 *
 * Run via: npx vitest run client/src/lib/__tests__/runTraceEmbeddedPure.test.ts
 *
 * Contract:
 *   (absent)              → false
 *   ?embedded=1           → true
 *   ?embedded=true        → true
 *   ?embedded=0           → false
 *   ?embedded=false       → false
 *   ?embedded=            → false   (empty string)
 *   ?embedded=1&embedded=0 → true   (URLSearchParams.get returns the FIRST value)
 */

import { expect, test } from 'vitest';
import { parseEmbeddedFlag } from '../runTraceEmbeddedPure.js';

// ── missing param ─────────────────────────────────────────────────────────────

test('missing param → false', () => expect(parseEmbeddedFlag('')).toBe(false));
test('unrelated params only → false', () => expect(parseEmbeddedFlag('?foo=1')).toBe(false));

// ── truthy values ─────────────────────────────────────────────────────────────

test('?embedded=1 → true',    () => expect(parseEmbeddedFlag('?embedded=1')).toBe(true));
test('?embedded=true → true', () => expect(parseEmbeddedFlag('?embedded=true')).toBe(true));

// ── falsy values ──────────────────────────────────────────────────────────────

test('?embedded=0 → false',      () => expect(parseEmbeddedFlag('?embedded=0')).toBe(false));
test('?embedded=false → false',  () => expect(parseEmbeddedFlag('?embedded=false')).toBe(false));
test('?embedded= (empty) → false', () => expect(parseEmbeddedFlag('?embedded=')).toBe(false));

// ── multi-key: URLSearchParams.get() returns the FIRST occurrence ─────────────
// ?embedded=1&embedded=0 → first value is "1" → true
test('?embedded=1&embedded=0 → true (first occurrence wins)', () =>
  expect(parseEmbeddedFlag('?embedded=1&embedded=0')).toBe(true));

// ?embedded=0&embedded=1 → first value is "0" → false
test('?embedded=0&embedded=1 → false (first occurrence wins)', () =>
  expect(parseEmbeddedFlag('?embedded=0&embedded=1')).toBe(false));
