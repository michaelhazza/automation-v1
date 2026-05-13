// Pure helpers — no I/O. All logic here is deterministic and testable without DB or network.

/**
 * Decide whether a Slack write action should go through review or be auto-sent.
 * - post_message: always 'review'
 * - post_dm + target === ownerUserId: 'auto' (DM to self)
 * - post_dm + target !== ownerUserId: 'review'
 */
export function decideAutoSendScope(args: {
  action: 'post_message' | 'post_dm';
  target: string;
  ownerUserId: string;
}): 'auto' | 'review' {
  if (args.action === 'post_message') {
    return 'review';
  }
  return args.target === args.ownerUserId ? 'auto' : 'review';
}

/**
 * Validate post_message input: channelId and text required, text non-empty.
 */
export function validatePostMessageInput(
  input: unknown,
): { valid: true } | { valid: false; reason: string } {
  if (typeof input !== 'object' || input === null) {
    return { valid: false, reason: 'input must be an object' };
  }
  const obj = input as Record<string, unknown>;
  if (!obj.channelId || typeof obj.channelId !== 'string') {
    return { valid: false, reason: 'channelId is required' };
  }
  if (typeof obj.text !== 'string' || obj.text.trim() === '') {
    return { valid: false, reason: 'text is required and must be non-empty' };
  }
  return { valid: true };
}

/**
 * Validate post_dm input: targetUserId and text required.
 */
export function validatePostDmInput(
  input: unknown,
): { valid: true } | { valid: false; reason: string } {
  if (typeof input !== 'object' || input === null) {
    return { valid: false, reason: 'input must be an object' };
  }
  const obj = input as Record<string, unknown>;
  if (!obj.targetUserId || typeof obj.targetUserId !== 'string') {
    return { valid: false, reason: 'targetUserId is required' };
  }
  if (typeof obj.text !== 'string' || obj.text.trim() === '') {
    return { valid: false, reason: 'text is required and must be non-empty' };
  }
  return { valid: true };
}

/**
 * Deterministic idempotency key: action + ':' + ownerUserId + ':' + target + ':' + text.
 * Pure concatenation — no crypto dependency.
 */
export function deriveIdempotencyKey(args: {
  action: string;
  ownerUserId: string;
  target: string;
  text: string;
}): string {
  return `${args.action}:${args.ownerUserId}:${args.target}:${args.text}`;
}

/**
 * Assemble an LLM prompt for thread summarisation.
 * Takes an array of message objects and returns a prompt string.
 */
export function assembleThreadSummaryPrompt(
  messages: Array<{ user: string; text: string; ts: string }>,
): string {
  if (messages.length === 0) {
    return 'Summarise the following Slack thread:\n\n(no messages)';
  }
  const formatted = messages
    .map((m) => `[${m.ts}] <${m.user}>: ${m.text}`)
    .join('\n');
  return `Summarise the following Slack thread:\n\n${formatted}`;
}
