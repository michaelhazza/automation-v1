import type { FetchFailureReason } from '../db/schema/documentFetchEvents.js';

export class RetrySuppressor {
  private readonly suppressUntil = new Map<string, number>();
  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private key(refId: string, reason: FetchFailureReason): string {
    return `${refId}:${reason}`;
  }

  recordFailure(refId: string, reason: FetchFailureReason): void {
    this.suppressUntil.set(this.key(refId, reason), this.now() + this.windowMs);
  }

  shouldSuppress(refId: string, reason: FetchFailureReason): boolean {
    const until = this.suppressUntil.get(this.key(refId, reason));
    if (until === undefined) return false;
    if (this.now() > until) {
      this.suppressUntil.delete(this.key(refId, reason));
      return false;
    }
    return true;
  }
}
