/**
 * Workflow templating service — secure dot-path resolver.
 *
 * Spec: tasks/workflows-spec.md §3.3 (templating expressions) and §11.1
 * (mandatory prototype-pollution test suite).
 *
 * Resolves `{{ ... }}` expressions against a run context. Hand-rolled to
 * keep the surface area tiny and to make the security model auditable.
 *
 * SECURITY MODEL — non-negotiable
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Whitelist top-level prefixes only:
 *      run.input.*           — initial input provided at run start
 *      run.subaccount.*      — subaccount metadata (whitelisted fields)
 *      run.org.*             — org metadata (whitelisted fields)
 *      steps.<id>.output.*   — output of a completed step
 *
 *    Anything else (`run.foo`, `_meta.x`, `process.env.FOO`, ...) is
 *    rejected at parse time, not at resolve time.
 *
 * 2. Blocklisted path segments — any expression containing one of these
 *    segments is rejected at parse time:
 *      __proto__, constructor, prototype
 *
 * 3. The resolver builds its working context object via `Object.create(null)`
 *    so it has no prototype chain at all. Even a path that bypasses the
 *    blocklist somehow cannot reach Object.prototype.
 *
 * 4. Path traversal uses `hasOwn()` at every step — never bare
 *    `key in obj` or `obj[key]` without ownership check.
 *
 * 5. Array index access is supported via `[N]` notation:
 *      steps.research.output.findings[0].title
 *
 * 6. No arbitrary code evaluation. No `eval`, no `new Function`, no
 *    template engines that compile to JS. Just deterministic path lookup.
 *
 * Phase 1.5 may add JSONata via a `{{= ... }}` prefix as an opt-in
 * power-user expression engine. Phase 1 is path-lookup only.
 */

import type { RunContext, TemplateReference } from './types.js';

const EXPRESSION_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * ES2020-safe ownership check (Object.hasOwn requires ES2022). Used by the
 * resolver at every traversal step — never use bare `in` or `obj[key]`.
 */
function hasOwn(obj: object, key: string | symbol): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
const ALLOWED_PREFIXES = ['run.input', 'run.subaccount', 'run.org', 'steps'] as const;
const BLOCKED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const SUBACCOUNT_FIELDS = new Set(['id', 'name', 'timezone', 'slug']);
const ORG_FIELDS = new Set(['id', 'name']);

export class TemplatingError extends Error {
  readonly _tag = 'TemplatingError' as const;
  constructor(
    message: string,
    readonly expression: string,
    readonly reason:
      | 'unknown_namespace'
      | 'blocked_segment'
      | 'invalid_path'
      | 'missing_path'
      | 'whitelist_violation'
  ) {
    super(message);
  }
}

// ─── Expression parsing ──────────────────────────────────────────────────────

interface ParsedPath {
  /** Top-level namespace, e.g. 'run.input' or 'steps' */
  namespace: typeof ALLOWED_PREFIXES[number];
  /** For namespace='steps' only — the step id immediately after `steps.` */
  stepId?: string;
  /** Remaining segments after the namespace (and stepId.output for steps). */
  segments: PathSegment[];
}

interface PathSegment {
  kind: 'key' | 'index';
  key?: string;
  index?: number;
}

/**
 * Tokenises a single dot-path expression like:
 *   steps.research.output.findings[0].title
 *
 * Throws TemplatingError on:
 *   - blocklisted segments
 *   - unknown top-level namespace
 *   - whitelist violations on subaccount / org fields
 */
