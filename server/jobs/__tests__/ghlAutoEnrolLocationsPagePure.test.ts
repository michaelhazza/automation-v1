/**
 * Pure tests for D.5 — ghlAutoEnrolLocationsPageJob decision functions.
 */

import { expect, test } from 'vitest';
import { classifyError, classifyPageOutcome } from '../ghlAutoEnrolLocationsPageJobPure.js';

// ── classifyPageOutcome ───────────────────────────────────────────────────────

test('empty locations + cursor → completed_empty', () => {
  expect(classifyPageOutcome({ locations: [], pageIndex: 0, maxPages: 200, nextCursor: 'abc' })).toBe('completed_empty');
});

test('empty locations + null cursor → completed_empty', () => {
  expect(classifyPageOutcome({ locations: [], pageIndex: 0, maxPages: 200, nextCursor: null })).toBe('completed_empty');
});

test('pageIndex at maxPages → partial_page_cap', () => {
  expect(classifyPageOutcome({ locations: [{ id: '1' }], pageIndex: 200, maxPages: 200, nextCursor: 'abc' })).toBe('partial_page_cap');
});

test('pageIndex past maxPages → partial_page_cap', () => {
  expect(classifyPageOutcome({ locations: [{ id: '1' }], pageIndex: 201, maxPages: 200, nextCursor: null })).toBe('partial_page_cap');
});

test('locations present + null cursor → completed_cursor_null', () => {
  expect(classifyPageOutcome({ locations: [{ id: '1' }, { id: '2' }], pageIndex: 5, maxPages: 200, nextCursor: null })).toBe('completed_cursor_null');
});

test('locations present + cursor → continue', () => {
  expect(classifyPageOutcome({ locations: [{ id: '1' }], pageIndex: 5, maxPages: 200, nextCursor: 'next_cursor_token' })).toBe('continue');
});

// ── classifyError ─────────────────────────────────────────────────────────────

test('AGENCY_TOKEN_INVALID → fatal', () => {
  expect(classifyError({ code: 'AGENCY_TOKEN_INVALID' })).toBe('fatal');
});

test('401 → fatal', () => {
  expect(classifyError({ statusCode: 401 })).toBe('fatal');
});

test('404 → fatal', () => {
  expect(classifyError({ statusCode: 404 })).toBe('fatal');
});

test('429 → retry', () => {
  expect(classifyError({ statusCode: 429 })).toBe('retry');
});

test('500 → retry', () => {
  expect(classifyError({ statusCode: 500 })).toBe('retry');
});

test('unknown network error → retry', () => {
  expect(classifyError(new Error('ECONNRESET'))).toBe('retry');
});

test('token_revoked message → fatal', () => {
  expect(classifyError({ message: 'token_revoked by provider' })).toBe('fatal');
});
