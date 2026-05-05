/**
 * inboundRateLimiterPure.ts — pure sliding-window math.
 *
 * Lives in its own module (separate from inboundRateLimiter.ts) so unit tests
 * can import it without dragging in `db` or any IO. Spec §6.2.3 invariant: the
 * weighting clamp is mandatory — leap-second drift and float rounding can
 * produce inputs fractionally outside [0, 1).
 */

/**
 * Effective count under sliding-window approximation.
 *
 * @param prevCount             Count in the previous fixed window (UNCLAMPED).
 * @param currentCount          Count in the current fixed window (UNCLAMPED).
 * @param elapsedFractionOfCurrentWindow
 *                              How far through the current window we are; clamped
 *                              into `[0, 1]` internally per the spec invariant.
 * @returns                     Weighted count for limit comparison.
 */
export function computeEffectiveCount(
  prevCount: number,
  currentCount: number,
  elapsedFractionOfCurrentWindow: number,
): number {
  const elapsed = Math.min(1, Math.max(0, elapsedFractionOfCurrentWindow));
  return prevCount * (1 - elapsed) + currentCount;
}