function parsePath(raw: string): ParsedPath {
  const expression = raw.trim();

  // Tokenise: split on '.' but respect bracket array indices.
  const tokens: PathSegment[] = [];
  let i = 0;
  let buf = '';

  const flushBuf = () => {
    if (buf.length === 0) return;
    if (BLOCKED_SEGMENTS.has(buf)) {
      throw new TemplatingError(
        `blocked path segment '${buf}' in expression`,
        expression,
        'blocked_segment'
      );
    }
    tokens.push({ kind: 'key', key: buf });
    buf = '';
  };

  while (i < expression.length) {
    const ch = expression[i];
    if (ch === '.') {
      flushBuf();
      i++;
    } else if (ch === '[') {
      flushBuf();
      const closeIdx = expression.indexOf(']', i);
      if (closeIdx === -1) {
        throw new TemplatingError(
          `unterminated array index in expression`,
          expression,
          'invalid_path'
        );
      }
      const inner = expression.slice(i + 1, closeIdx);
      const idx = Number.parseInt(inner, 10);
      if (!Number.isInteger(idx) || idx < 0 || String(idx) !== inner) {
        throw new TemplatingError(
          `invalid array index '${inner}' (must be non-negative integer)`,
          expression,
          'invalid_path'
        );
      }
      tokens.push({ kind: 'index', index: idx });
      i = closeIdx + 1;
    } else {
      buf += ch;
      i++;
    }
  }
  flushBuf();

  if (tokens.length === 0) {
    throw new TemplatingError('empty expression', expression, 'invalid_path');
  }

  // Identify the top-level namespace.
  // 'steps' is a single token. 'run.input' / 'run.subaccount' / 'run.org' are two.
  let namespace: ParsedPath['namespace'];
  let stepId: string | undefined;
  let cursor: number;

  if (tokens[0]?.kind === 'key' && tokens[0].key === 'steps') {
    namespace = 'steps';
    if (tokens.length < 2 || tokens[1]?.kind !== 'key' || !tokens[1].key) {
      throw new TemplatingError(
        `steps reference must include a step id`,
        expression,
        'invalid_path'
      );
    }
    stepId = tokens[1].key;
    cursor = 2;
    // Next token must be 'output' — we don't allow direct access to other
    // step run fields like attempt or status.
    if (
      tokens[cursor]?.kind !== 'key' ||
      tokens[cursor]?.key !== 'output'
    ) {
      throw new TemplatingError(
        `steps.<id> must be followed by .output (got '${tokens[cursor]?.key ?? '<end>'}')`,
        expression,
        'whitelist_violation'
      );
    }
    cursor++;
  } else if (tokens[0]?.kind === 'key' && tokens[0].key === 'run') {
    if (
      tokens[1]?.kind !== 'key' ||
      !tokens[1].key ||
      !['input', 'subaccount', 'org'].includes(tokens[1].key)
    ) {
      throw new TemplatingError(
        `run.<namespace> must be one of input | subaccount | org (got '${tokens[1]?.key ?? '<end>'}')`,
        expression,
        'unknown_namespace'
      );
    }
    namespace = `run.${tokens[1].key}` as ParsedPath['namespace'];
    cursor = 2;

    // Whitelist subaccount / org fields at the FIRST segment after namespace.
    if (namespace === 'run.subaccount') {
      const next = tokens[cursor];
      if (next && next.kind === 'key' && next.key && !SUBACCOUNT_FIELDS.has(next.key)) {
        throw new TemplatingError(
          `run.subaccount.${next.key} not in whitelist (allowed: ${[...SUBACCOUNT_FIELDS].join(', ')})`,
          expression,
          'whitelist_violation'
        );
      }
    } else if (namespace === 'run.org') {
      const next = tokens[cursor];
      if (next && next.kind === 'key' && next.key && !ORG_FIELDS.has(next.key)) {
        throw new TemplatingError(
          `run.org.${next.key} not in whitelist (allowed: ${[...ORG_FIELDS].join(', ')})`,
          expression,
          'whitelist_violation'
        );
      }
    }
  } else {
    throw new TemplatingError(
      `unknown top-level namespace '${tokens[0]?.key ?? '<empty>'}' (allowed: ${ALLOWED_PREFIXES.join(', ')})`,
      expression,
      'unknown_namespace'
    );
  }

  return {
    namespace,
    stepId,
    segments: tokens.slice(cursor),
  };
}

// ─── Context construction (prototype-pollution safe) ─────────────────────────

/**
 * Builds a fresh context object with NO prototype chain. Even if a path
 * somehow bypasses the blocklist, it cannot reach Object.prototype.
 *
 * The shape mirrors RunContext but uses null-prototype objects all the way
 * down for the namespace roots that templating actually traverses.
 */
function buildSafeContext(ctx: RunContext): Record<string, unknown> {
  const safe = Object.create(null) as Record<string, unknown>;
  const run = Object.create(null) as Record<string, unknown>;
  run.input = deepFreezeNullProto(ctx.input ?? {});
  run.subaccount = deepFreezeNullProto(ctx.subaccount ?? {});
  run.org = deepFreezeNullProto(ctx.org ?? {});
  safe.run = run;
  // steps is keyed by step id; each value carries an `output`.
  const steps = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(ctx.steps ?? {})) {
    if (BLOCKED_SEGMENTS.has(k)) continue; // defence — should never happen
    const stepEntry = Object.create(null) as Record<string, unknown>;
    stepEntry.output = deepFreezeNullProto((v as { output?: unknown })?.output);
    steps[k] = stepEntry;
  }
  safe.steps = steps;
  return safe;
}

function deepFreezeNullProto(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((v) => deepFreezeNullProto(v)));
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (BLOCKED_SEGMENTS.has(k)) continue;
    out[k] = deepFreezeNullProto((value as Record<string, unknown>)[k]);
  }
  return Object.freeze(out);
}

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolves a single dot-path expression (without the surrounding `{{ }}`)
 * against the given run context. Throws TemplatingError if the path can't
 * be resolved or if any security rule is violated.
 */
