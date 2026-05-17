#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-critical-path-coverage.sh  (PP-MC2)
#
# Validates tasks/critical-paths-manifest.yml against the spec §11.4 schema.
#
# Six checks per entry (per spec §11.4):
#   1. Top-level version is present and equals 1.
#   2. Every entry has id (kebab-case, unique), description (non-empty),
#      surface (enumerated), coverage, and last_verified (YYYY-MM-DD).
#   3. Every coverage declares exactly one of: test_path, gate_path,
#      or wont_test_rationale.
#   4. Every test_path resolves to an existing file.
#   5. Every gate_path resolves to an existing file AND matches
#      scripts/verify-*.sh or scripts/gates/*.sh.
#   6. Every last_verified is within the last 180 days.
#
# Exit codes:
#   0 — all checks pass
#   1 — one or more checks fail (blocking)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GUARD_ID="critical-path-coverage"
MANIFEST_FILE="$ROOT_DIR/tasks/critical-paths-manifest.yml"

echo "[GUARD] Critical path coverage manifest (PP-MC2)"

# Check manifest file exists
if [ ! -f "$MANIFEST_FILE" ]; then
  echo ""
  echo "verify-critical-path-coverage: BLOCKING FAIL"
  echo ""
  echo "Manifest file not found: tasks/critical-paths-manifest.yml"
  echo "Create the manifest per the spec §11.4 schema."
  echo "[GATE] ${GUARD_ID}: violations=1"
  exit 1
fi

