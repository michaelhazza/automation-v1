/**
 * verify-action-registry-zod.ts
 *
 * Runtime-loading harness for the action-registry-zod CI gate.
 * Replaces the awk text-counting body in verify-action-registry-zod.sh.
 *
 * For every ACTION_REGISTRY entry, asserts that parameterSchema is an instance
 * of z.ZodObject. Exits 1 with a list of violating slugs if any fail.
 *
 * Loads ACTION_REGISTRY directly from source via tsx (no `npm run build:server`
 * required). Mirrors the pattern in verify-risk-tier-assigned.ts.
 *
 * Exit codes:
 *   0 — all entries have a ZodObject parameterSchema.
 *   1 — one or more entries violate the invariant.
 */

import { z } from 'zod';
import { ACTION_REGISTRY } from '../server/config/actionRegistry.js';

const violators: Array<{ slug: string; reason: string }> = [];

for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
  if (!(def.parameterSchema instanceof z.ZodObject)) {
    const reason = def.parameterSchema === undefined
      ? 'missing parameterSchema'
      : `parameterSchema is not a ZodObject (got ${(def.parameterSchema as { constructor?: { name?: string } } | undefined)?.constructor?.name ?? typeof def.parameterSchema})`;
    violators.push({ slug, reason });
  }
}

if (violators.length === 0) {
  console.log(
    `[verify-action-registry-zod] PASS — all ${Object.keys(ACTION_REGISTRY).length} entries have parameterSchema: z.object({...}).`,
  );
  process.exit(0);
}

process.stderr.write(
  `[verify-action-registry-zod] FAIL — ${violators.length} entries use a non-Zod parameterSchema:\n` +
  violators.map(v => `  - ${v.slug}: ${v.reason}`).join('\n') + '\n' +
  '\nConvert to z.object({...}). See P0.2 Slice A in docs/improvements-roadmap-spec.md.\n',
);
process.exit(1);
