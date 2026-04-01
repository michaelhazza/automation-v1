// ---------------------------------------------------------------------------
// HITL Service — event-driven promise-based blocking for review-gated actions
//
// Pattern: HumanLayer's pendingDecisions Map<actionId, {resolve, reject}>.
// The agent's tool call promise stays open until a human approves or rejects
// via the review queue. No polling — the promise resolves exactly once.
//
// Race condition handling: if resolveDecision is called before awaitDecision
// (can happen if approval is extremely fast), the result is stored in
// preResolvedDecisions and returned immediately when awaitDecision is called.
// ---------------------------------------------------------------------------

export interface HitlDecision {
  approved: boolean;
  /** Present when approved: the execution result from the adapter */
  result?: unknown;
  /** Present when rejected or timed out */
  comment?: string;
  /** Present when approved with human-edited args */
  editedArgs?: Record<string, unknown>;
}

export class AlreadyDecidedError extends Error {
  constructor(actionId: string) {
    super(`Action ${actionId} has already been decided`);
    this.name = 'AlreadyDecidedError';
  }
}

// Active promises waiting for a human decision
const pendingDecisions = new Map<
  string,
  { resolve: (decision: HitlDecision) => void; reject: (err: Error) => void }
>();

// Pre-resolved decisions (approval came before awaitDecision was registered)
// Entries expire after 5 minutes to avoid unbounded growth
const preResolvedDecisions = new Map<string, { decision: HitlDecision; expiresAt: number }>();
const PRE_RESOLVED_TTL_MS = 5 * 60 * 1000;

function cleanupExpiredPreResolved(): void {
  const now = Date.now();
  for (const [id, entry] of preResolvedDecisions.entries()) {
    if (now > entry.expiresAt) preResolvedDecisions.delete(id);
  }
}

export const hitlService = {
  /**
   * Block the calling agent until a human resolves this action.
   *
   * The promise resolves with the HitlDecision when:
   *   - Human approves → { approved: true, result: executionResult }
   *   - Human rejects  → { approved: false, comment: rejectionReason }
   *   - Timeout fires  → { approved: false, comment: 'No response within N minutes' }
   *
   * The timeout uses the policy rule's timeout_seconds if provided,
   * otherwise falls back to HITL_REVIEW_TIMEOUT_MS from limits.ts.
   */
  awaitDecision(actionId: string, timeoutMs: number): Promise<HitlDecision> {
    // Check if already resolved (race condition — approval came first)
    const preResolved = preResolvedDecisions.get(actionId);
    if (preResolved) {
      preResolvedDecisions.delete(actionId);
      return Promise.resolve(preResolved.decision);
    }

    return new Promise<HitlDecision>((resolve, reject) => {
      pendingDecisions.set(actionId, { resolve, reject });

      const timer = setTimeout(() => {
        if (pendingDecisions.has(actionId)) {
          pendingDecisions.delete(actionId);
          resolve({
            approved: false,
            comment: `No response received within ${Math.round(timeoutMs / 60000)} minutes. Action rejected by timeout.`,
          });
        }
      }, timeoutMs);

      // Do not keep the Node.js process alive just for HITL timeouts
      if (timer && typeof timer === 'object' && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    });
  },

  /**
   * Resolve a pending decision. Called by reviewService when a human
   * approves, rejects, or edits an action.
   *
   * If the agent is no longer awaiting (e.g. server restart or timeout
   * already fired), the decision is stored briefly in preResolvedDecisions
   * in case awaitDecision is called shortly after.
   */
  resolveDecision(actionId: string, decision: HitlDecision): void {
    const pending = pendingDecisions.get(actionId);
    if (pending) {
      pendingDecisions.delete(actionId);
      pending.resolve(decision);
      return;
    }

    // Store as pre-resolved in case awaitDecision is called very soon
    cleanupExpiredPreResolved();
    preResolvedDecisions.set(actionId, {
      decision,
      expiresAt: Date.now() + PRE_RESOLVED_TTL_MS,
    });
  },

  /** Check if an action is currently being awaited in-process. */
  isAwaited(actionId: string): boolean {
    return pendingDecisions.has(actionId);
  },

  /** Number of currently pending decisions. Useful for monitoring. */
  pendingCount(): number {
    return pendingDecisions.size;
  },
};
