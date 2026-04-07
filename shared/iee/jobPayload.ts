/**
 * IEE — pg-boss job payload schemas.
 *
 * Spec: docs/iee-development-spec.md §3.2, §8 (job payload), §13.1 (executionRunId required).
 *
 * Imported by both `server/services/ieeExecutionService.ts` (enqueue) and
 * `worker/src/handlers/*` (consume) to keep the contract in lockstep.
 */

import { z } from 'zod';

/**
 * Browser-task contract — spec v3.4 §6.7.1 / T7.
 *
 * Constructed by the agent execution service from the agent's tool call
 * arguments + the resolved web_login connection. Never authored directly by
 * the LLM. The contract is the deny-by-default safety boundary for the
 * worker browser loop.
 */
export const BrowserTaskContract = z.object({
  /** Connection ID for paywall login (resolved by ID, never plaintext). */
  webLoginConnectionId: z.string().uuid().optional(),
  /** What the agent is asking for, in structured form. */
  intent: z.enum(['download_latest', 'download_by_url', 'extract_text', 'screenshot']),
  /** Domain allow-list — worker refuses to navigate outside these. */
  allowedDomains: z.array(z.string().min(1)).min(1).max(20),
  /** Expected artifact type — worker rejects mismatched downloads. */
  expectedArtifactKind: z
    .enum(['video', 'audio', 'document', 'image', 'text'])
    .optional(),
  /** MIME prefix the downloaded file's magic bytes must satisfy. */
  expectedMimeTypePrefix: z.string().max(64).optional(),
  /** Success condition — at least one branch must be present. */
  successCondition: z.object({
    selectorPresent: z.string().max(500).optional(),
    urlMatches: z.string().max(500).optional(),
    artifactDownloaded: z.boolean().optional(),
  }),
  /** Free-form context for the LLM loop — explanatory only, not authoritative. */
  goal: z.string().min(1).max(1000),
  /** Hard step limit. Default 20, max 50. */
  maxSteps: z.number().int().positive().max(50).default(20),
  /** Wall-clock cap in ms. Default 5min, max 10min. */
  timeoutMs: z.number().int().positive().max(600_000).default(300_000),
});
export type BrowserTaskContract = z.infer<typeof BrowserTaskContract>;

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
  /**
   * Optional credential reference — connection ID only, never plaintext.
   * Worker fetches and decrypts just-in-time. Spec v3.4 §6.6 / T1.
   */
  webLoginConnectionId: z.string().uuid().optional(),
  /**
   * Optional explicit contract for deny-by-default browser execution.
   * Constructed by the service, not the LLM. Spec v3.4 §6.7.1 / T7.
   */
  browserTaskContract: BrowserTaskContract.optional(),
  /**
   * Mode discriminator — 'standard' runs the LLM execution loop after
   * login, 'login_test' runs only login + optional content navigation +
   * screenshot, then exits without entering the LLM loop. Spec v3.4 §6.3.1 / T2.
   */
  mode: z.enum(['standard', 'login_test']).default('standard'),
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
