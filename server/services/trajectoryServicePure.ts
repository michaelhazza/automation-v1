/**
 * trajectoryServicePure.ts — pure helpers for trajectory comparison.
 *
 * Sprint 4 P3.3: structural trajectory comparison. All functions here are
 * pure (no DB, no IO). The impure counterpart `trajectoryService.ts`
 * handles DB reads.
 *
 * Per P0.1 Layer 3 pure-helper convention: every function is
 * referentially transparent, testable without any runtime services.
 */

import type {
  ReferenceTrajectory,
  TrajectoryEvent,
  TrajectoryDiff,
  DiffEntry,
  ExpectedAction,
  ArgMatchers,
} from '../../shared/iee/trajectorySchema.js';

// ── Arg matcher helpers ─────────────────────────────────────────────────────

/**
 * Partial-equality check: every key in `matchers` must match the
 * corresponding key in `actual`. Extra keys in `actual` are ignored.
 */
export function matchArgs(
  actual: Record<string, unknown> | undefined,
  matchers: ArgMatchers | undefined
): boolean {
  if (!matchers) return true;
  if (!actual) return false;
  for (const [key, expected] of Object.entries(matchers)) {
    if (actual[key] !== expected) return false;
  }
  return true;
}

/**
 * Checks whether a single actual event matches an expected action
 * (type match + arg matchers).
 */
function eventMatchesExpected(
  actual: TrajectoryEvent,
  expected: ExpectedAction
): boolean {
  if (actual.actionType !== expected.actionType) return false;
  return matchArgs(actual.args, expected.argMatchers);
}

// ── Comparison engine ───────────────────────────────────────────────────────

/**
 * Compare an actual trajectory against a reference using the specified
 * match mode. Returns a structured diff.
 */
export function compare(
  actual: readonly TrajectoryEvent[],
  reference: ReferenceTrajectory
): TrajectoryDiff {
  switch (reference.matchMode) {
    case 'exact':
      return compareExact(actual, reference);
    case 'in-order':
      return compareInOrder(actual, reference);
    case 'any-order':
      return compareAnyOrder(actual, reference);
    case 'single-tool':
      return compareSingleTool(actual, reference);
    default:
      return {
        name: reference.name,
        matchMode: reference.matchMode,
        pass: false,
        entries: [],
      };
  }
}

function compareExact(
  actual: readonly TrajectoryEvent[],
  reference: ReferenceTrajectory
): TrajectoryDiff {
  const entries: DiffEntry[] = [];
  const { expected } = reference;
  let pass = true;

  // Exact: actual must have same length and same sequence
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const act = actual[i];
    if (!act) {
      entries.push({ index: i, expected: exp, status: 'missing' });
      pass = false;
    } else if (!eventMatchesExpected(act, exp)) {
      const isTypeMatch = act.actionType === exp.actionType;
      entries.push({
        index: i,
        expected: exp,
        status: isTypeMatch ? 'arg_mismatch' : 'missing',
        actual: act,
        details: isTypeMatch
          ? `Args differ at position ${i}`
          : `Expected ${exp.actionType}, got ${act.actionType}`,
      });
      pass = false;
    } else {
      entries.push({ index: i, expected: exp, status: 'match', actual: act });
    }
  }

  // Extra actions beyond expected
  const extraActions = actual.slice(expected.length) as TrajectoryEvent[];
  if (extraActions.length > 0) pass = false;

  return {
    name: reference.name,
    matchMode: reference.matchMode,
    pass,
    entries,
    extraActions: extraActions.length > 0 ? extraActions : undefined,
  };
}

function compareInOrder(
  actual: readonly TrajectoryEvent[],
  reference: ReferenceTrajectory
): TrajectoryDiff {
  const entries: DiffEntry[] = [];
  const { expected } = reference;
  let pass = true;
  let actualIdx = 0;

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    let found = false;

    while (actualIdx < actual.length) {
      if (eventMatchesExpected(actual[actualIdx], exp)) {
        entries.push({
          index: i,
          expected: exp,
          status: 'match',
          actual: actual[actualIdx],
        });
        actualIdx++;
        found = true;
        break;
      }
      actualIdx++;
    }

    if (!found) {
      entries.push({ index: i, expected: exp, status: 'missing' });
      pass = false;
    }
  }

  return {
    name: reference.name,
    matchMode: reference.matchMode,
    pass,
    entries,
  };
}

function compareAnyOrder(
  actual: readonly TrajectoryEvent[],
  reference: ReferenceTrajectory
): TrajectoryDiff {
  const entries: DiffEntry[] = [];
  const { expected } = reference;
  let pass = true;
  const used = new Set<number>();

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    let found = false;

    for (let j = 0; j < actual.length; j++) {
      if (used.has(j)) continue;
      if (eventMatchesExpected(actual[j], exp)) {
        entries.push({
          index: i,
          expected: exp,
          status: 'match',
          actual: actual[j],
        });
        used.add(j);
        found = true;
        break;
      }
    }

    if (!found) {
      entries.push({ index: i, expected: exp, status: 'missing' });
      pass = false;
    }
  }

  return {
    name: reference.name,
    matchMode: reference.matchMode,
    pass,
    entries,
  };
}

function compareSingleTool(
  actual: readonly TrajectoryEvent[],
  reference: ReferenceTrajectory
): TrajectoryDiff {
  const entries: DiffEntry[] = [];
  const { expected } = reference;
  let pass = true;

  // single-tool: each expected action must appear at least once
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const found = actual.some((act) => eventMatchesExpected(act, exp));
    if (found) {
      entries.push({ index: i, expected: exp, status: 'match' });
    } else {
      entries.push({ index: i, expected: exp, status: 'missing' });
      pass = false;
    }
  }

  return {
    name: reference.name,
    matchMode: reference.matchMode,
    pass,
    entries,
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Pretty-print a trajectory diff for CI output.
 */
export function formatDiff(diff: TrajectoryDiff): string {
  const lines: string[] = [];
  const icon = diff.pass ? 'PASS' : 'FAIL';
  lines.push(`[${icon}] ${diff.name} (mode: ${diff.matchMode})`);

  for (const entry of diff.entries) {
    const marker = entry.status === 'match' ? '  [ok]' : '  [!!]';
    let line = `${marker} ${entry.expected.actionType}`;
    if (entry.status === 'missing') {
      line += ' -- MISSING from actual trajectory';
    } else if (entry.status === 'arg_mismatch') {
      line += ` -- ${entry.details ?? 'arg mismatch'}`;
    } else if (entry.status === 'wrong_order') {
      line += ' -- found but out of order';
    }
    lines.push(line);
  }

  if (diff.extraActions && diff.extraActions.length > 0) {
    lines.push(`  Extra actions (${diff.extraActions.length}):`);
    for (const extra of diff.extraActions) {
      lines.push(`    - ${extra.actionType}`);
    }
  }

  return lines.join('\n');
}
