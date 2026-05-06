// Pattern-based redaction for payload persistence.
// Spec: tasks/live-agent-execution-log-spec.md §7.4.
//
// Applies at write-time to `agent_run_llm_payloads.messages` and
// `agent_run_llm_payloads.response` to scrub obvious secrets before the
// payload hits the durable record. Every hit is recorded in the
// `redacted_fields` column so operators know the payload was scrubbed.
//
// **This is defence-in-depth, not a security boundary.** The real guard
// is the AGENTS_EDIT permission on the payload-read endpoint. Novel
// secret shapes WILL slip past these patterns; plan for it.

import type { PayloadRedaction } from '../../shared/types/agentExecutionLog.js';

// ---------------------------------------------------------------------------
// Default pattern bundle
// ---------------------------------------------------------------------------

export interface RedactionPattern {
  /** Short stable name recorded in the `pattern` column. */
  name: string;
  /** Regex to match. Must use /g flag or be rebuilt with it internally. */
  regex: RegExp;
  /** Replacement string written into the scrubbed output. */
  replacement: string;
}

/**
 * Non-exhaustive default library. Extend via the second argument of
 * `redactWalker`. Patterns are cheap — prefer more patterns over cleverer ones.
 */
export const DEFAULT_REDACTION_PATTERNS: readonly RedactionPattern[] = [
  {
    name: 'bearer_token',
    regex: /Bearer\s+[A-Za-z0-9._-]{20,}/g,
    replacement: '[REDACTED:bearer]',
  },
  {
    name: 'openai_project_key',
    regex: /sk-proj-[A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED:openai_key]',
  },
  {
    name: 'openai_key',
    regex: /sk-[A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED:openai_key]',
  },
  {
    name: 'anthropic_key',
    regex: /sk-ant-[A-Za-z0-9-]{20,}/g,
    replacement: '[REDACTED:anthropic_key]',
  },
  {
    name: 'github_pat',
    regex: /ghp_[A-Za-z0-9]{36}/g,
    replacement: '[REDACTED:github_token]',
  },
  {
    name: 'github_app_token',
    regex: /ghs_[A-Za-z0-9]{36}/g,
    replacement: '[REDACTED:github_token]',
  },
  {
    name: 'slack_bot_token',
    regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    replacement: '[REDACTED:slack_token]',
  },
  {
    name: 'aws_access_key_id',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:aws_key_id]',
  },
  {
    name: 'google_api_key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: '[REDACTED:google_api_key]',
  },
];

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

interface RedactionHit {
  path: string;
  name: string;
  replacement: string;
  count: number;
}

function redactString(
  input: string,
  patterns: readonly RedactionPattern[],
): { out: string; hits: Array<{ name: string; replacement: string; count: number }> } {
  let out = input;
  const hits: Array<{ name: string; replacement: string; count: number }> = [];
  for (const p of patterns) {
    // Ensure /g — otherwise .match returns only the first hit and
    // .replace doesn't loop. Rebuild if missing.
    const re = p.regex.flags.includes('g')
      ? p.regex
      : new RegExp(p.regex.source, p.regex.flags + 'g');
    const matches = out.match(re);
    if (matches && matches.length > 0) {
      out = out.replace(re, p.replacement);
      hits.push({ name: p.name, replacement: p.replacement, count: matches.length });
    }
  }
  return { out, hits };
}

/**
 * Recursively walk a JSON value and redact every string leaf. Arrays +
 * objects are descended into; numbers / booleans / null are passed through.
 * Returns a fresh copy of the input (no mutation) + a flat list of hits
 * annotated with the JSON path at which they were found.
 *
 * Cycle-safe: a WeakSet tracks visited objects and short-circuits on
 * revisit, so self-referential inputs don't blow the stack.
 */
export function redactValue(
  input: unknown,
  patterns: readonly RedactionPattern[] = DEFAULT_REDACTION_PATTERNS,
): { value: unknown; redactions: PayloadRedaction[] } {
  const redactions: PayloadRedaction[] = [];
  const seen = new WeakSet<object>();

  function walk(value: unknown, path: string): unknown {
    if (typeof value === 'string') {
      const { out, hits } = redactString(value, patterns);
      if (hits.length > 0) {
        for (const h of hits) {
          redactions.push({
            path,
            pattern: h.name,
            replacedWith: h.replacement,
            count: h.count,
          });
        }
      }
      return out;
    }
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value as object)) return '[cycle]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item, idx) =>
        walk(item, path.length === 0 ? String(idx) : `${path}.${idx}`),
      );
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(child, path.length === 0 ? key : `${path}.${key}`);
    }
    return out;
  }

  const value = walk(input, '');
  return { value, redactions };
}
