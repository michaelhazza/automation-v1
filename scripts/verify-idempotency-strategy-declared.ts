/**
 * verify-idempotency-strategy-declared.ts
 *
 * Runtime-loading harness for the idempotency-strategy-declared CI gate.
 * Replaces the awk text-counting body in verify-idempotency-strategy-declared.sh.
 *
 * For every ACTION_REGISTRY entry, asserts that idempotencyStrategy is one of
 * the four valid values: read_only | keyed_write | locked | state_based.
 * Exits 1 with a list of violating slugs if any fail.
 *
 * Loads ACTION_REGISTRY directly from source via tsx (no `npm run build:server`
 * required). Mirrors the pattern in verify-risk-tier-assigned.ts.
 *
 * Exit codes:
 *   0 — all entries declare a valid idempotencyStrategy.
 *   1 — one or more entries violate the invariant.
 */

import { ACTION_REGISTRY } from '../server/config/actionRegistry.js';

const VALID_STRATEGIES = new Set(['read_only', 'keyed_write', 'locked', 'state_based']);

const violators: Array<{ slug: string; reason: string }> = [];

for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
  const strategy = def.idempotencyStrategy;
  if (strategy === undefined || strategy === null) {
    violators.push({ slug, reason: 'missing idempotencyStrategy' });
  } else if (!VALID_STRATEGIES.has(strategy as string)) {
    violators.push({ slug, reason: `invalid idempotencyStrategy: '${String(strategy)}'` });
  }
}

if (violators.length === 0) {
  console.log(
    `[verify-idempotency-strategy-declared] PASS — all ${Object.keys(ACTION_REGISTRY).length} entries declare a valid idempotencyStrategy.`,
  );
  process.exit(0);
}

process.stderr.write(
  `[verify-idempotency-strategy-declared] FAIL — ${violators.length} entries missing or invalid idempotencyStrategy:\n` +
  violators.map(v => `  - ${v.slug}: ${v.reason}`).join('\n') + '\n' +
  "\nAdd idempotencyStrategy: 'read_only' | 'keyed_write' | 'locked' | 'state_based' to every ACTION_REGISTRY entry.\n" +
  'See docs/improvements-roadmap-spec.md → Execution Model section for the contract.\n',
);
process.exit(1);
