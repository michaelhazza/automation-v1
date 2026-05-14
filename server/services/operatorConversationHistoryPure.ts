// operatorConversationHistoryPure.ts — per-chain-link conversation-history windowing.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.14 item 6
//
// Pure module — no DB, no IO.

/** Default conversation history window size (last K chain links). */
export const CONVERSATION_HISTORY_K = 5;

export interface ConversationLinkArtefactPointer {
  /** Artefact id for the operator-conversation-link artefact. */
  artefactId: string;
  /** chain_seq of the chain link this artefact belongs to (1-based). */
  chainSeq: number;
  /** attempt_number of the chain link (used to filter cross-attempt history). */
  attemptNumber: number;
}

export interface WindowedConversationHistory {
  /** Ordered artefact ids (chain order ASC) for the history window. */
  artefactIds: string[];
  /** Number of artefact pointers considered (may be less than K if fewer links exist). */
  windowSize: number;
}

/**
 * Windows the conversation history to the last K chain links of the current attempt.
 *
 * Rules:
 * - Only artefacts from the specified currentAttemptNumber are included.
 *   (Conversation history resets at the attempt boundary per spec §3.15 item 7.)
 * - Artefacts are ordered by chainSeq ASC.
 * - The window is capped at the last K entries (K = CONVERSATION_HISTORY_K = 5).
 *
 * @param allArtefactPointers - All artefact pointers for the task (any attempt).
 * @param currentAttemptNumber - Only include artefacts from this attempt.
 * @param k - Override the window size (defaults to CONVERSATION_HISTORY_K).
 */
export function windowConversationHistory(
  allArtefactPointers: ConversationLinkArtefactPointer[],
  currentAttemptNumber: number,
  k: number = CONVERSATION_HISTORY_K,
): WindowedConversationHistory {
  const forCurrentAttempt = allArtefactPointers.filter(
    (p) => p.attemptNumber === currentAttemptNumber,
  );

  const sorted = [...forCurrentAttempt].sort((a, b) => a.chainSeq - b.chainSeq);
  const windowed = sorted.slice(-k);
  const artefactIds = windowed.map((p) => p.artefactId);

  return {
    artefactIds,
    windowSize: artefactIds.length,
  };
}

/**
 * Concatenates artefact pointers for the conversation history pointer field
 * in the checkpoint_payload.
 *
 * Returns the list of artefact ids in chain order for a given attempt and window.
 */
export function concatenateArtefactPointers(
  artefactPointers: ConversationLinkArtefactPointer[],
  currentAttemptNumber: number,
  k: number = CONVERSATION_HISTORY_K,
): string[] {
  const { artefactIds } = windowConversationHistory(artefactPointers, currentAttemptNumber, k);
  return artefactIds;
}

/**
 * Derives the history_window_size for the conversation_history_pointer field.
 *
 * This is the constant K, not the actual count of artefacts in the window.
 * The constant signals to the operator runtime how many links of context
 * were used to compose this payload (even when fewer links exist).
 */
export function deriveHistoryWindowSize(): number {
  return CONVERSATION_HISTORY_K;
}
