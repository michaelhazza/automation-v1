#!/usr/bin/env bash
# verify-runtime-check-coverage.sh
# Checks that every ACTION_REGISTRY entry has either verify set or verifyNullJustification non-empty.
# Fails the build with a list of missing skills.
# CI-only — do not run locally.
set -euo pipefail

# Parse ACTION_REGISTRY from the compiled output using Node.
# Requires the project to be built (server compiled) before running.
node -e "
const { ACTION_REGISTRY } = require('./dist/server/config/actionRegistry.js');
const missing = ACTION_REGISTRY.filter(a => !a.verify && !a.verifyNullJustification);
if (missing.length > 0) {
  console.error('ERROR: The following skills are missing runtime check coverage:');
  missing.forEach(a => console.error('  -', a.slug));
  process.exit(1);
}
console.log('All skills have runtime check coverage.');
"
