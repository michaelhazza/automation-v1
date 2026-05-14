/**
 * CI harness: verify that every ACTION_REGISTRY entry has a `riskTier` field.
 *
 * Spec: synthetos-foundation-refactor §4.2.5, §4.2.7, §9.1
 *
 * Exit 0 — all entries have riskTier assigned.
 * Exit 1 — one or more entries are missing riskTier; list printed to stderr.
 */

import { ACTION_REGISTRY } from '../server/config/actionRegistry.js';
import { RISK_TIERS } from '../shared/types/riskTier.js';

const validTiers = new Set<number>(RISK_TIERS);

const missing: string[] = [];

for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
  if (!('riskTier' in def) || def.riskTier === undefined || def.riskTier === null) {
    missing.push(slug);
    continue;
  }
  if (!validTiers.has(def.riskTier as number)) {
    missing.push(`${slug} (invalid tier: ${def.riskTier as unknown})`);
  }
}

if (missing.length === 0) {
  console.log(`[verify-risk-tier-assigned] PASS — all ${Object.keys(ACTION_REGISTRY).length} entries have a valid riskTier.`);
  process.exit(0);
} else {
  console.error(`[verify-risk-tier-assigned] FAIL — ${missing.length} entries missing or invalid riskTier:`);
  for (const slug of missing) {
    console.error(`  - ${slug}`);
  }
  process.exit(1);
}
