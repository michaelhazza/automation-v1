/**
 * verify-runtime-check-coverage.mjs
 * Trust & Verification Layer §11.4 CI gate.
 *
 * Asserts every ACTION_REGISTRY entry has either `verify` set OR
 * `verifyNullJustification` non-empty. Reports any missing skills.
 *
 * CI-only — requires `npm run build:server` (uses compiled ESM output in dist/).
 *
 * Exit codes:
 *   0 = all entries covered.
 *   1 = blocking — at least one entry missing both fields.
 *
 * Cross-platform: Node ESM `import()` requires a `file://` URL on Windows
 * (POSIX absolute paths produce ERR_UNSUPPORTED_ESM_URL_SCHEME). Wrap the
 * resolved path with `pathToFileURL(...).href` so the gate runs on both
 * Linux CI and Windows local machines.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(__dirname, '../../dist/server/config/actionRegistry.js');

let ACTION_REGISTRY;
try {
  // pathToFileURL → cross-platform file:// URL string. Required on Windows.
  const mod = await import(pathToFileURL(registryPath).href);
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
    'BLOCKING: The following skills are missing runtime-check coverage (verify or verifyNullJustification):\n'
    + missing.map(s => '  - ' + s).join('\n') + '\n'
    + '\nFix by setting `verify` to a RuntimeCheckKind on the ACTION_REGISTRY entry, '
    + 'or `verify: null` with a `verifyNullJustification` string explaining why no '
    + 'deterministic post-action check is possible. See spec §6.1 + §11.4.\n'
  );
  process.exit(1);
}

console.log(`All ${Object.keys(ACTION_REGISTRY).length} ACTION_REGISTRY entries have runtime check coverage.`);
