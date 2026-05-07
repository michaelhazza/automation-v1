/**
 * inboxServicePure — band-derivation logic for the unified inbox (pure)
 *
 * No I/O, no DB, no side effects. All rules for mapping a UnifiedInboxItem
 * to a priority band live HERE only — do NOT spread band logic across the
 * service or route layer.
 *
 * Band rules (deterministic, evaluated in priority order):
 *   high         — unread AND (kind=review_item|approval) AND (critical severity OR dueAt within 24 h)
 *   needs_action — unread (and not yet classified as high)
 *   previous     — read OR archived
 *
 * Snooze is DEFERRED — no snoozed input exists on the item shape.
 */

// ---------------------------------------------------------------------------
// Types (re-exported so callers can import from one place)
// ---------------------------------------------------------------------------

export type InboxBand = 'high' | 'needs_action' | 'previous';

export type InboxKind = 'task' | 'review_item' | 'agent_run' | 'approval';

/** Minimal shape needed by deriveBand; matches UnifiedInboxItem in inboxService.ts */
export interface BandableItem {
  isRead: boolean;
  isArchived: boolean;
  /** ISO timestamp or Date for due-date proximity check. Optional. */
  dueAt?: Date | string | null;
  /** Severity string from the backing record. Optional. */
  severity?: string | null;
  /** Distinguishes items with approve/reject semantics from plain agent_run failures. */
  kind: InboxKind;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRITICAL_SEVERITIES = new Set(['critical', 'urgent']);
const HIGH_ELIGIBLE_KINDS: Set<InboxKind> = new Set(['review_item', 'approval']);
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// deriveBand
// ---------------------------------------------------------------------------

/**
 * Derive the display band for a single inbox item.
 *
 * Rules evaluated in order (first match wins):
 *   1. archived OR read → "previous"
 *   2. unread AND high-eligible kind AND (critical severity OR dueAt within 24 h) → "high"
 *   3. unread → "needs_action"
 */
export function deriveBand(item: BandableItem, now: Date = new Date()): InboxBand {
  // "previous" wins for anything read or archived regardless of other fields
  if (item.isArchived || item.isRead) {
    return 'previous';
  }

  // Only review_item and approval kinds can reach "high"
  if (HIGH_ELIGIBLE_KINDS.has(item.kind)) {
    const isCritical = item.severity != null && CRITICAL_SEVERITIES.has(item.severity.toLowerCase());

    let isDueSoon = false;
    if (item.dueAt != null) {
      const dueMs = item.dueAt instanceof Date ? item.dueAt.getTime() : new Date(item.dueAt).getTime();
      isDueSoon = dueMs - now.getTime() <= TWENTY_FOUR_HOURS_MS;
    }

    if (isCritical || isDueSoon) {
      return 'high';
    }
  }

  return 'needs_action';
}

// ---------------------------------------------------------------------------
// filterByQ — simple case-insensitive substring match on item title
// ---------------------------------------------------------------------------

/**
 * Returns true when the item title matches the search query (case-insensitive).
 * An empty/undefined query matches everything.
 */
export function filterByQ(title: string, q?: string): boolean {
  if (!q || q.trim() === '') return true;
  return title.toLowerCase().includes(q.toLowerCase().trim());
}
