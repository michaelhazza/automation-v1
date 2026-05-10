/**
 * verify-skill-read-paths.ts
 *
 * Runtime-loading harness for the skill-read-paths CI gate.
 * Replaces the awk/grep text-counting body in verify-skill-read-paths.sh.
 * Removes the calibration constant that was misaligned by 9 entries after
 * the support-desk-canonical merge (see plan §4.5).
 *
 * For every ACTION_REGISTRY entry:
 *   - asserts readPath is one of: canonical | liveFetch | none
 *   - if readPath is 'liveFetch', asserts liveFetchRationale is a non-empty string
 *
 * Exits 1 with a list of violating slugs if any fail.
 *
 * Loads ACTION_REGISTRY directly from source via tsx (no `npm run build:server`
 * required). Mirrors the pattern in verify-risk-tier-assigned.ts.
 *
 * Exit codes:
 *   0 — all entries have a valid readPath (and liveFetchRationale where required).
 *   1 — one or more entries violate the invariant.
 */

import { ACTION_REGISTRY } from '../server/config/actionRegistry.js';

const VALID_READ_PATHS = new Set(['canonical', 'liveFetch', 'none']);

const violators: Array<{ slug: string; reason: string }> = [];

for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
  const readPath = def.readPath;
  if (readPath === undefined || readPath === null) {
    violators.push({ slug, reason: 'missing readPath' });
    continue;
  }
  if (!VALID_READ_PATHS.has(readPath as string)) {
    violators.push({ slug, reason: `invalid readPath: '${String(readPath)}'` });
    continue;
  }
  if (readPath === 'liveFetch') {
    const rationale = def.liveFetchRationale;
    if (!rationale || typeof rationale !== 'string' || rationale.trim() === '') {
      violators.push({ slug, reason: "readPath is 'liveFetch' but liveFetchRationale is missing or empty" });
    }
  }
}

const totalEntries = Object.keys(ACTION_REGISTRY).length;
const liveFetchCount = Object.values(ACTION_REGISTRY).filter(d => d.readPath === 'liveFetch').length;

if (violators.length === 0) {
  console.log(
    `[verify-skill-read-paths] PASS — all ${totalEntries} entries tagged with readPath, ${liveFetchCount} liveFetch with rationale.`,
  );
  process.exit(0);
}

process.stderr.write(
  `[verify-skill-read-paths] FAIL — ${violators.length} entries missing or invalid readPath / liveFetchRationale:\n` +
  violators.map(v => `  - ${v.slug}: ${v.reason}`).join('\n') + '\n' +
  "\nEvery ACTION_REGISTRY entry must have readPath: 'canonical' | 'liveFetch' | 'none'.\n" +
  "liveFetch entries must also have a non-empty liveFetchRationale string.\n",
);
process.exit(1);
