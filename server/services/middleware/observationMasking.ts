import type { LLMMessage, LLMContentBlock } from '../llmService.js';

// ---------------------------------------------------------------------------
// Observation Masking — reduce token waste on long agent runs
//
// Replaces tool result content older than N iterations with a placeholder
// before each LLM call. The original messages array is never mutated.
//
// Inspired by GSD-2's observation masking (v2.59.0).
// ---------------------------------------------------------------------------

// Keep tool results from the last N iterations
const DEFAULT_KEEP_WINDOW = 5;

// Max chars per individual tool result before truncation
const MAX_TOOL_RESULT_CHARS = 1500;

const MASK_PLACEHOLDER = '[result masked — see earlier in conversation]';

// Extended message type with iteration tag
interface TaggedMessage extends LLMMessage {
  _iteration?: number;
}

/**
 * Tag a tool result message with its iteration number.
 * Call this when pushing tool results to the messages array in the loop.
 */
export function tagIteration(msg: LLMMessage, iteration: number): LLMMessage {
  return { ...msg, _iteration: iteration } as TaggedMessage;
}

/**
 * Create a masked copy of the messages array for the LLM call.
 * Tool results older than `keepWindow` iterations are replaced with a placeholder.
 * Recent tool results are preserved in full (but individually truncated if too large).
 *
 * Returns a new array — does not mutate the original.
 * Strips _iteration tags from output to avoid provider incompatibility.
 */
export function maskObservations(
  messages: LLMMessage[],
  currentIteration: number,
  keepWindow: number = DEFAULT_KEEP_WINDOW,
): LLMMessage[] {
  const keepFromIteration = Math.max(0, currentIteration - keepWindow);

  return messages.map(msg => {
    const tagged = msg as TaggedMessage;

    // Not a tagged tool result message — pass through as-is
    if (tagged._iteration === undefined) return msg;

    if (typeof msg.content === 'string') {
      // Strip _iteration tag from string messages
      const { _iteration: _, ...rest } = tagged;
      return rest as LLMMessage;
    }

    const blocks = msg.content as LLMContentBlock[];
    const hasToolResults = blocks.some(b => b.type === 'tool_result');
    if (!hasToolResults) {
      const { _iteration: _, ...rest } = tagged;
      return rest as LLMMessage;
    }

    if (tagged._iteration >= keepFromIteration) {
      // Recent — keep but truncate individual results, strip tag
      return {
        role: msg.role,
        content: blocks.map(block => {
          if (block.type === 'tool_result' && block.content.length > MAX_TOOL_RESULT_CHARS) {
            return {
              ...block,
              content: block.content.slice(0, MAX_TOOL_RESULT_CHARS) + '...[truncated]',
            };
          }
          return block;
        }),
      };
    }

    // Old — mask tool results, strip tag
    return {
      role: msg.role,
      content: blocks.map(block => {
        if (block.type === 'tool_result') {
          return { ...block, content: MASK_PLACEHOLDER };
        }
        return block;
      }),
    };
  });
}
