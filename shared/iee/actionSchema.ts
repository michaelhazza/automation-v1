/**
 * IEE — Action schema returned by the LLM at each loop step.
 *
 * Spec: docs/iee-development-spec.md §5.4, §5.7, §12.2.
 *
 * The LLM returns one action per step as strict JSON (NOT a tool call —
 * see §5.5 for rationale). The worker validates against this schema before
 * executing. An invalid action classifies as `execution_error`.
 *
 * `done` and `failed` are the ONLY valid terminal actions. Step limit and
 * timeout are enforced externally. The loop has exactly four exit paths
 * (§12.1, §12.10).
 *
 * NOTE: This file deliberately does NOT register actions in
 * `server/config/actionRegistry.ts`. IEE actions are LLM-chosen sub-steps
 * within a single execution run; the reviewable/gateable unit is the
 * execution run itself, not each click. See spec §9.3 for the rationale and
 * the planned future addition of `iee_browser_task` / `iee_dev_task` at the
 * task level when gating becomes a requirement.
 */

import { z } from 'zod';

// --- Browser actions ---

const NavigateAction = z.object({
  type: z.literal('navigate'),
  url: z.string().url(),
});

const ClickAction = z.object({
  type: z.literal('click'),
  selector: z.string().min(1).max(500),
  /** Spec §12.2 — optional text fallback if the primary selector fails. */
  fallbackText: z.string().max(500).optional(),
});

const TypeAction = z.object({
  type: z.literal('type'),
  selector: z.string().min(1).max(500),
  text: z.string().max(4000),
  /** Spec §12.2 — optional text fallback if the primary selector fails. */
  fallbackText: z.string().max(500).optional(),
});

const ExtractAction = z.object({
  type: z.literal('extract'),
  query: z.string().min(1).max(1000),
});

const DownloadAction = z.object({
  type: z.literal('download'),
  selector: z.string().min(1).max(500),
});

// --- Dev actions ---

const RunCommandAction = z.object({
  type: z.literal('run_command'),
  command: z.string().min(1).max(2000),
});

const WriteFileAction = z.object({
  type: z.literal('write_file'),
  path: z.string().min(1).max(1000),
  content: z.string().max(200_000),
});

const ReadFileAction = z.object({
  type: z.literal('read_file'),
  path: z.string().min(1).max(1000),
});

const GitCloneAction = z.object({
  type: z.literal('git_clone'),
  repoUrl: z.string().url(),
  branch: z.string().max(200).optional(),
});

const GitCommitAction = z.object({
  type: z.literal('git_commit'),
  message: z.string().min(1).max(2000),
});

// --- Spend actions (Agentic Commerce Chunk 6) ---
// Emitted only from the worker_hosted_form execution path when the IEE worker
// initiates or completes a spend request. Recorded in iee_steps for audit trail.
// Spec: tasks/builds/agentic-commerce/spec.md §5.2, §8.3, §8.4a
// Plan: tasks/builds/agentic-commerce/plan.md §Chunk 6 (types pinned here; Chunk 11 wires queue)

const SpendRequestAction = z.object({
  type: z.literal('spend_request'),
  /** Full payload written to the agent-spend-request queue (§8.3). */
  payload: z.object({
    ieeRunId: z.string().uuid(),
    skillRunId: z.string().uuid(),
    organisationId: z.string().uuid(),
    subaccountId: z.string().uuid(),
    agentId: z.string().uuid(),
    toolCallId: z.string().uuid(),
    intent: z.string().min(1).max(500),
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3),
    merchant: z.object({
      id: z.string().nullable(),
      descriptor: z.string().min(1),
    }),
    chargeType: z.enum(['purchase', 'subscription', 'top_up', 'invoice_payment']),
    args: z.record(z.unknown()),
    /** Pre-built by worker using §9.1 key shape; main app recomputes and rejects on mismatch. */
    idempotencyKey: z.string().min(1),
    correlationId: z.string().uuid(),
  }),
});

const SpendCompletionAction = z.object({
  type: z.literal('spend_completion'),
  /**
   * Payload written to the agent-spend-completion queue (§8.4a).
   * Emitted only after the worker fills a merchant-hosted payment form on the
   * worker_hosted_form path. The main app's handler updates the agent_charges row.
   */
  payload: z.object({
    ledgerRowId: z.string().uuid(),
    outcome: z.enum(['merchant_succeeded', 'merchant_failed']),
    providerChargeId: z.string().nullable(),
    failureReason: z.string().nullable(),
    completedAt: z.string(), // ISO 8601 from worker clock
  }),
});

// --- Terminal actions (both modes) ---

const DoneAction = z.object({
  type: z.literal('done'),
  summary: z.string().min(1).max(4000),
  /** Spec §12.8 — optional 0..1 confidence the LLM may report. */
  confidence: z.number().min(0).max(1).optional(),
});

const FailedAction = z.object({
  type: z.literal('failed'),
  reason: z.string().min(1).max(1000),
});

// --- Discriminated union ---

export const ExecutionAction = z.discriminatedUnion('type', [
  NavigateAction,
  ClickAction,
  TypeAction,
  ExtractAction,
  DownloadAction,
  RunCommandAction,
  WriteFileAction,
  ReadFileAction,
  GitCloneAction,
  GitCommitAction,
  SpendRequestAction,
  SpendCompletionAction,
  DoneAction,
  FailedAction,
]);

export type ExecutionAction = z.infer<typeof ExecutionAction>;
export type ExecutionActionType = ExecutionAction['type'];

/** Payload type for the spend_request action (§8.3 WorkerSpendRequest shape). */
export type SpendRequestPayload = z.infer<typeof SpendRequestAction>['payload'];

/** Payload type for the spend_completion action (§8.4a WorkerSpendCompletion shape). */
export type SpendCompletionPayload = z.infer<typeof SpendCompletionAction>['payload'];

/**
 * Available action types per execution mode. The worker uses this to restrict
 * the union — e.g. a `run_command` returned in a browser execution is rejected
 * as `execution_error` without being run.
 *
 * Spec §5.4: "The `availableActions` set on each executor restricts this union
 * per mode."
 */
export const BROWSER_ACTION_TYPES: readonly ExecutionActionType[] = [
  'navigate',
  'click',
  'type',
  'extract',
  'download',
  // Spend actions are available in browser mode for worker_hosted_form execution path.
  // The worker emits spend_request before filling a merchant form, and spend_completion after.
  // Spec: tasks/builds/agentic-commerce/spec.md §5.2, §7.2
  'spend_request',
  'spend_completion',
  'done',
  'failed',
] as const;

export const DEV_ACTION_TYPES: readonly ExecutionActionType[] = [
  'run_command',
  'write_file',
  'read_file',
  'git_clone',
  'git_commit',
  'done',
  'failed',
] as const;

export const TERMINAL_ACTION_TYPES: readonly ExecutionActionType[] = ['done', 'failed'] as const;

export function isTerminalAction(action: ExecutionAction): action is z.infer<typeof DoneAction> | z.infer<typeof FailedAction> {
  return action.type === 'done' || action.type === 'failed';
}
