// Pure-ish builder for agent_run_llm_payloads rows.
//
// Pipeline order (spec §4.5, §5.7): redaction → tool-policy → size-cap
// truncation. Extracted from llmRouter so the whole pipeline is one
// unit-testable function. The router calls `buildPayloadRow(...)`, then
// inserts the result into `agent_run_llm_payloads` in the same
// transaction that writes the terminal ledger row.

import type {
  PayloadModification,
  PayloadPersistencePolicy,
  PayloadRedaction,
} from '../../shared/types/agentExecutionLog.js';
import {
  DEFAULT_REDACTION_PATTERNS,
  redactValue,
  type RedactionPattern,
} from '../lib/redaction.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface BuildPayloadRowInput {
  systemPrompt: string;
  messages: unknown[];
  toolDefinitions: unknown[];
  /**
   * Provider response. `null` only when there is no usable provider output to
   * persist (provider rejected before stream open, network error before any
   * bytes arrived, response un-parseable). A structurally-valid partial
   * response (streaming interrupted mid-completion) MUST be passed through
   * here as a non-null partial — adapters that build incrementally pass
   * whatever they have at the failure boundary; adapters that build
   * atomically pass null. Spec
   * `2026-04-28-pre-test-integration-harness-spec.md` §1.5 Option A.
   */
  response: Record<string, unknown> | null;
  /** Per-tool policy map. Missing keys default to 'full'. */
  toolPolicies?: Record<string, PayloadPersistencePolicy>;
  maxBytes: number;
  /** Override the default redaction library. Defaults to the standard bundle. */
  patterns?: readonly RedactionPattern[];
}

export interface BuildPayloadRowOutput {
  systemPrompt: string;
  messages: unknown[];
  toolDefinitions: unknown[];
  /**
   * `null` propagates through from the input when no usable provider output
   * was available; otherwise the redacted + truncation-applied response.
   */
  response: Record<string, unknown> | null;
  redactedFields: PayloadRedaction[];
  modifications: PayloadModification[];
  totalSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Byte-length helpers (use Buffer when available for accurate byte count)
// ---------------------------------------------------------------------------

function byteLengthOf(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (value == null) return 4; // "null"
  const json = JSON.stringify(value);
  return Buffer.byteLength(json, 'utf8');
}

function computeTotalBytes(
  systemPrompt: string,
  messages: unknown[],
  toolDefinitions: unknown[],
  response: Record<string, unknown> | null,
): number {
  return (
    byteLengthOf(systemPrompt) +
    byteLengthOf(messages) +
    byteLengthOf(toolDefinitions) +
    byteLengthOf(response)
  );
}

// ---------------------------------------------------------------------------
// Tool-policy application
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface ToolCallHit {
  path: string;
  toolSlug: string;
}

/**
 * Walk a provider-neutral messages array and find every tool-call's
 * arguments sub-tree. The exact layout varies across providers, but the
 * two most common shapes are:
 *
 *   Anthropic: `messages[i].content` is an array of blocks; tool-use blocks
 *     have `{ type: 'tool_use', name: string, input: object }`.
 *
 *   OpenAI: `messages[i].tool_calls[j]` has `{ function: { name, arguments } }`.
 *
 * We detect both. The returned `path` points at the field to replace.
 */
/**
 * Paths are relative to the messages array root — so index 0 is just `0`,
 * not `messages.0`. The `messages.` prefix is reapplied when paths are
 * surfaced to the caller via `modifications[].field`.
 */
function findToolCalls(messages: unknown[]): ToolCallHit[] {
  const hits: ToolCallHit[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;

    // Anthropic content-blocks shape
    const content = msg.content;
    if (Array.isArray(content)) {
      for (let j = 0; j < content.length; j++) {
        const block = content[j];
        if (isRecord(block) && block.type === 'tool_use' && typeof block.name === 'string') {
          hits.push({ path: `${i}.content.${j}.input`, toolSlug: block.name });
        }
      }
    }

    // OpenAI tool_calls shape
    const toolCalls = msg.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (let j = 0; j < toolCalls.length; j++) {
        const tc = toolCalls[j];
        if (isRecord(tc) && isRecord(tc.function) && typeof tc.function.name === 'string') {
          hits.push({
            path: `${i}.tool_calls.${j}.function.arguments`,
            toolSlug: tc.function.name,
          });
        }
      }
    }
  }
  return hits;
}

function setAtPath(obj: unknown, path: string, replacement: unknown): boolean {
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (Array.isArray(cursor)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return false;
      cursor = cursor[idx];
    } else if (isRecord(cursor)) {
      cursor = cursor[part];
    } else {
      return false;
    }
    if (cursor == null) return false;
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cursor)) {
    const idx = Number(last);
    if (!Number.isInteger(idx)) return false;
    cursor[idx] = replacement;
    return true;
  }
  if (isRecord(cursor)) {
    cursor[last] = replacement;
    return true;
  }
  return false;
}

