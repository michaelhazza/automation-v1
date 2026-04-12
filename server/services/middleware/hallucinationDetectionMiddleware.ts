/**
 * hallucinationDetectionMiddleware — Phase 3C of Agent Intelligence Upgrade.
 *
 * PostTool middleware that extracts entity-like references from the latest
 * assistant message (quoted strings and capitalized multi-word phrases) and
 * cross-checks them against known workspace entities for the current
 * subaccount. When unmatched references are found, an advisory message is
 * injected so the agent can self-correct before acting on hallucinated names.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceEntities } from '../../db/schema/index.js';
import type {
  MiddlewareContext,
  PostToolMiddleware,
  PostToolResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract entity-like references from text:
 * 1. Quoted strings — "Foo Bar" or 'Foo Bar'
 * 2. Capitalized multi-word phrases — two or more consecutive capitalized words
 *    (e.g. "Acme Corp", "John Smith Project")
 *
 * Returns deduplicated references.
 */
function extractEntityReferences(text: string): string[] {
  const refs = new Set<string>();

  // Quoted strings (double or single quotes, at least 2 chars inside)
  const quotedPattern = /["']([A-Za-z][A-Za-z0-9 ]{1,}?)["']/g;
  let match: RegExpExecArray | null;
  while ((match = quotedPattern.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (candidate.length >= 2) {
      refs.add(candidate);
    }
  }

  // Capitalized multi-word phrases (2+ consecutive capitalized words)
  const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  while ((match = capitalizedPattern.exec(text)) !== null) {
    refs.add(match[1]);
  }

  return Array.from(refs);
}

/**
 * Extract the text of the last assistant message from a messages array.
 * Handles both string content and array-of-parts content blocks.
 */
function getLastAssistantText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== 'assistant') continue;

    if (typeof msg.content === 'string') return msg.content;

    // Array-of-parts format: extract text blocks
    if (Array.isArray(msg.content)) {
      const textParts = (msg.content as Array<{ type?: string; text?: string }>)
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text!);
      if (textParts.length > 0) return textParts.join('\n');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const hallucinationDetectionMiddleware: PostToolMiddleware = {
  name: 'hallucinationDetection',

  execute(
    ctx: MiddlewareContext,
    _toolCall: { name: string; input: Record<string, unknown> },
    _result: { content: string; durationMs: number },
  ): Promise<PostToolResult> {
    return executeAsync(ctx);
  },
};

async function executeAsync(ctx: MiddlewareContext): Promise<PostToolResult> {
  // 1. Extract the latest assistant message text
  const messages = (ctx as unknown as { messages?: unknown[] }).messages;
  let assistantText: string | null = null;

  if (ctx.lastAssistantText) {
    assistantText = ctx.lastAssistantText;
  } else if (Array.isArray(messages)) {
    assistantText = getLastAssistantText(messages);
  }

  if (!assistantText) {
    return { action: 'continue' };
  }

  // 2. Extract entity-like references
  const references = extractEntityReferences(assistantText);
  if (references.length === 0) {
    return { action: 'continue' };
  }

  // 3. Load valid workspace entities for this subaccount
  const subaccountId = ctx.request.subaccountId;
  if (!subaccountId) {
    return { action: 'continue' };
  }

  const entities = await db
    .select({ name: workspaceEntities.name, displayName: workspaceEntities.displayName })
    .from(workspaceEntities)
    .where(
      and(
        eq(workspaceEntities.subaccountId, subaccountId),
        isNull(workspaceEntities.validTo),
        isNull(workspaceEntities.deletedAt),
      ),
    );

  if (entities.length === 0) {
    // No known entities — nothing to cross-check against
    return { action: 'continue' };
  }

  // Build a set of known entity names (lowercase for case-insensitive matching)
  const knownNames = new Set(
    entities.flatMap((e: { name: string; displayName: string }) => [e.name.toLowerCase(), e.displayName.toLowerCase()]),
  );

  // 4. Check each extracted reference against known entities
  const unmatched: string[] = [];
  for (const ref of references) {
    if (!knownNames.has(ref.toLowerCase())) {
      unmatched.push(ref);
    }
  }

  // 5. Return result
  if (unmatched.length === 0) {
    return { action: 'continue' };
  }

  const nameList = unmatched.map((n) => `"${n}"`).join(', ');
  return {
    action: 'inject_message',
    message: `Note: You referenced ${nameList} which are not known entities in this workspace. Please verify these references are accurate before proceeding.`,
  };
}
