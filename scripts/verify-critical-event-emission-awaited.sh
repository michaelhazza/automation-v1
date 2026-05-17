#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-critical-event-emission-awaited.sh  (PP-AE2)
#
# Enforces spec §5.1 critical-event invariant:
# Any call matching the critical-event set MUST be awaited, not void-cast.
#
# Critical-event set (flagged if invoked as `void <fn>(...)`):
#   1. insertExecutionEventSafe(...)
#      where payload literal contains `critical: true`
#      OR eventType matches:
#        ^tool\.error$ | ^run\.terminal$ | ^hierarchy\..+$ |
#        ^delegation\..+$ | ^run\.cancellation_requested$
#   2. insertOutcomeSafe(...)
#      where call literal contains outcome: 'rejected' or outcome: 'failed'
#   3. insertCriticalAuditEvent(...)
#      unconditional (function name reserved for await-mandated emissions)
#
# Conservative-flag mode:
#   If eventType or outcome value is interpolated (variable, not literal),
#   the call is conservatively flagged. Authors may suppress with:
#     // guard-ignore-await: <reason>
#   placed on the line IMMEDIATELY ABOVE the `void <fn>(` line.
#
# Out of scope:
#   Dynamic dispatch through a wrapper function. If the wrapper is awaited,
#   all call sites through that wrapper are covered. This gate only detects
#   direct `void` casts on the three named functions.
#
# Suppression:
#   Place the following on the line above the offending `void <fn>(` line:
#     // guard-ignore-await: <reason>
#
# Exit codes:
#   0 — no violations
#   1 — one or more violations (blocking)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GUARD_ID="critical-event-emission-awaited"

echo "[GUARD] Critical event emission awaited (PP-AE2)"