function applyToolPolicies(
  messages: unknown[],
  toolPolicies: Record<string, PayloadPersistencePolicy>,
): { modifications: PayloadModification[] } {
  const modifications: PayloadModification[] = [];
  const hits = findToolCalls(messages);
  for (const hit of hits) {
    const policy = toolPolicies[hit.toolSlug] ?? 'full';
    if (policy === 'full') continue;
    const replacement = policy === 'args-redacted'
      ? '[POLICY:args-redacted]'
      : '[POLICY:args-never-persisted]';
    const ok = setAtPath(messages, hit.path, replacement);
    if (ok) {
      modifications.push({
        kind: 'tool_policy',
        field: `messages.${hit.path}`,
        policy,
        toolSlug: hit.toolSlug,
      });
    }
  }
  return { modifications };
}

// ---------------------------------------------------------------------------
// Greatest-first truncation
// ---------------------------------------------------------------------------

interface FieldCandidate {
  pathSource: 'messages' | 'response';
  path: string;
  /** Index or key to reach the container holding the string. */
  apply: (newValue: string) => void;
  currentValue: string;
  currentBytes: number;
}

function collectStringCandidates(
  messages: unknown[],
  response: Record<string, unknown> | null,
): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];

  function walk(
    value: unknown,
    pathSource: 'messages' | 'response',
    path: string,
    setter: (newValue: string) => void,
  ): void {
    if (typeof value === 'string') {
      const bytes = Buffer.byteLength(value, 'utf8');
      // Only consider fields large enough to matter.
      if (bytes >= 256) {
        candidates.push({
          pathSource,
          path,
          apply: setter,
          currentValue: value,
          currentBytes: bytes,
        });
      }
      return;
    }
    if (value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        walk(item, pathSource, `${path}.${idx}`, (nv: string) => {
          value[idx] = nv;
        });
      });
      return;
    }
    const rec = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      const nextPath = path.length === 0 ? k : `${path}.${k}`;
      walk(v, pathSource, nextPath, (nv: string) => {
        rec[k] = nv;
      });
    }
  }

  walk(messages, 'messages', 'messages', () => {
    /* root array is never reassigned */
  });
  if (response !== null) {
    walk(response, 'response', 'response', () => {
      /* root object is never reassigned */
    });
  }

  return candidates;
}

function truncateString(value: string, targetBytes: number): string {
  const buf = Buffer.from(value, 'utf8');
  if (buf.byteLength <= targetBytes) return value;
  // Leave a visible marker so the UI can render "truncated" without
  // needing to inspect modifications. 32-byte marker.
  const marker = '\n… [truncated] …';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const keep = Math.max(0, targetBytes - markerBytes);
  return buf.slice(0, keep).toString('utf8') + marker;
}

function truncateGreatestFirst(
  systemPrompt: string,
  messages: unknown[],
  toolDefinitions: unknown[],
  response: Record<string, unknown> | null,
  maxBytes: number,
  modifications: PayloadModification[],
): { systemPrompt: string; totalBytes: number } {
  let currentBytes = computeTotalBytes(systemPrompt, messages, toolDefinitions, response);
  if (currentBytes <= maxBytes) {
    return { systemPrompt, totalBytes: currentBytes };
  }

  // 128-byte headroom — the spec asks for this so the row fits under cap
  // after re-serialisation overhead.
  const headroom = 128;
  const effectiveCap = Math.max(1024, maxBytes - headroom);

  // Candidates from messages + response, sorted greatest-first.
  const candidates = collectStringCandidates(messages, response);
  candidates.sort((a, b) => b.currentBytes - a.currentBytes);

  for (const c of candidates) {
    if (currentBytes <= effectiveCap) break;
    const excess = currentBytes - effectiveCap;
    // How much can we cut from this field?
    const cuttable = Math.max(0, c.currentBytes - 256); // keep first 256 bytes readable
    if (cuttable <= 0) continue;
    const bytesToCut = Math.min(excess, cuttable);
    const targetBytes = c.currentBytes - bytesToCut;
    const truncated = truncateString(c.currentValue, targetBytes);
    const newBytes = Buffer.byteLength(truncated, 'utf8');
    c.apply(truncated);
    modifications.push({
      kind: 'truncated',
      field: c.path,
      originalSizeBytes: c.currentBytes,
      truncatedToBytes: newBytes,
    });
    // Recompute global — the delta is approximate, a full recompute is
    // cheap relative to the LLM call.
    currentBytes = computeTotalBytes(systemPrompt, messages, toolDefinitions, response);
  }

  // Systempr prompt is last-resort: only truncated if we're still over
  // cap after all message / response candidates have been exhausted.
  if (currentBytes > effectiveCap) {
    const excess = currentBytes - effectiveCap;
    const originalBytes = Buffer.byteLength(systemPrompt, 'utf8');
    const targetBytes = Math.max(512, originalBytes - excess);
    if (targetBytes < originalBytes) {
      const truncated = truncateString(systemPrompt, targetBytes);
      systemPrompt = truncated;
      modifications.push({
        kind: 'truncated',
        field: 'systemPrompt',
        originalSizeBytes: originalBytes,
        truncatedToBytes: Buffer.byteLength(truncated, 'utf8'),
      });
      currentBytes = computeTotalBytes(systemPrompt, messages, toolDefinitions, response);
    }
  }

  return { systemPrompt, totalBytes: currentBytes };
}