# Delegate YAML parsing and all six checks to Node
RESULT=$(MANIFEST_PATH="$MANIFEST_FILE" REPO_ROOT="$ROOT_DIR" node --input-type=module <<'NODEEOF'
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const manifestPath = process.env.MANIFEST_PATH;
const root = process.env.REPO_ROOT;

const errors = [];
let src;

try {
  src = readFileSync(manifestPath, 'utf8');
} catch (e) {
  errors.push(`Cannot read manifest: ${e.message}`);
  process.stdout.write(JSON.stringify(errors));
  process.exit(0);
}

// ── Minimal YAML parser for the manifest schema ─────────────────────────────
// The manifest uses a well-defined structure. We parse it without a YAML
// library to avoid a Node module dependency in a gate script.
//
// Structure:
//   version: 1
//   critical_paths:
//     - id: <value>
//       description: <value>
//       surface: <value>
//       coverage:
//         test_path: <value>
//       last_verified: <YYYY-MM-DD>

// Strip comment lines and trailing whitespace
const rawLines = src.split('\n');

// Check 1: version: 1
const versionLine = rawLines.find(l => /^\s*version\s*:/.test(l));
if (!versionLine) {
  errors.push('Check 1 FAIL: top-level "version:" key is missing from manifest');
} else {
  const versionVal = versionLine.replace(/^\s*version\s*:\s*/, '').replace(/#.*$/, '').trim();
  if (versionVal !== '1') {
    errors.push(`Check 1 FAIL: version must be 1, got: ${versionVal}`);
  }
}

// Parse entries — collect each entry block between `  - id:` markers
const entries = [];
let current = null;
let inCoverage = false;

for (const rawLine of rawLines) {
  // Skip comment-only lines
  if (/^\s*#/.test(rawLine)) continue;

  const stripped = rawLine.replace(/#[^'"]*$/, '').trimEnd();

  // New entry start
  if (/^\s{2}-\s+id\s*:/.test(stripped)) {
    if (current) entries.push(current);
    const idVal = stripped.replace(/^\s*-\s+id\s*:\s*/, '').trim();
    current = { id: idVal, description: null, surface: null, coverage: {}, last_verified: null, _coverageCount: 0 };
    inCoverage = false;
    continue;
  }

  if (!current) continue;

  if (/^\s{4}description\s*:/.test(stripped)) {
    current.description = stripped.replace(/^\s*description\s*:\s*/, '').trim();
  } else if (/^\s{4}surface\s*:/.test(stripped)) {
    current.surface = stripped.replace(/^\s*surface\s*:\s*/, '').trim();
  } else if (/^\s{4}coverage\s*:/.test(stripped)) {
    inCoverage = true;
  } else if (/^\s{4}last_verified\s*:/.test(stripped)) {
    current.last_verified = stripped.replace(/^\s*last_verified\s*:\s*/, '').trim();
    inCoverage = false;
  } else if (inCoverage && /^\s{6}test_path\s*:/.test(stripped)) {
    current.coverage.test_path = stripped.replace(/^\s*test_path\s*:\s*/, '').trim();
    current._coverageCount++;
  } else if (inCoverage && /^\s{6}gate_path\s*:/.test(stripped)) {
    current.coverage.gate_path = stripped.replace(/^\s*gate_path\s*:\s*/, '').trim();
    current._coverageCount++;
  } else if (inCoverage && /^\s{6}wont_test_rationale\s*:/.test(stripped)) {
    current.coverage.wont_test_rationale = stripped.replace(/^\s*wont_test_rationale\s*:\s*/, '').trim();
    current._coverageCount++;
  }
}
if (current) entries.push(current);

const VALID_SURFACES = new Set(['agent-execution', 'tenant-isolation', 'sandbox', 'data-retention', 'skill-registry', 'other']);
const KEBAB_RE = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GATE_PATH_RE = /^scripts\/verify-[^/]+\.sh$|^scripts\/gates\/[^/]+\.sh$/;

const seenIds = new Set();
const todayMs = Date.now();
const MAX_AGE_DAYS = 180;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

for (const entry of entries) {
  const id = entry.id || '(unknown)';

  // Check 2: required fields
  if (!entry.id || !KEBAB_RE.test(entry.id)) {
    errors.push(`Entry "${id}" — Check 2 FAIL: id must be kebab-case, got: "${entry.id}"`);
  }
  if (seenIds.has(entry.id)) {
    errors.push(`Entry "${id}" — Check 2 FAIL: id is not unique (duplicate)`);
  }
  seenIds.add(entry.id);

  if (!entry.description || entry.description.length === 0) {
    errors.push(`Entry "${id}" — Check 2 FAIL: description is missing or empty`);
  }

  if (!entry.surface || !VALID_SURFACES.has(entry.surface)) {
    errors.push(`Entry "${id}" — Check 2 FAIL: surface must be one of agent-execution|tenant-isolation|sandbox|data-retention|skill-registry|other, got: "${entry.surface}"`);
  }

  if (!entry.last_verified) {
    errors.push(`Entry "${id}" — Check 2 FAIL: last_verified is missing`);
  }

  // Check 3: exactly one coverage key
  if (entry._coverageCount === 0) {
    errors.push(`Entry "${id}" — Check 3 FAIL: coverage must declare exactly one of test_path, gate_path, or wont_test_rationale (found none)`);
  } else if (entry._coverageCount > 1) {
    errors.push(`Entry "${id}" — Check 3 FAIL: coverage declares ${entry._coverageCount} keys (must be exactly one of test_path, gate_path, or wont_test_rationale)`);
  }

  // Check 4: test_path resolves
  if (entry.coverage.test_path) {
    const fullPath = join(root, entry.coverage.test_path);
    if (!existsSync(fullPath)) {
      errors.push(`Entry "${id}" — Check 4 FAIL: test_path "${entry.coverage.test_path}" does not resolve to an existing file`);
    }
  }

  // Check 5: gate_path resolves and matches pattern
  if (entry.coverage.gate_path) {
    const gp = entry.coverage.gate_path;
    if (!GATE_PATH_RE.test(gp)) {
      errors.push(`Entry "${id}" — Check 5 FAIL: gate_path "${gp}" must match scripts/verify-*.sh or scripts/gates/*.sh`);
    } else {
      const fullPath = join(root, gp);
      if (!existsSync(fullPath)) {
        errors.push(`Entry "${id}" — Check 5 FAIL: gate_path "${gp}" does not resolve to an existing file`);
      }
    }
  }

  // Check 6: last_verified within 180 days
  if (entry.last_verified && DATE_RE.test(entry.last_verified)) {
    const verifiedMs = new Date(entry.last_verified).getTime();
    const ageMs = todayMs - verifiedMs;
    if (ageMs > MAX_AGE_MS) {
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      errors.push(`Entry "${id}" — Check 6 FAIL: last_verified "${entry.last_verified}" is ${ageDays} days ago (max ${MAX_AGE_DAYS} days)`);
    }
  } else if (entry.last_verified && !DATE_RE.test(entry.last_verified)) {
    errors.push(`Entry "${id}" — Check 6 FAIL: last_verified "${entry.last_verified}" is not a valid YYYY-MM-DD date`);
  }
}

if (entries.length === 0) {
  errors.push('Manifest has no entries under critical_paths — at least one entry is required');
}

process.stdout.write(JSON.stringify({ errors, entryCount: entries.length }));
NODEEOF
)

VIOLATION_COUNT=$(RESULT_JSON="$RESULT" node --input-type=module <<'NODEEOF'
const r = JSON.parse(process.env.RESULT_JSON);
process.stdout.write(String(r.errors.length));
NODEEOF
)

ENTRY_COUNT=$(RESULT_JSON="$RESULT" node --input-type=module <<'NODEEOF'
const r = JSON.parse(process.env.RESULT_JSON);
process.stdout.write(String(r.entryCount));
NODEEOF
)

if [ "$VIOLATION_COUNT" -eq 0 ]; then
  echo ""
  echo "  Manifest entries validated: $ENTRY_COUNT"
  echo ""
  echo "verify-critical-path-coverage: PASS — all $ENTRY_COUNT entries satisfy the spec §11.4 schema."
  echo "[GATE] ${GUARD_ID}: violations=0"
  exit 0
fi

echo ""
echo "verify-critical-path-coverage: BLOCKING FAIL"
echo ""
echo "tasks/critical-paths-manifest.yml fails one or more spec §11.4 schema checks."
echo "Fix each entry per the schema, then re-run this gate."
echo ""
echo "Failures:"
RESULT_JSON="$RESULT" node --input-type=module <<'NODEEOF'
const r = JSON.parse(process.env.RESULT_JSON);
for (const e of r.errors) {
  process.stdout.write(`  - ${e}\n`);
}
NODEEOF

echo ""
echo "[GATE] ${GUARD_ID}: violations=${VIOLATION_COUNT}"
exit 1
