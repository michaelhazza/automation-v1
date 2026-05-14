/**
 * ghlAutoEnrolLocationsPageJobPure
 *
 * Pure decision helpers extracted from ghlAutoEnrolLocationsPageJob.
 * No I/O, no logger, no env access — safe for unit tests.
 */

export type ErrorClass = 'fatal' | 'retry';

export function classifyError(e: unknown): ErrorClass {
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

export type PageOutcome = 'completed_empty' | 'completed_cursor_null' | 'partial_page_cap' | 'continue';

export function classifyPageOutcome(opts: {
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
