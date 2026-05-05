import type { Severity, HeuristicContext } from '../heuristics/types.js';

export type { Severity };

export interface SyntheticCheck {
  id: string;
  description: string;
  defaultSeverity: Severity;
  run(ctx: HeuristicContext): Promise<SyntheticResult>;
}

export type SyntheticResult =
  | { fired: false }
  | {
      fired: true;
      severity: Severity;
      resourceKind: string;
      resourceId: string;
      summary: string;
      bucketKey: string;     // time-bucket for idempotency (e.g. '2026-04-25T14:30')
      metadata: Record<string, unknown>;
    };

/** 15-minute time bucket key — collapses repeated fires for the same issue. */
export function bucket15min(now: Date): string {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
  return d.toISOString().slice(0, 16); // '2026-04-25T14:30'
}
