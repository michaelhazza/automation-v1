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
  DoneAction,
  FailedAction,
]);

export type ExecutionAction = z.infer<typeof ExecutionAction>;
export type ExecutionActionType = ExecutionAction['type'];

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