// ---------------------------------------------------------------------------
// Public pipeline
// ---------------------------------------------------------------------------

/**
 * Build a persistable `agent_run_llm_payloads` row from the raw router
 * inputs. Pipeline order:
 *
 *   1. Redact (best-effort secret scrub via server/lib/redaction.ts).
 *   2. Apply tool-level payloadPersistencePolicy (spec §4.5).
 *   3. Greatest-first truncation to fit `maxBytes` with 128 B headroom.
 *
 * Returns fresh copies of every JSON field (no mutation of the inputs the
 * caller still wants to hand to the provider adapter).
 */
export function buildPayloadRow(input: BuildPayloadRowInput): BuildPayloadRowOutput {
  const patterns = input.patterns ?? DEFAULT_REDACTION_PATTERNS;

  // ── Step 1: redaction ──────────────────────────────────────────────────
  const redactedSystem = redactValue(input.systemPrompt, patterns);
  const redactedMessages = redactValue(input.messages, patterns);
  const redactedTools = redactValue(input.toolDefinitions, patterns);
  // Skip redaction on a null response — there is nothing to scrub. Partial
  // responses (non-null) are scrubbed identically to success-path responses
  // so secret leakage cannot ride a streaming-failure side-channel.
  const redactedResponse =
    input.response === null
      ? { value: null, redactions: [] as PayloadRedaction[] }
      : redactValue(input.response, patterns);

  // Prefix each redaction path with the root-field name it came from so
  // all paths read uniformly against the persisted row shape.
  const prefixedRedactions = (
    redactions: PayloadRedaction[],
    root: 'systemPrompt' | 'messages' | 'toolDefinitions' | 'response',
  ): PayloadRedaction[] =>
    redactions.map((r) => ({
      ...r,
      path: r.path.length === 0 ? root : `${root}.${r.path}`,
    }));

  const redactedFields: PayloadRedaction[] = [
    ...prefixedRedactions(redactedSystem.redactions, 'systemPrompt'),
    ...prefixedRedactions(redactedMessages.redactions, 'messages'),
    ...prefixedRedactions(redactedTools.redactions, 'toolDefinitions'),
    ...prefixedRedactions(redactedResponse.redactions, 'response'),
  ];

  const modifications: PayloadModification[] = [];

  // Deep-copy so the mutation in tool-policy + truncation doesn't touch
  // the caller's objects. JSON round-trip is fine — these are pure JSON.
  const messagesCopy = JSON.parse(JSON.stringify(redactedMessages.value)) as unknown[];
  const toolDefsCopy = JSON.parse(JSON.stringify(redactedTools.value)) as unknown[];
  const responseCopy: Record<string, unknown> | null =
    redactedResponse.value === null
      ? null
      : (JSON.parse(JSON.stringify(redactedResponse.value)) as Record<string, unknown>);
  let systemPromptCopy =
    typeof redactedSystem.value === 'string'
      ? redactedSystem.value
      : JSON.stringify(redactedSystem.value);

  // ── Step 2: tool policies ──────────────────────────────────────────────
  if (input.toolPolicies && Object.keys(input.toolPolicies).length > 0) {
    const { modifications: policyMods } = applyToolPolicies(messagesCopy, input.toolPolicies);
    modifications.push(...policyMods);
  }

  // ── Step 3: size-cap truncation ────────────────────────────────────────
  const truncated = truncateGreatestFirst(
    systemPromptCopy,
    messagesCopy,
    toolDefsCopy,
    responseCopy,
    input.maxBytes,
    modifications,
  );
  systemPromptCopy = truncated.systemPrompt;

  return {
    systemPrompt: systemPromptCopy,
    messages: messagesCopy,
    toolDefinitions: toolDefsCopy,
    response: responseCopy,
    redactedFields,
    modifications,
    totalSizeBytes: truncated.totalBytes,
  };
}
