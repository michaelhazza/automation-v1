import { z } from 'zod';

export const SUGGESTED_ACTION_KEYS = ['save_thread_as_agent', 'schedule_daily', 'pin_skill'] as const;
export type SuggestedActionKey = typeof SUGGESTED_ACTION_KEYS[number];

export const suggestedActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prompt'),
    label: z.string().min(1).max(80),
    prompt: z.string().min(1).max(2000),
  }),
  z.object({
    kind: z.literal('system'),
    label: z.string().min(1).max(80),
    actionKey: z.enum(SUGGESTED_ACTION_KEYS),
  }),
]);

export type SuggestedAction = z.infer<typeof suggestedActionSchema>;

export const suggestedActionsArraySchema = z.array(suggestedActionSchema).max(4);

const BLOCK_REGEX = /\s*<suggested_actions>\s*([\s\S]*?)\s*<\/suggested_actions>\s*$/;

/**
 * Parse suggested actions from raw LLM response content.
 * - Extracts the <suggested_actions> block from the end of content (if present).
 * - Returns { chips, strippedContent } — strippedContent has the block removed.
 * - Never throws. Drops invalid entries with a warn log.
 */
export function parseSuggestedActions(
  raw: unknown,
  logCtx: { conversationId: string },
): { chips: SuggestedAction[]; strippedContent: string } {
  const content = typeof raw === 'string' ? raw : '';

  const match = BLOCK_REGEX.exec(content);
  if (!match) {
    return { chips: [], strippedContent: content };
  }

  const strippedContent = content.slice(0, content.length - match[0].length);
  const jsonStr = match[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn('[suggestedActions] Failed to parse JSON block', {
      conversationId: logCtx.conversationId,
      jsonStr: jsonStr.slice(0, 200),
    });
    return { chips: [], strippedContent };
  }

  if (!Array.isArray(parsed)) {
    console.warn('[suggestedActions] Expected array, got non-array', {
      conversationId: logCtx.conversationId,
    });
    return { chips: [], strippedContent };
  }

  const chips: SuggestedAction[] = [];
  for (const item of parsed) {
    const result = suggestedActionSchema.safeParse(item);
    if (result.success) {
      chips.push(result.data);
    } else {
      console.warn('[suggestedActions] Dropping invalid chip entry', {
        conversationId: logCtx.conversationId,
        item,
        error: result.error.message,
      });
    }
  }

  // Enforce max 4
  return { chips: chips.slice(0, 4), strippedContent };
}
