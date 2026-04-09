/**
 * regressionCaptureServicePure — Sprint 2 P1.2 pure materialisation logic.
 *
 * Given the raw inputs (system prompt snapshot, tool manifest, message
 * transcript, rejected action) this module produces the materialised
 * capture payload that gets persisted to `regression_cases.input_contract_json`
 * and `rejected_call_json`, along with the canonical hashes used by the
 * replay harness.
 *
 * Kept pure (no DB, no env, no crypto side-effects beyond the sha256
 * fingerprinting) so it can be unit-tested without booting Postgres.
 *
 * Contract shapes are defined here rather than in the schema so tests can
 * import them without transitively pulling in drizzle.
 */

import { createHash } from 'node:crypto';

/** The shape stored in regression_cases.input_contract_json. */
export interface MaterialisedInputContract {
  /** sha256 of canonicalised contract, truncated to 16 chars. */
  version: 1;
  systemPromptSnapshot: string;
  toolManifest: Array<{ name: string; description?: string }>;
  transcript: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    /** For `tool` messages only, the tool name that produced the content. */
    toolName?: string;
  }>;
  runMetadata: {
    agentId: string;
    organisationId: string;
    subaccountId: string | null;
    modelId?: string;
    temperature?: number;
  };
}

/** The shape stored in regression_cases.rejected_call_json. */
export interface MaterialisedRejectedCall {
  version: 1;
  toolName: string;
  /** Canonicalised args — object keys sorted. */
  args: Record<string, unknown>;
}

export interface MaterialisedCapture {
  inputContract: MaterialisedInputContract;
  inputContractHash: string;
  rejectedCall: MaterialisedRejectedCall;
  rejectedCallHash: string;
}

/**
 * Canonicalise a JSON-serialisable value so two semantically-equal inputs
 * produce byte-identical output. Key-sorts recursively, treats arrays as
 * ordered (their order is semantically meaningful), and drops `undefined`
 * values (JSON.stringify would omit them anyway, but being explicit means
 * downstream diff tools don't see accidental key churn).
 */
export function canonicalise(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) {
      throw new Error('canonicalise: cycle detected');
    }
    seen.add(v as object);

    if (Array.isArray(v)) {
      return v.map(walk);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      const entry = (v as Record<string, unknown>)[key];
      if (entry !== undefined) {
        out[key] = walk(entry);
      }
    }
    return out;
  };

  return JSON.stringify(walk(value));
}

/**
 * sha256 of the canonicalised value, truncated to 16 hex chars — matches
 * the convention used by `actionService.hashActionArgs` so downstream
 * log/audit tooling can compare hashes across subsystems.
 */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalise(value)).digest('hex').slice(0, 16);
}

/**
 * Trim a conversation transcript to the last `maxMessages` messages,
 * dropping anything before the trim point. This keeps the stored payload
 * bounded regardless of how long the rejected run was — regression
 * replays care about the state *just before* the rejected proposal, not
 * the full history.
 */
export function trimTranscript<T>(messages: T[], maxMessages: number): T[] {
  if (messages.length <= maxMessages) return [...messages];
  return messages.slice(messages.length - maxMessages);
}

export interface MaterialiseInputs {
  systemPromptSnapshot: string;
  toolManifest: Array<{ name: string; description?: string | null }>;
  transcript: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolName?: string;
  }>;
  runMetadata: MaterialisedInputContract['runMetadata'];
  rejectedToolName: string;
  rejectedArgs: Record<string, unknown>;
  /** Cap on transcript size. Default 25 (≈ 5 agent turns). */
  maxTranscriptMessages?: number;
}

/**
 * Build the full MaterialisedCapture payload from the raw inputs.
 * This is the one function callers outside tests will use.
 */
export function materialiseCapture(inputs: MaterialiseInputs): MaterialisedCapture {
  const {
    systemPromptSnapshot,
    toolManifest,
    transcript,
    runMetadata,
    rejectedToolName,
    rejectedArgs,
    maxTranscriptMessages = 25,
  } = inputs;

  const trimmed = trimTranscript(transcript, maxTranscriptMessages);

  const inputContract: MaterialisedInputContract = {
    version: 1,
    systemPromptSnapshot,
    toolManifest: toolManifest.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
    })),
    transcript: trimmed,
    runMetadata,
  };

  const rejectedCall: MaterialisedRejectedCall = {
    version: 1,
    toolName: rejectedToolName,
    args: rejectedArgs,
  };

  return {
    inputContract,
    inputContractHash: fingerprint(inputContract),
    rejectedCall,
    rejectedCallHash: fingerprint({
      name: rejectedToolName,
      args: rejectedArgs,
    }),
  };
}