# Delegate pattern detection to Node — multiline call spans require reading
# each file as a whole rather than line-by-line grep.
RESULT=$(REPO_ROOT="$ROOT_DIR" node --input-type=module <<'NODEEOF'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.env.REPO_ROOT;

// Collect all .ts files under server/ (no test files)
function collectTs(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch (_) { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) {
      collectTs(full, acc);
    } else if (e.endsWith('.ts') && !e.endsWith('.test.ts') && !e.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectTs(join(root, 'server'));

// Critical eventType literals (regex patterns per spec §5.1)
const CRITICAL_EVENT_TYPE_RE = /^(tool\.error|run\.terminal|hierarchy\..+|delegation\..+|run\.cancellation_requested)$/;

const violations = [];

for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch (_) { continue; }

  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for `void <fn>(` pattern
    const voidMatch = line.match(/\bvoid\s+(insertExecutionEventSafe|insertOutcomeSafe|insertCriticalAuditEvent)\s*\(/);
    if (!voidMatch) continue;

    const fnName = voidMatch[1];
    const lineNo = i + 1;
    const relPath = relative(root, file).replace(/\\/g, '/');

    // Check for guard-ignore-await annotation on the previous line
    const prevLine = i > 0 ? lines[i - 1] : '';
    if (/\/\/\s*guard-ignore-await\s*:/.test(prevLine)) {
      continue;
    }

    // insertCriticalAuditEvent: flag unconditionally
    if (fnName === 'insertCriticalAuditEvent') {
      violations.push({ file: relPath, line: lineNo, fn: fnName, reason: 'insertCriticalAuditEvent is always await-mandated' });
      continue;
    }

    // Collect the argument span for this call.
    // Scan forward from the void fn( position, counting parens to find the
    // matching closing paren. Handles multiline calls up to 30 lines.
    let callText = '';
    let depth = 0;
    let started = false;
    const MAX_SCAN = Math.min(lines.length, i + 30);
    for (let j = i; j < MAX_SCAN; j++) {
      const scanLine = lines[j];
      for (const ch of scanLine) {
        if (ch === '(') { depth++; started = true; }
        if (ch === ')') { depth--; }
        callText += ch;
        if (started && depth === 0) break;
      }
      if (started && depth === 0) break;
      callText += '\n';
    }

    if (fnName === 'insertOutcomeSafe') {
      // Flag if outcome: 'rejected' or outcome: 'failed' is a literal in the call
      const literalOutcomeMatch = callText.match(/outcome\s*:\s*'(rejected|failed)'/);
      if (literalOutcomeMatch) {
        violations.push({ file: relPath, line: lineNo, fn: fnName, reason: `outcome: '${literalOutcomeMatch[1]}' is a critical outcome — must be awaited` });
        continue;
      }
      // Conservative: if outcome value appears to be interpolated / non-literal
      if (callText.includes('outcome:') || callText.includes('outcome :')) {
        const nonLiteralOutcome = callText.match(/outcome\s*:\s*(?!'(?:accepted|rejected|failed)')(\w+|`[^`]*`)/);
        if (nonLiteralOutcome) {
          violations.push({ file: relPath, line: lineNo, fn: fnName, reason: 'outcome value is non-literal — conservatively flagged; add // guard-ignore-await: <reason> if non-critical' });
          continue;
        }
      }
      // outcome is 'accepted' or absent — non-critical, skip
      continue;
    }

    if (fnName === 'insertExecutionEventSafe') {
      // Check for critical: true
      if (/critical\s*:\s*true/.test(callText)) {
        violations.push({ file: relPath, line: lineNo, fn: fnName, reason: 'critical: true payload — must be awaited' });
        continue;
      }

      // Check for literal eventType matching critical set
      const eventTypeMatch = callText.match(/eventType\s*:\s*'([^']+)'/);
      if (eventTypeMatch) {
        if (CRITICAL_EVENT_TYPE_RE.test(eventTypeMatch[1])) {
          violations.push({ file: relPath, line: lineNo, fn: fnName, reason: `eventType: '${eventTypeMatch[1]}' is a critical event type — must be awaited` });
          continue;
        }
        // Literal eventType, not in critical set — non-critical, skip
        continue;
      }

      // eventType is non-literal (interpolated) — conservatively flag
      if (callText.includes('eventType:') || callText.includes('eventType :')) {
        violations.push({ file: relPath, line: lineNo, fn: fnName, reason: 'eventType value is non-literal — conservatively flagged; add // guard-ignore-await: <reason> if non-critical' });
        continue;
      }
      // No eventType and no critical:true — skip
    }
  }
}

process.stdout.write(JSON.stringify(violations));
NODEEOF
)

VIOLATION_COUNT=$(VIOLATIONS_JSON="$RESULT" node --input-type=module <<'NODEEOF'
const arr = JSON.parse(process.env.VIOLATIONS_JSON);
process.stdout.write(String(arr.length));
NODEEOF
)

if [ "$VIOLATION_COUNT" -eq 0 ]; then
  echo ""
  echo "verify-critical-event-emission-awaited: PASS — no unawaited critical-event emissions found."
  echo "[GATE] ${GUARD_ID}: violations=0"
  exit 0
fi

# Emit violations
echo ""
echo "verify-critical-event-emission-awaited: BLOCKING FAIL"
echo ""
echo "The following critical-event emissions are void-cast (fire-and-forget) but"
echo "must be awaited. Critical-event durability invariant per spec §5.1:"
echo "  - insertExecutionEventSafe where critical:true or eventType is tool.error,"
echo "    run.terminal, hierarchy.*, delegation.*, run.cancellation_requested"
echo "  - insertOutcomeSafe where outcome is 'rejected' or 'failed'"
echo "  - insertCriticalAuditEvent (unconditional)"
echo ""
echo "Offending call sites:"

VIOLATIONS_JSON="$RESULT" node --input-type=module <<'NODEEOF'
const arr = JSON.parse(process.env.VIOLATIONS_JSON);
for (const v of arr) {
  process.stdout.write(`  ${v.file}:${v.line}: ${v.fn}() — ${v.reason}\n`);
}
NODEEOF

echo ""
echo "Remediation:"
echo "  1. Await the call: change 'void fn(...)' to 'await fn(...)'."
echo "  2. If the void-cast is intentional (e.g. wrapper is already awaited),"
echo "     add the annotation on the line ABOVE the void call:"
echo "       // guard-ignore-await: <reason>"
echo ""
echo "[GATE] ${GUARD_ID}: violations=${VIOLATION_COUNT}"
exit 1
