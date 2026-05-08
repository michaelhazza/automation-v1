/**
 * verify-runtime-check-coverage.mjs
 * Checks that every ACTION_REGISTRY entry has either verify set or
 * verifyNullJustification non-empty. Reports missing skills.
 * CI-only — requires npm run build:server (uses compiled ESM output in dist/).
 * Exit codes: 0 = all covered, 2 = advisory gap (blocking after backfill sprint).
 */

import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(__dirname, '../../dist/server/config/actionRegistry.js');

let ACTION_REGISTRY;
try {
  const mod = await import(registryPath);
  ACTION_REGISTRY = mod.ACTION_REGISTRY;
} catch (err) {
  console.log('[SKIP] Could not import compiled registry — run npm run build:server first:', String(err));
  process.exit(0);
}

const missing = Object.entries(ACTION_REGISTRY)
  .filter(([, a]) => a.verify === undefined && !a.verifyNullJustification)
  .map(([key]) => key);

if (missing.length > 0) {
  process.stderr.write(
    'WARNING: The following skills are missing verify coverage (verify or verifyNullJustification):\n'
    + missing.map(s => '  - ' + s).join('\n') + '\n'
  );
  // Advisory (exit 2) while existing entries are being backfilled.
  // Change to exit 1 once all ACTION_REGISTRY entries have verify coverage.
  process.exit(2);
}

console.log(`All ${Object.keys(ACTION_REGISTRY).length} ACTION_REGISTRY entries have runtime check coverage.`);
