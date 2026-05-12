// operatorChainResumeServicePure.ts — resume-payload composer.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.14 item 5-6
//
// Pure module — no DB, no IO.

import type { CheckpointPayload } from '../../shared/types/checkpointPayload.js';

/** Default conversation history window: last K chain links of context. */
export const CONVERSATION_HISTORY_WINDOW_K = 5;

export interface ConversationArtefactPointer {
  /** Artefact id for the operator-conversation-link artefact of this chain link. */
  artefactId: string;
  /** The chain_seq of the chain link this artefact belongs to. */
  chainSeq: number;
}

export interface ResumePayloadInput {
  /** The agent_run_id (= task id). */
  agentRunId: string;
  /** The original task brief reference (from the first chain link's checkpoint). */
  originalTaskBriefRef: CheckpointPayload['original_task_brief_ref'];
  /**
   * All conversation artefact pointers for the current attempt, ordered by chainSeq ASC.
   * The composer will window to the last K entries.
   */
  conversationArtefactPointers: ConversationArtefactPointer[];
  /** The checkpoint payload from the most recent completed chain link. */
  checkpoint: CheckpointPayload;
  /** The current attempt number (fresh-profile restart semantics). */
  attemptNumber: number;
}

export interface ResumePayload {
  agentRunId: string;
  attemptNumber: number;
  originalTaskBriefRef: CheckpointPayload['original_task_brief_ref'];
  conversationHistoryPointer: {
    kind: 'artefact_chain';
    artefact_ids: string[];
    history_window_size: number;
  };
  currentPageUrl: string | undefined;
  lastActionSummary: string | undefined;
  nextPlannedStep: string | undefined;
  lastStateScreenshotArtefactId: string | undefined;
  /** Whether the checkpoint signals that the runtime can resume from this state. */
  isResumableNow: boolean;
  capturedAt: string;
}

/**
 * Composes the resume payload for the next chain link.
 *
 * - Joins the original task brief, the windowed conversation-history pointers,
 *   and the checkpoint from the prior chain link.
 * - Windows conversation history to the last K (default 5) artefact pointers by
 *   chainSeq (spec §3.14 item 6).
 * - The original task brief survives across attempts — it is taken from the
 *   checkpoint directly (always populated on the first chain link of each attempt).
 *
 * Note: spec §4.11 source-of-truth precedence: if operator-emitted last_action_summary
 * disagrees with the conversation-history pointer's last entry, the conversation-history
 * pointer wins. The pure composer does not resolve this disagreement — it simply passes
 * both through; the operator runtime at the receiving end applies the precedence rule.
 */
export function composeResumePayload(input: ResumePayloadInput): ResumePayload {
  const {
    agentRunId,
    originalTaskBriefRef,
    conversationArtefactPointers,
    checkpoint,
    attemptNumber,
  } = input;

  // Sort by chainSeq ascending (callers should pass pre-sorted, but be defensive).
  const sorted = [...conversationArtefactPointers].sort((a, b) => a.chainSeq - b.chainSeq);

  // Window to last K entries.
  const windowed = sorted.slice(-CONVERSATION_HISTORY_WINDOW_K);
  const artefactIds = windowed.map((p) => p.artefactId);

  return {
    agentRunId,
    attemptNumber,
    originalTaskBriefRef,
    conversationHistoryPointer: {
      kind: 'artefact_chain',
      artefact_ids: artefactIds,
      history_window_size: CONVERSATION_HISTORY_WINDOW_K,
    },
    currentPageUrl: checkpoint.current_page_url,
    lastActionSummary: checkpoint.last_action_summary,
    nextPlannedStep: checkpoint.next_planned_step,
    lastStateScreenshotArtefactId: checkpoint.last_state_screenshot_artefact_id,
    isResumableNow: checkpoint.is_resumable_now,
    capturedAt: checkpoint.captured_at,
  };
}
