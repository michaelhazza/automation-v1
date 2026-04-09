/**
 * critiqueGatePure — Sprint 5 P4.4 pure helpers for the semantic
 * critique gate.
 *
 * Invariants: no imports of db, env, or services. Every exported function
 * is referentially transparent. The verify-pure-helper-convention.sh gate
 * enforces the *Pure.ts + *.test.ts sibling relationship.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CritiqueResult {
  verdict: 'ok' | 'suspect';
  reason: string;
}

// ─── Critique prompt builder ─────────────────────────────────────────────────

/**
 * Build the critique prompt for the flash-tier evaluator.
 */
export function buildCritiquePrompt(
  toolName: string,
  toolArgs: Record<string, unknown>,
  recentMessages: Array<{ role: string; content: string }>,
): string {
  const contextLines = recentMessages
    .slice(-3) // Last 3 messages
    .map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`)
    .join('\n');

  const argsStr = JSON.stringify(toolArgs, null, 2).slice(0, 2000);

  return [
    'You are a critique gate. The agent is about to call a tool.',
    `Tool: ${toolName}`,
    `Args: ${argsStr}`,
    `Context (last 3 messages):\n${contextLines}`,
    '',
    'Question: Is this tool call coherent with the user\'s request?',
    'Answer with JSON: { "verdict": "ok" | "suspect", "reason": "..." }',
    'Respond ONLY with the JSON object.',
  ].join('\n');
}

// ─── Result parser ───────────────────────────────────────────────────────────

/**
 * Parse the critique response from the flash-tier model.
 * Returns null if the response is malformed.
 */
export function parseCritiqueResult(content: string | null | undefined): CritiqueResult | null {
  if (!content || typeof content !== 'string') return null;

  let jsonStr = content.trim();

  // Strip markdown fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.verdict === 'ok' || parsed.verdict === 'suspect') &&
      typeof parsed.reason === 'string'
    ) {
      return { verdict: parsed.verdict, reason: parsed.reason };
    }
  } catch {
    // Try to extract JSON object from the text
    const jsonMatch = content.match(/\{[\s\S]*"verdict"\s*:\s*"(?:ok|suspect)"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (
          (parsed.verdict === 'ok' || parsed.verdict === 'suspect') &&
          typeof parsed.reason === 'string'
        ) {
          return { verdict: parsed.verdict, reason: parsed.reason };
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Determine if a given action should be evaluated by the critique gate.
 */
export function shouldCritique(params: {
  phase: string;
  wasDowngraded: boolean;
  requiresCritiqueGate: boolean;
  shadowMode: boolean;
}): boolean {
  // Only evaluate during execution phase
  if (params.phase !== 'execution') return false;
  // Only evaluate economy-tier (downgraded) outputs
  if (!params.wasDowngraded) return false;
  // Only evaluate actions with the opt-in flag
  if (!params.requiresCritiqueGate) return false;
  // Shadow mode check is always true for now — but included for when active mode ships
  return true;
}
