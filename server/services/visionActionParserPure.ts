/**
 * UI-TARS native action format parser.
 * Grammar source: spec §8.1 (browser-vision-grounding, 2026-05-18), pinned conceptually
 * against bytedance/UI-TARS HEAD@2026-05-18. The 9-verb table in the spec is authoritative;
 * upstream README mutations do NOT change the parser without a spec amendment.
 *
 * @throws (parseVisionAction) if the line is not a valid action.
 */

import type { VisionAction } from '../../shared/types/visionActions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a UI-TARS action line.
 *
 * Trims leading/trailing whitespace only — DO NOT collapse internal whitespace
 * runs. The `type` and `hotkey` verbs carry double-quoted user-visible text
 * that must round-trip byte-for-byte to Playwright (`type("hello  world")`
 * must produce `'hello  world'`, not `'hello world'`). Numeric verbs
 * (click/scroll/wait/...) tolerate extra inter-arg whitespace because
 * `splitArgs` + `parseNonNegInt/parseSignedInt` both `.trim()` per-arg
 * before parsing.
 */
function normalise(line: string): string {
  return line.trim();
}

/**
 * Parse a quoted string argument (double-quoted, backslash-escaped).
 * Returns the unescaped string content, or null if the value is not a
 * well-formed quoted string (missing opening quote, missing closing quote,
 * or contains an embedded newline).
 */
function parseQuotedString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.includes('\n') || inner.includes('\r')) return null;
  // Unescape standard backslash sequences.
  return inner.replace(/\\(["\\nrt])/g, (_, c: string) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}

/**
 * Parse `verb(argsRaw)` — returns [verb, argsRaw] or null for malformed input.
 * argsRaw is the raw content inside the outer parens (may be empty).
 */
function splitVerbArgs(line: string): [string, string] | null {
  const parenOpen = line.indexOf('(');
  if (parenOpen === -1) return null;
  if (!line.endsWith(')')) return null;
  const verb = line.slice(0, parenOpen).trim();
  const argsRaw = line.slice(parenOpen + 1, -1);
  return [verb, argsRaw];
}

/**
 * Split a comma-separated args string into individual argument strings.
 * Respects quoted strings (does not split on commas inside double-quotes).
 */
function splitArgs(argsRaw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let escaped = false;
  for (const ch of argsRaw) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inQuote) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (ch === ',' && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Parse a non-negative integer string. Returns the integer, or null if
 * the value is not a whole-number non-negative integer (rejects floats,
 * negative values, non-numeric strings).
 */
function parseNonNegInt(raw: string): number | null {
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * Parse a signed integer string. Returns the integer, or null if the
 * value is not a whole-number integer.
 */
function parseSignedInt(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?[0-9]+$/.test(t)) return null;
  return parseInt(t, 10);
}

// ---------------------------------------------------------------------------
// Core parse implementation — throws on invalid input.
// ---------------------------------------------------------------------------

function parseImpl(line: string): VisionAction {
  const norm = normalise(line);
  const parts = splitVerbArgs(norm);
  if (!parts) throw new Error(`malformed action: missing parens in '${norm}'`);
  const [verb, argsRaw] = parts;

  switch (verb) {
    case 'click':
    case 'double_click':
    case 'right_click': {
      const args = splitArgs(argsRaw);
      if (args.length !== 2) throw new Error(`${verb}: expected 2 args, got ${args.length}`);
      const x = parseNonNegInt(args[0]);
      const y = parseNonNegInt(args[1]);
      if (x === null) throw new Error(`${verb}: x must be a non-negative integer`);
      if (y === null) throw new Error(`${verb}: y must be a non-negative integer`);
      return { type: verb, x, y };
    }

    case 'type': {
      const argsStr = argsRaw.trim();
      const text = parseQuotedString(argsStr);
      if (text === null) throw new Error(`type: argument must be a double-quoted string`);
      return { type: 'type', text };
    }

    case 'scroll': {
      const args = splitArgs(argsRaw);
      if (args.length !== 2) throw new Error(`scroll: expected 2 args, got ${args.length}`);
      const dx = parseSignedInt(args[0]);
      const dy = parseSignedInt(args[1]);
      if (dx === null) throw new Error(`scroll: dx must be a signed integer`);
      if (dy === null) throw new Error(`scroll: dy must be a signed integer`);
      return { type: 'scroll', dx, dy };
    }

    case 'hotkey': {
      const argsStr = argsRaw.trim();
      const combo = parseQuotedString(argsStr);
      if (combo === null) throw new Error(`hotkey: argument must be a double-quoted string`);
      if (!combo.length) throw new Error(`hotkey: combo must not be empty`);
      // Validate combo format: one or more "+" joined tokens, each non-empty.
      const tokens = combo.split('+');
      if (tokens.some((t) => t.trim() === ''))
        throw new Error(`hotkey: malformed combo '${combo}'`);
      return { type: 'hotkey', combo };
    }

    case 'wait': {
      const ms = parseNonNegInt(argsRaw);
      if (ms === null) throw new Error(`wait: ms must be a non-negative integer`);
      if (ms <= 0) throw new Error(`wait: ms must be a positive integer`);
      return { type: 'wait', ms };
    }

    case 'screenshot': {
      if (argsRaw.trim() !== '') throw new Error(`screenshot: expected no args`);
      return { type: 'screenshot' };
    }

    case 'done': {
      if (argsRaw.trim() !== '') throw new Error(`done: expected no args`);
      return { type: 'done' };
    }

    default:
      throw new Error(`unknown verb: ${verb}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse one UI-TARS native action text line into a typed VisionAction.
 *
 * Trims leading/trailing whitespace; internal whitespace inside quoted args
 * (`type("hello  world")`) is preserved byte-for-byte.
 *
 * @throws if the line is not a valid action.
 */
export function parseVisionAction(line: string): VisionAction {
  return parseImpl(line);
}

/**
 * Non-throwing variant. Returns null for any invalid input; the caller (harness)
 * decides whether to treat null as a soft retry or a hard failure.
 */
export function tryParseVisionAction(line: string): VisionAction | null {
  try {
    return parseImpl(line);
  } catch {
    return null;
  }
}