export function resolve(expression: string, ctx: RunContext): unknown {
  const parsed = parsePath(expression);
  const safe = buildSafeContext(ctx);

  // Walk to the namespace root.
  let current: unknown;
  if (parsed.namespace === 'steps') {
    const steps = (safe.steps as Record<string, unknown>) ?? {};
    if (!hasOwn(steps, parsed.stepId!)) {
      throw new TemplatingError(
        `step '${parsed.stepId}' has no recorded output yet`,
        expression,
        'missing_path'
      );
    }
    const stepEntry = steps[parsed.stepId!] as Record<string, unknown>;
    if (!hasOwn(stepEntry, 'output')) {
      throw new TemplatingError(
        `step '${parsed.stepId}' output is not yet present`,
        expression,
        'missing_path'
      );
    }
    current = stepEntry.output;
  } else {
    // run.input | run.subaccount | run.org
    const run = (safe.run as Record<string, unknown>) ?? {};
    const sub = parsed.namespace.split('.')[1]!;
    if (!hasOwn(run, sub)) {
      throw new TemplatingError(
        `run.${sub} is not present in context`,
        expression,
        'missing_path'
      );
    }
    current = run[sub];
  }

  // Walk the remaining segments.
  for (const seg of parsed.segments) {
    if (current === null || current === undefined) {
      throw new TemplatingError(
        `cannot traverse '${seg.kind === 'key' ? seg.key : `[${seg.index}]`}' on null/undefined`,
        expression,
        'missing_path'
      );
    }
    if (seg.kind === 'key') {
      if (typeof current !== 'object' || Array.isArray(current)) {
        throw new TemplatingError(
          `cannot use key '${seg.key}' on non-object`,
          expression,
          'invalid_path'
        );
      }
      const obj = current as Record<string, unknown>;
      if (!hasOwn(obj, seg.key!)) {
        throw new TemplatingError(
          `path segment '${seg.key}' not found`,
          expression,
          'missing_path'
        );
      }
      current = obj[seg.key!];
    } else {
      if (!Array.isArray(current)) {
        throw new TemplatingError(
          `cannot use array index [${seg.index}] on non-array`,
          expression,
          'invalid_path'
        );
      }
      if (seg.index! >= current.length) {
        throw new TemplatingError(
          `array index [${seg.index}] out of bounds (length ${current.length})`,
          expression,
          'missing_path'
        );
      }
      current = current[seg.index!];
    }
  }

  return current;
}

/**
 * Resolves all `{{ ... }}` expressions inside a string template, returning
 * the rendered string. Each expression is resolved via `resolve()` and the
 * result is stringified (objects via JSON.stringify, primitives raw).
 */
export function renderString(template: string, ctx: RunContext): string {
  return template.replace(EXPRESSION_RE, (_match, raw: string) => {
    const value = resolve(raw, ctx);
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Resolves a record of `paramName -> templateExpression` against the run
 * context. Used by the engine to prepare `agentInputs` before dispatch.
 *
 * Each value is treated as a string template (so `{{ ... }}` expressions
 * are resolved and rendered). If the entire value is a single expression,
 * the resolved native value (object/array/number/etc) is returned instead
 * of the rendered string — this preserves type information for downstream
 * consumers.
 */
export function resolveInputs(
  inputs: Record<string, string>,
  ctx: RunContext
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    out[k] = resolveValue(v, ctx);
  }
  return out;
}

function resolveValue(template: string, ctx: RunContext): unknown {
  // Detect "single expression" pattern: the entire string is one expression.
  const trimmed = template.trim();
  const singleMatch = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (singleMatch) {
    return resolve(singleMatch[1], ctx);
  }
  return renderString(template, ctx);
}

// ─── Reference extraction (validator support) ────────────────────────────────

/**
 * Extracts every `{{ ... }}` reference inside a string. Used by the
 * validator (§4.4) to enforce that step expressions only reference declared
 * dependencies. Returns one TemplateReference per expression.
 */
export function extractReferences(template: string): TemplateReference[] {
  const refs: TemplateReference[] = [];
  for (const match of template.matchAll(EXPRESSION_RE)) {
    const raw = match[1].trim();
    const parsed = parsePath(raw); // throws on blocked / invalid
    refs.push({
      raw,
      namespace: parsed.namespace,
      stepId: parsed.stepId,
      path: parsed.segments
        .filter((s) => s.kind === 'key')
        .map((s) => s.key!),
    });
  }
  return refs;
}
