/**
 * trajectorySchema.ts — Zod schemas for reference trajectory format.
 *
 * Sprint 4 P3.3: structural trajectory comparison. The Zod schema here
 * is the single source of truth for reference trajectory files stored
 * under `tests/trajectories/*.json`.
 */

import { z } from 'zod';

// ── Match modes ─────────────────────────────────────────────────────────────

export const MatchMode = z.enum(['exact', 'in-order', 'any-order', 'single-tool']);
export type MatchMode = z.infer<typeof MatchMode>;

// ── Argument matchers ───────────────────────────────────────────────────────

/**
 * Partial-equality check on tool args. Each key must equal the
 * corresponding key in the actual call. Missing keys are ignored.
 */
export const ArgMatchers = z.record(z.string(), z.unknown());
export type ArgMatchers = z.infer<typeof ArgMatchers>;

// ── Expected action ─────────────────────────────────────────────────────────

export const ExpectedAction = z.object({
  actionType: z.string(),
  argMatchers: ArgMatchers.optional(),
});
export type ExpectedAction = z.infer<typeof ExpectedAction>;

// ── Reference trajectory ────────────────────────────────────────────────────

export const ReferenceTrajectory = z.object({
  name: z.string(),
  description: z.string().optional(),
  fixtureRunId: z.string().optional(),
  matchMode: MatchMode,
  expected: z.array(ExpectedAction).min(1),
});
export type ReferenceTrajectory = z.infer<typeof ReferenceTrajectory>;

// ── Actual trajectory event (loaded from actions table) ─────────────────────

export const TrajectoryEvent = z.object({
  actionType: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().optional(),
});
export type TrajectoryEvent = z.infer<typeof TrajectoryEvent>;

// ── Diff result ─────────────────────────────────────────────────────────────

export const DiffEntry = z.object({
  index: z.number(),
  expected: ExpectedAction,
  status: z.enum(['match', 'missing', 'wrong_order', 'arg_mismatch']),
  actual: TrajectoryEvent.optional(),
  details: z.string().optional(),
});
export type DiffEntry = z.infer<typeof DiffEntry>;

export const TrajectoryDiff = z.object({
  name: z.string(),
  matchMode: MatchMode,
  pass: z.boolean(),
  entries: z.array(DiffEntry),
  extraActions: z.array(TrajectoryEvent).optional(),
});
export type TrajectoryDiff = z.infer<typeof TrajectoryDiff>;
