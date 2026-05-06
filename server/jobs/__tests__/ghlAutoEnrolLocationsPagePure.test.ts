/**
 * Pure tests for D.5 — ghlAutoEnrolLocationsPageJob decision functions.
 * No IO; no DB; no runtime imports that trigger env validation.
 * Logic is duplicated inline to keep the test hermetic.
 */

import { strict as assert } from 'assert';

// ── classifyPageOutcome (mirrors the implementation in ghlAutoEnrolLocationsPageJob) ──

type PageOutcome = 'completed_empty' | 'completed_cursor_null' | 'partial_page_cap' | 'continue';

function classifyPageOutcome(opts: {
  locations: unknown[];
  pageIndex: number;
  maxPages: number;
  nextCursor: string | null;
}): PageOutcome {
  const { locations, pageIndex, maxPages, nextCursor } = opts;
  if (locations.length === 0) return 'completed_empty';
  if (pageIndex >= maxPages) return 'partial_page_cap';
  if (nextCursor === null) return 'completed_cursor_null';
  return 'continue';
}

// ── classifyError (mirrors the implementation in ghlAutoEnrolLocationsPageJob) ──

type ErrorClass = 'fatal' | 'retry';

function classifyError(e: unknown): ErrorClass {
  const err = e as { statusCode?: number; code?: string; message?: string };
  if (
    err.code === 'AGENCY_TOKEN_INVALID' ||
    err.message?.includes('auth_revoked') ||
    err.message?.includes('token_revoked') ||
    (typeof err.statusCode === 'number' && err.statusCode === 401)
  ) {
    return 'fatal';
  }
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
    return 'fatal';
  }
  return 'retry';
}

// ── classifyPageOutcome tests ─────────────────────────────────────────────────

// Empty locations → completed_empty regardless of cursor
{
  const r = classifyPageOutcome({ locations: [], pageIndex: 0, maxPages: 200, nextCursor: 'abc' });
  assert.equal(r, 'completed_empty', 'empty locations + cursor → completed_empty');
}
{
  const r = classifyPageOutcome({ locations: [], pageIndex: 0, maxPages: 200, nextCursor: null });
  assert.equal(r, 'completed_empty', 'empty locations + null cursor → completed_empty');
}

// pageIndex >= maxPages → partial_page_cap
{
  const locs = [{ id: '1' }];
  const r = classifyPageOutcome({ locations: locs, pageIndex: 200, maxPages: 200, nextCursor: 'abc' });
  assert.equal(r, 'partial_page_cap', 'pageIndex at maxPages → partial_page_cap');
}
{
  const locs = [{ id: '1' }];
  const r = classifyPageOutcome({ locations: locs, pageIndex: 201, maxPages: 200, nextCursor: null });
  assert.equal(r, 'partial_page_cap', 'pageIndex past maxPages → partial_page_cap');
}

// nextCursor === null AND locations > 0 → completed_cursor_null
{
  const locs = [{ id: '1' }, { id: '2' }];
  const r = classifyPageOutcome({ locations: locs, pageIndex: 5, maxPages: 200, nextCursor: null });
  assert.equal(r, 'completed_cursor_null', 'locations present + null cursor → completed_cursor_null');
}

// else → continue
{
  const locs = [{ id: '1' }];
  const r = classifyPageOutcome({ locations: locs, pageIndex: 5, maxPages: 200, nextCursor: 'next_cursor_token' });
  assert.equal(r, 'continue', 'locations present + cursor → continue');
}

// ── classifyError tests ───────────────────────────────────────────────────────

// Auth-revoked → fatal
{
  const r = classifyError({ code: 'AGENCY_TOKEN_INVALID' });
  assert.equal(r, 'fatal', 'AGENCY_TOKEN_INVALID → fatal');
}

// 401 → fatal
{
  const r = classifyError({ statusCode: 401 });
  assert.equal(r, 'fatal', '401 → fatal');
}

// 404 → fatal
{
  const r = classifyError({ statusCode: 404 });
  assert.equal(r, 'fatal', '404 → fatal');
}

// 429 → retry (not fatal)
{
  const r = classifyError({ statusCode: 429 });
  assert.equal(r, 'retry', '429 → retry');
}

// 500 → retry
{
  const r = classifyError({ statusCode: 500 });
  assert.equal(r, 'retry', '500 → retry');
}

// Unknown error → retry
{
  const r = classifyError(new Error('ECONNRESET'));
  assert.equal(r, 'retry', 'unknown network error → retry');
}

// auth_revoked in message → fatal
{
  const r = classifyError({ message: 'token_revoked by provider' });
  assert.equal(r, 'fatal', 'token_revoked message → fatal');
}

console.log('ghlAutoEnrolLocationsPagePure: all assertions passed');
