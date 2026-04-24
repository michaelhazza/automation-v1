// ---------------------------------------------------------------------------
// Skill-analyzer job status helpers (client)
// ---------------------------------------------------------------------------
// Keep in sync with SKILL_ANALYZER_*_STATUSES in
// server/services/skillAnalyzerServicePure.ts. The server module is the
// source of truth; this file is a minimal browser-safe mirror so the client
// can branch on status without dragging in server code.
//
// Centralised here per ChatGPT PR review Round 1 Finding 4 — the processing
// step previously had five separate `status === 'completed' || status ===
// 'failed'` checks, and the wizard had its own. Drift between the two was
// a foreseeable bug.
// ---------------------------------------------------------------------------

/** Statuses that mean no further pipeline work will occur. Matches
 *  SKILL_ANALYZER_TERMINAL_STATUSES on the server. */
export const ANALYZER_TERMINAL_STATUSES = ['completed', 'failed'] as const;

/** Statuses the pipeline writes while actively working a job. Mirrors
 *  SKILL_ANALYZER_MID_FLIGHT_STATUSES on the server. */
export const ANALYZER_MID_FLIGHT_STATUSES = [
  'parsing',
  'hashing',
  'embedding',
  'comparing',
  'classifying',
] as const;

/** A queued-but-not-yet-picked-up job. */
export const ANALYZER_PENDING_STATUS = 'pending' as const;

export type AnalyzerTerminalStatus = (typeof ANALYZER_TERMINAL_STATUSES)[number];
export type AnalyzerMidFlightStatus = (typeof ANALYZER_MID_FLIGHT_STATUSES)[number];

/** True iff the job is in a terminal state (completed or failed). The
 *  polling loop halts here; the resume button shows on `failed` specifically. */
export function isTerminalAnalyzerStatus(status: string): boolean {
  return (ANALYZER_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** True iff the pipeline is actively working the job (excludes pending
 *  and terminals). Used by the stalled-detection UI. */
export function isMidFlightAnalyzerStatus(status: string): boolean {
  return (ANALYZER_MID_FLIGHT_STATUSES as readonly string[]).includes(status);
}
