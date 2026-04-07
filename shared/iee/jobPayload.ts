/**
 * IEE — pg-boss job payload schemas.
 *
 * Spec: docs/iee-development-spec.md §3.2, §8 (job payload), §13.1 (executionRunId required).
 *
 * Imported by both `server/services/ieeExecutionService.ts` (enqueue) and
 * `worker/src/handlers/*` (consume) to keep the contract in lockstep.
 */

import { z } from 'zod';

export const BrowserTaskPayload = z.object({
  type: z.literal('browser'),
  goal: z.string().min(1).max(2000),
  startUrl: z.string().url().optional(),
  /** Org- or subaccount-scoped session identifier. Spec §6.2. */
  sessionKey: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, 'sessionKey must be alphanumeric, underscore, or dash only')
    .optional(),
});
export type BrowserTaskPayload = z.infer<typeof BrowserTaskPayload>;

export const DevTaskPayload = z.object({
  type: z.literal('dev'),
  goal: z.string().min(1).max(2000),
  repoUrl: z.string().url().optional(),
  branch: z.string().max(200).optional(),
  commands: z.array(z.string().max(2000)).max(20).optional(),
});
export type DevTaskPayload = z.infer<typeof DevTaskPayload>;

export const IEETask = z.discriminatedUnion('type', [BrowserTaskPayload, DevTaskPayload]);
export type IEETask = z.infer<typeof IEETask>;

/**
 * The full pg-boss job payload. The app inserts the `execution_runs` row at
 * enqueue time and passes the resulting `executionRunId` here. The worker
 * updates that exact row — keeping idempotency atomic at the database layer.
 */
export const IEEJobPayload = z.object({
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid().nullable(),
  agentId: z.string().uuid(),
  runId: z.string().uuid(),
  executionRunId: z.string().uuid(),
  correlationId: z.string().min(1).max(64),
  idempotencyKey: z.string().min(1).max(128),
  task: IEETask,
});
export type IEEJobPayload = z.infer<typeof IEEJobPayload>;

/**
 * Result summary contract written to `execution_runs.resultSummary` at the
 * terminal status update. Spec §7.1, §12.8.
 */
export const ResultSummary = z.object({
  success: z.boolean(),
  output: z.unknown().optional(),
  artifacts: z.array(z.string()).optional(),
  stepCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** Spec §12.8 — optional 0..1 confidence carried from the `done` action. */
  confidence: z.number().min(0).max(1).optional(),
  /** Denormalised at completion for fast list views — spec §11.7.2. */
  llmCostUsd: z.number().nonnegative().optional(),
  runtimeCostUsd: z.number().nonnegative().optional(),
});
export type ResultSummary = z.infer<typeof ResultSummary>;
