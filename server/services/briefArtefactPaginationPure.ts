import { encodeCursor } from './briefArtefactCursorPure.js';

export interface PageableRow {
  id: string;
  createdAt: Date;
}

/**
 * Given a DESC-ordered result set fetched with `limit + 1` rows, trim to
 * `limit` and derive a nextCursor from the last kept row (oldest in the page).
 *
 * Caller reverses the returned `items` before serialising to the client so the
 * response is in ASC order (chat timeline), while the DESC fetch ensures we
 * selected the correct page boundary.
 */
export function computeNextCursor<T extends PageableRow>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    const tail = items[limit - 1]!;
    return {
      items,
      nextCursor: encodeCursor({ ts: tail.createdAt.toISOString(), msgId: tail.id }),
    };
  }
  return { items: rows, nextCursor: null };
}
