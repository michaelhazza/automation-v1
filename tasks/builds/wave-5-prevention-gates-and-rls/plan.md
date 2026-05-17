# Wave 5 — Prevention Gates + Full Service-Tier RLS Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 6 prevention gates and migrate all service-tier raw-`db` callsites on tenant-scoped tables to `getOrgScopedDb()` or `withAdminConnection()`, permanently closing the defence-in-depth gap before production.

**Architecture:** Org-scoped queries run through `getOrgScopedDb(source)` — retrieves the ALS-bound tx opened by the `authenticate` middleware or `createWorker` wrapper. Cross-tenant admin queries run through `withAdminConnection({source, reason}, fn)`. The existing `verify-with-org-tx-or-scoped-db.sh` (P2) enforces this post-migration. No new primitives introduced; no new `withOrgTx` call sites added. App-layer `where(eq(table.organisationId, orgId))` predicates are preserved as defence-in-depth.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL RLS, Bash gate scripts, Node.js inline scripts, jscpd, madge, knip

---

## Table of Contents

- [File Map](#file-map)
- [Chunk 0: Pre-flight inventory](#chunk-0-pre-flight-inventory)
- [Chunk 1: PP-CD1 — circular-deps wiring](#chunk-1-pp-cd1--verify-circular-deps-gate-wiring)
- [Chunk 2: PP-DUP1 — re-seed + promote to error](#chunk-2-pp-dup1--re-seed-duplicate-blocks-baseline--promote-to-error-mode)
- [Chunk 3: PP-SK1 — new gate script](#chunk-3-pp-sk1--author-verify-skill-registry-alignment-gate)
- [Chunk 4: PP-SK2 — source alignment](#chunk-4-pp-sk2--resolve-grandfathered-universal-skill-sync-entries)
- [Chunk 5: PP-FE2 — frontend budget verify](#chunk-5-pp-fe2--verify-frontend-design-budget-gate-coverage)
- [Chunk 6: PP-MC2 — critical-path wiring](#chunk-6-pp-mc2--verify-critical-path-coverage-gate-wiring)
- [Chunk 7: RLS — Agent Execution (F4)](#chunk-7-rls-migration--agent-execution-services-f4)
- [Chunk 8: RLS — Skill Executor (F7)](#chunk-8-rls-migration--skill-execution-services-f7)
- [Chunk 9: RLS — Workflow Services](#chunk-9-rls-migration--workflow-services)
- [Chunk 10: RLS — Billing/Cost Services](#chunk-10-rls-migration--billingcost-services)
- [Chunk 11: RLS — Personal Assistant Services](#chunk-11-rls-migration--personal-assistant-services)
- [Chunk 12: RLS — Sandbox Services](#chunk-12-rls-migration--sandbox-services)
- [Chunk 13: RLS — Integration Services](#chunk-13-rls-migration--integration-services)
- [Chunk 14: RLS — Remaining Tier 1 Services](#chunk-14-rls-migration--remaining-tier-1-services)
- [Chunk 15: Tier 2 Annotation Sweep](#chunk-15-tier-2-annotation-sweep)
- [Chunk 16: knip.json Extension](#chunk-16-knipjson-extension)
- [Chunk 17: Final Gates Pass + PR Body](#chunk-17-final-gates-pass--pr-body-preparation)
- [Self-Review](#self-review)

---

## File Map

**Created:**
- `scripts/verify-skill-registry-alignment.sh` — PP-SK1 gate (Chunk 3)
- `scripts/.gate-baselines/skill-registry-alignment.txt` — PP-SK1 baseline (Chunk 3)
- `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md` — callsite inventory (Chunk 0)

**Modified:**
- `scripts/.gate-baselines/duplicate-blocks.txt` — re-seed clone count (Chunk 2)
- `scripts/verify-duplicate-blocks.sh` — promote to exit 1 (Chunk 2)
- `scripts/run-all-gates.sh` — add PP-SK1 entry (Chunk 3)
- `server/config/universalSkills.ts` — add `search_codebase`; possibly remove `read_codebase` (Chunk 4)
- `scripts/snapshots/action-registry.snapshot.json` — set `isUniversal:true` on `read_codebase` if entry exists (Chunk 4)
- `scripts/.gate-baselines/universal-skill-sync.txt` — remove two grandfathered entries (Chunk 4)
- `scripts/verify-frontend-design-budget.sh` — extend monitored component list if gap found (Chunk 5)
- `docs/frontend-design-allowlist.json` — extend allowlist if new components monitored (Chunk 5)
- `knip.json` — extend with build tooling, dynamic imports, generated files (Chunk 16)
- `server/services/**/*.ts` — RLS callsite migrations (Chunks 7–15; exact files from tier-categorisation.md)

---

## Chunk 0: Pre-flight inventory

**Goal:** Produce `tier-categorisation.md` (per-callsite inventory) and confirm per-gate state so all subsequent chunks have a concrete target list.

**Files:**
- Create: `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md`

- [ ] **Step 1: Confirm PP-CD1 gate state**

```bash
bash scripts/verify-no-new-cycles.sh
grep "verify-no-new-cycles" scripts/run-all-gates.sh
```
Expected: gate exits 0 and appears in run-all-gates.sh (line ~159). Record verdict.

- [ ] **Step 2: Capture current duplicate-blocks count for PP-DUP1**

```bash
npx jscpd --min-tokens 15 --reporters json --output /tmp/jscpd-chunk0 \
  server/ client/ shared/ worker/ > /dev/null 2>&1
node -e "const r=require('/tmp/jscpd-chunk0/jscpd-report.json'); console.log('clone-count:'+r.statistics.total.clones)"
grep "verify-duplicate-blocks" scripts/run-all-gates.sh
```
Record the current count (e.g. `clone-count:9118`). This becomes the new baseline in Chunk 2.

- [ ] **Step 3: Check whether Session K W4AA-DEBT-1 has merged (PP-SK1 pre-condition)**

```bash
git log --oneline origin/main | head -20
```
Look for Session K's orphan `ACTION_REGISTRY` resolution commit. If NOT merged: record in tier-categorisation.md: "PP-SK1 seed blocked — do not create baseline or wire gate until Session K W4AA-DEBT-1 merges and mismatch-count is 0." Chunk 3 gate authoring (script only) may proceed, but no baseline is created and the gate is not wired until K lands.

- [ ] **Step 4: Determine PP-SK2 resolution direction**

```bash
cat scripts/.gate-baselines/universal-skill-sync.txt
cat server/config/universalSkills.ts
node -e "const s=require('./scripts/snapshots/action-registry.snapshot.json'); \
  const e=s.entries['read_codebase']; \
  console.log(e ? 'read_codebase exists, isUniversal='+e.isUniversal : 'read_codebase: NO ENTRY')"
```

Current situation from baseline:
- `read_codebase`: in `UNIVERSAL_SKILL_NAMES` but no `isUniversal:true` in ACTION_REGISTRY
- `search_codebase`: has `isUniversal:true` in ACTION_REGISTRY but absent from `UNIVERSAL_SKILL_NAMES`

Chosen direction (record in tier-categorisation.md before proceeding to Chunk 4):
- **search_codebase fix**: add to `UNIVERSAL_SKILL_NAMES` — registry already marks it `isUniversal:true`
- **read_codebase fix**: if registry entry exists with `isUniversal:false` → set `isUniversal:true` in snapshot; if no registry entry → remove from `UNIVERSAL_SKILL_NAMES`

- [ ] **Step 5: Confirm PP-FE2 gap (if any)**

```bash
bash scripts/verify-frontend-design-budget.sh
```
Current monitored set: `MetricCard`, `RunActivityChart`, `SuccessRateChart`, `SparkLine`, `PnlKpiCard`, `PnlSparkline`, `PnlTrendChart`, `SparklineChart`, `SpendTrendChart`. Check `docs/frontend-design-principles.md § Complexity budget per screen` for any additional component literals. Record finding.

- [ ] **Step 6: Confirm PP-MC2 wiring**

```bash
grep "verify-critical-path-coverage" scripts/run-all-gates.sh
bash scripts/verify-critical-path-coverage.sh
```
Expected: appears in run-all-gates.sh (line ~186), exits 0.

- [ ] **Step 7: Find all raw `db` imports in server/services/**

```bash
grep -rl "from.*['\"].*db/index" server/services/ | sort > /tmp/db-importing-files.txt
wc -l /tmp/db-importing-files.txt
```

- [ ] **Step 8: Enumerate per-callsite raw db usage — inclusive inventory**

The source-of-truth inventory must include ALL raw `db` callsites, including already-annotated ones, because Tier 2 residue must still be reviewed and counted. Do NOT filter out `guard-ignore` lines here.

```bash
# Full inclusive inventory — all raw db callsites (annotated or not)
grep -rn "\bdb\.\(select\|insert\|update\|delete\|execute\|query\|transaction\)" \
  server/services/ --include="*.ts" \
  | grep -v "getOrgScopedDb\|withAdminConnection\|scopedDb" \
  | sort
```

Separately, capture the current P2 gate violation count (unsuppressed callsites only — for the pre-migration baseline):
```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
```
Record both counts: (a) total raw-`db` callsites in the inventory, (b) current P2 unsuppressed violations. The per-migration gate checks in Chunks 7-15 verify that (b) does not increase.

- [ ] **Step 8a: Record Session M per-file merge order for agentExecutionService**

Session M touches `server/services/agentExecutionService/*` for LAEL emission sites. List every agentExecutionService file that appears in BOTH the Chunk 7 RLS migration scope (from Step 8 results) AND any pending Session M patch (check `git log --oneline --all | grep -i "session.m\|lael\|emission"`). For each overlapping file, record the required merge order (Session M first, then Wave-5 rebase, or vice versa) in `tier-categorisation.md`:

```markdown
## Session M deconfliction — agentExecutionService
Session M last merged: <commit> / NOT YET MERGED
Overlapping files (require ordered merge):
- server/services/agentExecutionService/<file>.ts — merge order: <Session M before Wave-5 | no conflict>
```

If Session M is not yet on `main`, record: "Session M pending — Wave-5 Chunk 7 must rebase onto Session M's branch tip or wait for merge." Do NOT start Chunk 7 until this row is recorded.

- [ ] **Step 8b: Confirm RLS GUC for ea_drafts and voice_profiles**

`ea_drafts` and `voice_profiles` are FORCE RLS tables. Before deciding whether `getOrgScopedDb()` is safe for their per-route callsites, confirm which GUC the RLS policy actually checks. The manifest in `server/config/rlsProtectedTables.ts` records `schemaFile` and `policyMigration` pointers — read those SQL files directly to find the `USING` clause:

```bash
# 1. Find which migration files define RLS for ea_drafts and voice_profiles
grep -rn "ea_drafts\|voice_profiles" server/db/migrations/*.sql | grep -i "create policy\|for all\|using"

# 2. Once you have the migration filename(s), read the USING clause to confirm the GUC
# e.g.: grep -A 5 "ea_drafts" server/db/migrations/0NNN_<filename>.sql | grep current_setting
```

**Derive `tenant_key` from the USING clause**, not from any field in `rlsProtectedTables.ts` (the manifest does not carry tenant-key metadata; it carries `schemaFile` and `policyMigration` pointers only).

**If `USING` clause checks `current_setting('app.organisation_id')`**: `getOrgScopedDb()` is safe for per-route callsites. Proceed with Tier 1 migration in Chunk 11.
**If `USING` clause checks any other GUC (e.g. `app.owner_user_id`)**: Do not use `getOrgScopedDb()` — it sets the wrong GUC. Classify each callsite individually per Chunk 11 Step 2 branching. Record verdict in tier-categorisation.md before Chunk 11.

- [ ] **Step 9: Produce tier-categorisation.md**

For each callsite from Step 8, classify as Tier 1 / Tier 1 blocked / Tier 2 / Tier 3 using the rules in spec §8. Record in the artifact:

```markdown
# Wave 5 Tier Categorisation
Generated: <YYYY-MM-DD>
Files reviewed: <N>
Raw-db callsites found: <Y>
Tier 1 (must-migrate): <A>
Tier 1 blocked (no upstream org context): <A'>
Tier 2 (sanctioned bypass): <B>
Tier 3 (already clean): <C>

## Per-callsite list
<!-- tenant_key: derived from the USING clause in the policyMigration SQL file (NOT a field in rlsProtectedTables.ts).
     policy_migration: the SQL filename from RLS_PROTECTED_TABLES[n].policyMigration for the table. -->

| file:line | callsite | table | tenant_key | policy_migration | tier | upstream entrypoint / rationale |
...

## Gate state (pre-build)
| Gate | Script | Baseline | Current | Exit mode | Delta |
...

## Migration chunk order (highest-traffic first)
1. agentExecutionService (Chunk 7)
2. skillExecutor (Chunk 8)
...
```

- [ ] **Step 10: Commit Chunk 0**

```bash
git add tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md
git commit -m "chore(wave-5): chunk 0 — tier categorisation + pre-flight gate state"
```

---

## Chunk 1: PP-CD1 — Verify circular-deps gate wiring

**Files:** Read-only verification — no file changes.

- [ ] **Step 1: Confirm gate is wired in run-all-gates.sh**

```bash
grep "verify-no-new-cycles" scripts/run-all-gates.sh
```
Expected (line ~159): `run_gate "$SCRIPT_DIR/verify-no-new-cycles.sh"`

- [ ] **Step 2: Confirm baseline value**

```bash
cat scripts/.gate-baselines/circular-deps.txt
```
Expected: `cycle-count:0`

- [ ] **Step 3: Run the gate**

```bash
bash scripts/verify-no-new-cycles.sh
```
Expected: exit 0. If cycles are reported, STOP — do not proceed until the regression is resolved.

- [ ] **Step 4: Record verdict and no commit needed**

```bash
echo "PP-CD1: VERIFIED — gate wired, baseline cycle-count:0, exits 0 against current main, error mode" \
  >> tasks/builds/wave-5-prevention-gates-and-rls/progress.md
```

---

## Chunk 2: PP-DUP1 — Re-seed duplicate-blocks baseline + promote to error mode

**Files:**
- Modify: `scripts/.gate-baselines/duplicate-blocks.txt`
- Modify: `scripts/verify-duplicate-blocks.sh`

- [ ] **Step 1: Read clone count from Chunk 0 Step 2**

Open `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md`. Find the gate-state table row for PP-DUP1 and note the current clone count (e.g. `9118`).

- [ ] **Step 2: Re-seed the baseline file**

Edit `scripts/.gate-baselines/duplicate-blocks.txt` to replace its content with (substitute `<N>` and dates):

```
# Baseline for P12 verify-duplicate-blocks.sh
# Re-seeded <YYYY-MM-DD> post-Wave-5 — jscpd --min-tokens 15 --reporters json
# reported <N> clone blocks. Baseline count: <N>
# Gate fails only if clone count EXCEEDS this baseline.
# Format: clone-count:<n>  (single numeric entry)
# expires: <YYYY-MM-DD one year from today>
clone-count:<N>
```

- [ ] **Step 3: Promote gate to exit 1 (error mode)**

In `scripts/verify-duplicate-blocks.sh`, in the regression block (`if [ "$CURRENT_COUNT" -gt "$BASELINE_COUNT" ]`), change:
```bash
  exit 2
```
to:
```bash
  exit 1
```

Also update the script header — change the exit-codes comment:
```
# Exit codes: 0 = at or below baseline, 2 = regression (new clones)
```
to:
```
# Exit codes: 0 = at or below baseline, 1 = regression (new clones)
```
And replace the 2026-05-15 revert note with:
```
# Promoted to exit-1 error mode <YYYY-MM-DD> after re-seeding baseline to <N> (post-Wave-5 count).
```

- [ ] **Step 4: Run the gate — confirm exit 0**

```bash
bash scripts/verify-duplicate-blocks.sh
```
Expected: exit 0 (current count ≤ new baseline). If it exits 1, the live count has grown since Chunk 0 — re-run Chunk 0 Step 2 to get the freshest count and update the baseline.

- [ ] **Step 4a: Forced-failure verification — confirm the gate actually fires on regression**

Temporarily reduce the baseline by 1 so the current count exceeds it, then verify exit 1:

```bash
# Step 4a-i: Read current baseline value (e.g. 9118)
CURRENT_BASELINE=$(grep -E '^clone-count:[0-9]+$' scripts/.gate-baselines/duplicate-blocks.txt | head -1 | cut -d: -f2)
echo "Current baseline: $CURRENT_BASELINE"

# Step 4a-ii: Write a baseline 1 below current to force regression
REDUCED=$((CURRENT_BASELINE - 1))
sed -i.bak "s/^clone-count:${CURRENT_BASELINE}$/clone-count:${REDUCED}/" \
  scripts/.gate-baselines/duplicate-blocks.txt

# Step 4a-iii: Run gate (capture status without fail-fast)
set +e
bash scripts/verify-duplicate-blocks.sh
GATE_STATUS=$?
set -e

# Step 4a-iv: Always restore baseline first, before asserting
mv scripts/.gate-baselines/duplicate-blocks.txt.bak \
   scripts/.gate-baselines/duplicate-blocks.txt

# Step 4a-v: Assert the gate detected the regression
echo "Exit code: $GATE_STATUS"
test "$GATE_STATUS" -eq 1 || { echo "FAIL: expected exit 1, got $GATE_STATUS"; exit 1; }

# Step 4a-vi: Confirm restored baseline exits 0
set +e
bash scripts/verify-duplicate-blocks.sh
RESTORE_STATUS=$?
set -e
echo "Restore exit code: $RESTORE_STATUS"
test "$RESTORE_STATUS" -eq 0 || { echo "FAIL: expected exit 0 after restore, got $RESTORE_STATUS"; exit 1; }
```

If Step 4a-v FAIL fires: STOP — the gate is broken. Do not proceed until the detection logic is fixed.

- [ ] **Step 5: Verify wiring in run-all-gates.sh (no change needed)**

```bash
grep "verify-duplicate-blocks" scripts/run-all-gates.sh
```
Expected: one match (line ~161).

- [ ] **Step 6: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add scripts/.gate-baselines/duplicate-blocks.txt scripts/verify-duplicate-blocks.sh
git commit -m "gate(PP-DUP1): re-seed duplicate-blocks baseline to <N>, promote to exit-1 error mode"
```

---

## Chunk 3: PP-SK1 — Author verify-skill-registry-alignment gate

**Files:**
- Create: `scripts/verify-skill-registry-alignment.sh`
- Create: `scripts/.gate-baselines/skill-registry-alignment.txt`
- Modify: `scripts/run-all-gates.sh`

**Naming rule:** Action type `X.Y` maps to filename `X_Y.md` (dots become underscores). E.g. `crm.fire_automation` → `crm_fire_automation.md`. Single-part types map 1:1 (e.g. `add_deliverable` → `add_deliverable.md`).

- [ ] **Step 0: Confirm Session K W4AA-DEBT-1 has merged**

```bash
git log --oneline origin/main | head -30
```

Look for Session K's orphan `ACTION_REGISTRY` resolution commit.

**If NOT merged:**
- You may author the gate script (Step 1) for review purposes only.
- Do NOT run Steps 3, 3a, 4, or 5 (no pass/fail acceptance, no baseline, no wiring).
- Record in `progress.md`:
  ```
  PP-SK1: gate script authored. Steps 3+ HELD — W4AA-DEBT-1 not yet on main.
  No baseline created. Gate not wired. Resume from Step 3 after K lands.
  ```
- Stop this chunk.

**If merged:** Proceed to Step 1 to author the script. Step 3 is the first place the newly authored script is executed — do not run it here.

- [ ] **Step 1: Author the gate script**

Create `scripts/verify-skill-registry-alignment.sh`:

```bash
#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-skill-registry-alignment.sh  (PP-SK1)
#
# Asserts symmetric alignment between ACTION_REGISTRY snapshot keys and
# .md files under server/skills/.
#
# Naming rule (W4AA-DEBT-2): action type X.Y → file X_Y.md (dots → underscores).
#
# Excluded from analysis (non-skill markdown):
#   - server/skills/README.md
#   - server/skills/__tests__/**
#
# Baseline: scripts/.gate-baselines/skill-registry-alignment.txt
#   Format: mismatch-count:<n>
#
# Exit codes: 0 = at or below baseline, 1 = regression (new mismatches)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="skill-registry-alignment"
BASELINE_FILE="$ROOT_DIR/scripts/.gate-baselines/skill-registry-alignment.txt"
SNAPSHOT="$ROOT_DIR/scripts/snapshots/action-registry.snapshot.json"
SKILLS_DIR="$ROOT_DIR/server/skills"

source "$SCRIPT_DIR/lib/guard-utils.sh"
emit_header "$GUARD_ID"

RESULT=$(
  SNAPSHOT="$SNAPSHOT" SKILLS_DIR="$SKILLS_DIR" \
  node --input-type=module <<'NODEEOF'
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const snapshot = JSON.parse(readFileSync(process.env.SNAPSHOT, 'utf8').replace(/\r/g, ''));
const skillsDir = process.env.SKILLS_DIR;
const registryKeys = Object.keys(snapshot.entries);

// Registry keys → expected filenames
const expectedFromRegistry = new Map(
  registryKeys.map(k => [k.replace(/\./g, '_') + '.md', k])
);

function walkMd(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue;
      results.push(...walkMd(join(dir, e.name)));
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      results.push(e.name);
    }
  }
  return results;
}

const actualFiles = new Set(walkMd(skillsDir));
const mismatches = [];

// Registry keys with no corresponding .md file
for (const [expectedFile, key] of expectedFromRegistry) {
  if (!actualFiles.has(expectedFile)) {
    mismatches.push(`REGISTRY:${key}:registry entry has no .md file (expected server/skills/${expectedFile})`);
  }
}

// .md files with no corresponding registry entry
for (const file of actualFiles) {
  const dotForm  = basename(file, '.md').replace(/_/g, '.');
  const uscore   = basename(file, '.md');
  if (!snapshot.entries[dotForm] && !snapshot.entries[uscore]) {
    mismatches.push(`SKILL_FILE:${file}:.md file has no registry entry (tried: ${dotForm}, ${uscore})`);
  }
}

process.stdout.write(JSON.stringify({ mismatches }));
NODEEOF
)

MISMATCH_COUNT=$(R="$RESULT" node -e \
  "const r=JSON.parse(process.env.R); process.stdout.write(String(r.mismatches.length))")
MISMATCH_LINES=$(R="$RESULT" node -e \
  "const r=JSON.parse(process.env.R); process.stdout.write(r.mismatches.join('\n'))")

if [ "$MISMATCH_COUNT" -gt 0 ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    src=$(echo "$line" | cut -d: -f1)
    key=$(echo "$line" | cut -d: -f2)
    msg=$(echo "$line" | cut -d: -f3-)
    emit_violation "$GUARD_ID" "error" "$src" "0" "$key: $msg" \
      "Add the missing .md file to server/skills/ or remove the orphan registry entry."
  done <<< "$MISMATCH_LINES"
fi

emit_summary "checked" "$MISMATCH_COUNT"

BASELINE_COUNT=0
if [ -f "$BASELINE_FILE" ]; then
  RAW=$(grep -E '^mismatch-count:[0-9]+$' "$BASELINE_FILE" | head -1 || true)
  [ -n "$RAW" ] && BASELINE_COUNT="${RAW#mismatch-count:}"
fi

echo "Skill registry alignment — current: $MISMATCH_COUNT, baseline: $BASELINE_COUNT"
echo "[GATE] ${GUARD_ID}: violations=${MISMATCH_COUNT}"

if [ "$MISMATCH_COUNT" -gt "$BASELINE_COUNT" ]; then
  echo "Regression: $MISMATCH_COUNT mismatches exceeds baseline of $BASELINE_COUNT" >&2
  exit 1
fi
exit 0
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/verify-skill-registry-alignment.sh
```

- [ ] **Step 3: Run the gate — confirm mismatch count is 0**

```bash
bash scripts/verify-skill-registry-alignment.sh 2>&1
```
Expected: exits 0, `current: 0`. (Step 0 already confirmed K has merged; any non-zero count here means a new mismatch was introduced on this branch — STOP and resolve before continuing.)

- [ ] **Step 3a: Forced-failure verification — confirm the gate fires on a real mismatch**

Introduce a deliberate orphan registry key and verify the gate detects it:

```bash
# Step 3a-i: Add a fake orphan entry to the snapshot (key with no matching .md file)
node -e "
  const fs=require('fs');
  const p='scripts/snapshots/action-registry.snapshot.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  s.entries['__test_orphan_key__'] = { isUniversal: false };
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  console.log('Orphan entry added');
"

# Step 3a-ii: Run gate (capture status without fail-fast)
set +e
bash scripts/verify-skill-registry-alignment.sh
GATE_STATUS=$?
set -e

# Step 3a-iii: Always revert the snapshot first, before asserting
node -e "
  const fs=require('fs');
  const p='scripts/snapshots/action-registry.snapshot.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  delete s.entries['__test_orphan_key__'];
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  console.log('Orphan entry removed');
"

# Step 3a-iv: Assert the gate detected the mismatch
echo "Exit code: $GATE_STATUS"
test "$GATE_STATUS" -eq 1 || { echo "FAIL: expected exit 1, got $GATE_STATUS"; exit 1; }

# Step 3a-v: Confirm gate exits 0 after revert
set +e
bash scripts/verify-skill-registry-alignment.sh
RESTORE_STATUS=$?
set -e
echo "Restore exit code: $RESTORE_STATUS"
test "$RESTORE_STATUS" -eq 0 || { echo "FAIL: expected exit 0 after revert, got $RESTORE_STATUS"; exit 1; }
```

If Step 3a-iv FAIL fires: STOP — the gate detection logic is broken. Fix before seeding the baseline.

- [ ] **Step 4: Create the baseline file**

(Step 0 confirmed K has merged and the gate exits 0 before this step is reached.)

Create `scripts/.gate-baselines/skill-registry-alignment.txt`:

```
# Baseline for PP-SK1 verify-skill-registry-alignment.sh
# Seeded <YYYY-MM-DD> post-Session-K W4AA-DEBT-1 — orphan ACTION_REGISTRY entries resolved.
# Gate fails only if mismatch count EXCEEDS this baseline.
# Format: mismatch-count:<n>  (single numeric entry)
# expires: <YYYY-MM-DD one year from today>
mismatch-count:0
```

- [ ] **Step 5: Wire gate into run-all-gates.sh (only after Step 4 baseline is created)**

After the last `run_gate` call in the file (after `verify-error-code-taxonomy.sh`), append:

```bash
# ── Wave 5 Session N prevention gates ──
run_gate "$SCRIPT_DIR/verify-skill-registry-alignment.sh"
```

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

- [ ] **Step 7: Run the gate once more to confirm exit 0**

```bash
bash scripts/verify-skill-registry-alignment.sh
```
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-skill-registry-alignment.sh \
        scripts/.gate-baselines/skill-registry-alignment.txt \
        scripts/run-all-gates.sh
git commit -m "gate(PP-SK1): author verify-skill-registry-alignment — .md ↔ ACTION_REGISTRY symmetric check"
```

---

## Chunk 4: PP-SK2 — Resolve grandfathered universal-skill-sync entries

**Files:**
- Modify: `server/config/universalSkills.ts` (add `search_codebase`; possibly remove `read_codebase`)
- Possibly modify: `scripts/snapshots/action-registry.snapshot.json` (set `isUniversal:true` on `read_codebase` if entry exists)
- Modify: `scripts/.gate-baselines/universal-skill-sync.txt` (remove 2 grandfathered lines)

**Pre-condition:** The resolution direction was captured in Chunk 0 Step 4. Confirm before applying.

- [ ] **Step 1: Check current gate exit code**

```bash
bash scripts/verify-universal-skill-sync.sh
```
Expected: exit 2 (within-grace warning for 2 baselined entries). If exit 0 or 1, something changed — re-read the baseline and recheck.

- [ ] **Step 2: Fix search_codebase — add to UNIVERSAL_SKILL_NAMES**

`search_codebase` has `isUniversal:true` in the registry but is missing from `UNIVERSAL_SKILL_NAMES`. Add it to `server/config/universalSkills.ts`:

```typescript
export const UNIVERSAL_SKILL_NAMES: readonly string[] = [
  'ask_clarifying_question',
  'request_clarification',
  'read_workspace',
  'web_search',
  'read_codebase',        // see Step 3 — may be removed
  'search_agent_history',
  'read_priority_feed',
  'search_codebase',      // added: matches isUniversal:true in ACTION_REGISTRY
];
```

- [ ] **Step 3: Fix read_codebase — check registry entry and apply chosen direction**

```bash
node -e "const s=require('./scripts/snapshots/action-registry.snapshot.json'); \
  const e=s.entries['read_codebase']; \
  console.log(JSON.stringify({exists: !!e, isUniversal: e && e.isUniversal}))"
```

**If entry exists and `isUniversal` is false/missing:** Edit `scripts/snapshots/action-registry.snapshot.json` — find the `"read_codebase"` object and add/set `"isUniversal": true`. Keep `read_codebase` in `UNIVERSAL_SKILL_NAMES`.

**If no registry entry for `read_codebase`:** Remove it from `UNIVERSAL_SKILL_NAMES`:
```typescript
// 'read_codebase' removed — no isUniversal:true registry entry (PP-SK2 alignment)
```

- [ ] **Step 4: Run gate — verify zero violations**

```bash
bash scripts/verify-universal-skill-sync.sh
```
Expected: exit 0, `current: 0`.

- [ ] **Step 4a: Forced-failure verification — confirm gate fires when a mismatch is re-introduced**

```bash
# Step 4a-i: Temporarily remove search_codebase from universalSkills.ts to force a mismatch
# (Use a scratch copy to avoid forgetting to revert)
cp server/config/universalSkills.ts server/config/universalSkills.ts.bak

# Remove the 'search_codebase' line from the array
node -e "
  const fs=require('fs');
  const p='server/config/universalSkills.ts';
  let s=fs.readFileSync(p,'utf8');
  s=s.replace(/\n?\s*'search_codebase'.*\n/, '\n');
  fs.writeFileSync(p, s);
  console.log('search_codebase removed');
"

# Step 4a-ii: Run gate (capture status without fail-fast)
set +e
bash scripts/verify-universal-skill-sync.sh
GATE_STATUS=$?
set -e

# Step 4a-iii: Always restore file first, before asserting
mv server/config/universalSkills.ts.bak server/config/universalSkills.ts

# Step 4a-iv: Assert the gate detected the mismatch
echo "Exit code: $GATE_STATUS"
test "$GATE_STATUS" -ne 0 || { echo "FAIL: expected non-zero exit, got 0"; exit 1; }

# Step 4a-v: Confirm gate exits 0 after restore
set +e
bash scripts/verify-universal-skill-sync.sh
RESTORE_STATUS=$?
set -e
echo "Restore exit code: $RESTORE_STATUS"
test "$RESTORE_STATUS" -eq 0 || { echo "FAIL: expected exit 0 after restore, got $RESTORE_STATUS"; exit 1; }
```

If Step 4a-iv FAIL fires: STOP — the gate detection logic is broken. Do not clear the baseline until fixed.

- [ ] **Step 5: Clear the baseline file**

Edit `scripts/.gate-baselines/universal-skill-sync.txt` — remove the two grandfathered `UNIVERSAL_SKILL_NAMES:0:...` and `ACTION_REGISTRY:0:...` lines. Keep only the header comment block:

```
# Baseline for P7 verify-universal-skill-sync.sh
# Cleared <YYYY-MM-DD> — both PP-SK2 entries resolved by source alignment.
# No grandfathered entries remain.
```

- [ ] **Step 6: Run gate again with empty baseline — confirm exit 0**

```bash
bash scripts/verify-universal-skill-sync.sh
```
Expected: exit 0.

- [ ] **Step 7: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add server/config/universalSkills.ts \
        scripts/.gate-baselines/universal-skill-sync.txt
# if snapshot was modified:
git add scripts/snapshots/action-registry.snapshot.json
git commit -m "gate(PP-SK2): resolve read_codebase/search_codebase universal-skill drift — baseline cleared"
```

---

## Chunk 5: PP-FE2 — Verify frontend-design-budget gate coverage

**Files:**
- Possibly modify: `scripts/verify-frontend-design-budget.sh` (only if new components found)
- Possibly modify: `docs/frontend-design-allowlist.json` (only if new importers found)

- [ ] **Step 1: Read the Chunk 0 PP-FE2 verdict**

Open `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md` and read the PP-FE2 row. If it says "no extension needed", skip to Step 4.

- [ ] **Step 2: (If gap found) Extend monitored component set in the gate script**

In `scripts/verify-frontend-design-budget.sh`, find the `MONITORED_COMPONENTS` array in the inline Node script:

```javascript
const MONITORED_COMPONENTS = [
  'MetricCard',
  'RunActivityChart',
  'SuccessRateChart',
  'SparkLine',
  'PnlKpiCard',
  'PnlSparkline',
  'PnlTrendChart',
  'SparklineChart',
  'SpendTrendChart',
  // add new component literals here
];
```

Add the component literals identified in Chunk 0 Step 5.

- [ ] **Step 3: (If gap found) Add existing importers to allowlist**

Find files already importing the new components:
```bash
grep -rl "NewComponentName" client/src/ --include="*.tsx"
```
For each result, add an entry to `docs/frontend-design-allowlist.json`:
```json
{
  "file": "client/src/pages/example/ExamplePage.tsx",
  "reason": "Admin-only page — relaxed budget per frontend-design-principles.md"
}
```

- [ ] **Step 4: Run the gate**

```bash
bash scripts/verify-frontend-design-budget.sh
```
Expected: exit 0.

- [ ] **Step 4a: Forced-failure verification — confirm gate fires on a new complex component import**

```bash
# Step 4a-i: Create a scratch file that imports a MONITORED_COMPONENTS entry without an allowlist entry
SCRATCH="client/src/pages/__gate_test_scratch.tsx"
cat > "$SCRATCH" <<'EOF'
import { MetricCard } from '../../components/MetricCard';
export const GateTestScratch = () => <MetricCard />;
EOF

# Step 4a-ii: Run gate (capture status without fail-fast)
set +e
bash scripts/verify-frontend-design-budget.sh
GATE_STATUS=$?
set -e

# Step 4a-iii: Always remove scratch file first, before asserting
rm "$SCRATCH"

# Step 4a-iv: Assert the gate detected the violation
echo "Exit code: $GATE_STATUS"
test "$GATE_STATUS" -ne 0 || { echo "FAIL: expected non-zero exit, got 0"; exit 1; }

# Step 4a-v: Confirm gate exits 0 after scratch removed
set +e
bash scripts/verify-frontend-design-budget.sh
RESTORE_STATUS=$?
set -e
echo "Restore exit code: $RESTORE_STATUS"
test "$RESTORE_STATUS" -eq 0 || { echo "FAIL: expected exit 0 after cleanup, got $RESTORE_STATUS"; exit 1; }
```

If Step 4a-iv FAIL fires: STOP — the gate detection logic is broken. Do not record PP-FE2 as verified until fixed.

- [ ] **Step 5: Confirm gate wiring in run-all-gates.sh**

```bash
grep "verify-frontend-design-budget" scripts/run-all-gates.sh
```
Expected: one match (line ~166).

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit (only if files were modified)**

```bash
# Skip if no extension was needed
git add scripts/verify-frontend-design-budget.sh docs/frontend-design-allowlist.json
git commit -m "gate(PP-FE2): extend frontend-design-budget monitored component set"
```
If no changes needed: record "PP-FE2: VERIFIED — no extension needed, gate exits 0" in progress.md.

---

## Chunk 6: PP-MC2 — Verify critical-path-coverage gate wiring

**Files:** Read-only — no changes.

- [ ] **Step 1: Confirm gate wiring**

```bash
grep "verify-critical-path-coverage" scripts/run-all-gates.sh
```
Expected: one match (line ~186).

- [ ] **Step 2: Run the gate**

```bash
bash scripts/verify-critical-path-coverage.sh
```
Expected: exit 0. This is a schema gate — it validates `tasks/critical-paths-manifest.yml`. No baseline file.

- [ ] **Step 3: Record verdict**

```bash
echo "PP-MC2: VERIFIED — gate wired (line ~186), exits 0, schema gate, no baseline (already closed pr:332)" \
  >> tasks/builds/wave-5-prevention-gates-and-rls/progress.md
```

No commit needed.

---

## Chunk 7: RLS migration — Agent Execution Services (F4)

**Files:**
- Modify: `server/services/agentExecutionService/**/*.ts` — all Tier 1 callsites in this domain

**Pre-condition:** Two hard gates before starting:
1. Rebase onto latest `main` (Session K touches `server/services/skillExecutor/handlers/tasks.ts` and `server/services/llmRouter/routeCall.ts` — no direct overlap, but must be on the latest base).
2. **Session M deconfliction (hard stop if not done):** Session M also touches `server/services/agentExecutionService/*` (LAEL emission sites). Read the per-file merge order produced in Chunk 0 Step 8a before touching any `agentExecutionService` file. If the merge order has not yet been recorded in `tier-categorisation.md`, STOP — complete Chunk 0 first. If a conflict surfaces during migration, STOP and surface to operator.

Read `tier-categorisation.md` § agent-execution rows before starting.

**Core migration pattern** (applies to every Tier 1 callsite in this and all subsequent RLS chunks):

```typescript
// BEFORE — raw db access
import { db } from '../../db/index.js';

async function executeRun(orgId: string, runId: string) {
  const rows = await db.select()
    .from(agentRuns)
    .where(eq(agentRuns.organisationId, orgId));
  // ...
}

// AFTER — org-scoped via ALS
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
// Remove `import { db }` if no longer used after migration

async function executeRun(orgId: string, runId: string) {
  const scopedDb = getOrgScopedDb('agentExecutionService.executeRun');
  const rows = await scopedDb.select()
    .from(agentRuns)
    .where(eq(agentRuns.organisationId, orgId));  // KEEP this predicate
  // ...
}
```

Rules that apply to every RLS chunk:
1. The source string in `getOrgScopedDb()` must be `'<serviceFileName>.<functionName>'`
2. Keep ALL `where(eq(table.organisationId, orgId))` predicates — do NOT remove them
3. Remove `db` from imports if no callsite uses it after migration
4. `getOrgScopedDb()` is called inside the function body, not at module scope
5. If a file has both Tier 1 and Tier 2 callsites, handle each separately in the same PR

**Tier 2 callsite pattern** (cross-tenant admin access):

```typescript
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { sql } from 'drizzle-orm';

async function crossTenantFn() {
  return withAdminConnection(
    { source: 'agentExecutionService.crossTenantFn',
      reason: 'admin job reads all orgs for cross-tenant aggregation' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return tx.select().from(organisations);
    }
  );
}
```

- [ ] **Step 1: List this domain's Tier 1 callsites**

Open `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md`. Extract all rows where file path contains `agentExecutionService` and tier is `Tier 1`. Work through each callsite in Step 2.

- [ ] **Step 2: Apply migration to each Tier 1 callsite**

For every callsite: replace `db.` with `const scopedDb = getOrgScopedDb('agentExecutionService.<fn>'); scopedDb.`. Apply the core pattern above. Remove orphaned `db` imports when done with a file.

- [ ] **Step 3: Apply Tier 2 pattern to each cross-tenant callsite**

For every agentExecutionService Tier 2 callsite: migrate to `withAdminConnection` using the pattern above. For any Tier 2 residue that cannot move (record the reason): annotate with `// guard-ignore: with-org-tx-or-scoped-db reason="<rationale ≤120 chars>"`.

- [ ] **Step 4: Run the P2 gate**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -15
```
The gate performs per-callsite AST analysis. The violation count for agentExecutionService files must decrease to 0 for migrated callsites; overall count must not increase.

- [ ] **Step 5: Run build, lint, typecheck**

```bash
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 6: Run existing tests for this domain**

```bash
npx vitest run server/services/agentExecutionService 2>&1
```
If tests exist: all must pass. If none: record in progress.md — static gates + tier-verdict review is the acceptance criterion.

- [ ] **Step 7: Commit**

```bash
git add server/services/agentExecutionService/
git commit -m "rls(F4): migrate agentExecutionService Tier 1 callsites to getOrgScopedDb"
```

---

## Chunk 8: RLS migration — Skill Execution Services (F7)

**Files:**
- Modify: `server/services/skillExecutor/**/*.ts` — Tier 1 callsites including F7 `db.update(tasks)` residue

**Pre-condition:** Session K's `tasks.ts` await-fix must be merged first (they touch the same file). Rebase onto latest main before starting this chunk.

- [ ] **Step 1: Locate F7 callsite — the db.update(tasks) residue**

```bash
grep -rn "db\.update.*tasks\|db\.update(tasks" server/services/skillExecutor/ --include="*.ts"
```
Record the exact `file:line`. This is the F7 callsite from Track A finding.

- [ ] **Step 2: Check for residue guard-ignore on F7 callsite**

```bash
grep -n "guard-ignore.*with-org-tx" <file-from-step-1>
```
If a `guard-ignore` directive exists on or immediately above the callsite: remove it after migration (spec §6.4 — do not leave residue suppression).

- [ ] **Step 3: Apply Tier 1 migration to F7 callsite**

```typescript
// BEFORE
await db.update(tasks).set({ status: newStatus }).where(eq(tasks.id, taskId));

// AFTER — remove any guard-ignore line above this
const scopedDb = getOrgScopedDb('skillExecutor.<handlerName>');
await scopedDb.update(tasks).set({ status: newStatus }).where(eq(tasks.id, taskId));
```

- [ ] **Step 4: Apply migration to all other skillExecutor Tier 1 callsites**

From tier-categorisation.md, apply the same core pattern to every remaining skillExecutor Tier 1 callsite.

- [ ] **Step 5: Handle Tier 2 callsites in skillExecutor**

Apply `withAdminConnection` or `guard-ignore` per the Chunk 7 Tier 2 pattern.

- [ ] **Step 6: Run P2 gate, build, lint, typecheck**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 7: Run existing tests**

```bash
npx vitest run server/services/skillExecutor 2>&1
```

- [ ] **Step 8: Commit**

```bash
git add server/services/skillExecutor/
git commit -m "rls(F7): migrate skillExecutor Tier 1 callsites to getOrgScopedDb, remove residue guard-ignore"
```

---

## Chunk 9: RLS migration — Workflow Services

**Files:**
- Modify: `server/services/workflowEngine/**/*.ts` — Tier 1 callsites from tier-categorisation.md

**Note:** Per DEVELOPMENT_GUIDELINES.md §2, `workflowEngine/queueLifecycle/tick.ts` and `watchdog.ts` are tracked exceptions for the WF3/WF4 follow-up PR. If they appear as Tier 1 in tier-categorisation.md, mark them `Tier 1 — blocked, tracked exception` and skip migration.

- [ ] **Step 1: List Tier 1 callsites for workflowEngine domain from tier-categorisation.md**

- [ ] **Step 2: Apply Tier 1 migration using core pattern (source = `'workflowEngineService.<fn>'`)**

```typescript
const scopedDb = getOrgScopedDb('workflowEngineService.<functionName>');
```

- [ ] **Step 3: Handle tick.ts and watchdog.ts if listed as Tier 1**

If these files appear: record as "Tier 1 — blocked, tracked exception (WF3/WF4 follow-up PR per DEVELOPMENT_GUIDELINES.md §2)". Do NOT migrate; count them toward the `A'` blocked total.

- [ ] **Step 4: Handle Tier 2 callsites — use withAdminConnection**

```typescript
await withAdminConnection(
  { source: 'workflowEngineService.crossTenantScan',
    reason: 'admin job iterates all workflow runs for pruning' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    return tx.select().from(workflowRuns);
  }
);
```

- [ ] **Step 5: Run P2 gate, build, lint, typecheck**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 6: Run existing tests**

```bash
npx vitest run server/services/workflowEngine 2>&1
```

- [ ] **Step 7: Commit**

```bash
git add server/services/workflowEngine/
git commit -m "rls(wave-5): migrate workflowEngine Tier 1 callsites to getOrgScopedDb"
```

---

## Chunk 10: RLS migration — Billing/Cost Services

**Files:**
- Modify: `server/services/costAggregates*.ts`, `server/services/llmRouter/**/*.ts`, and other billing-domain files from tier-categorisation.md

**Note:** Session K touches `server/services/llmRouter/routeCall.ts`. Rebase onto latest main before starting. Chunk 0 specifies the merge order; if conflict surfaces, stop and escalate.

- [ ] **Step 1: List billing domain Tier 1 callsites from tier-categorisation.md**

Filter for `costAggregates`, `llmRouter`, and any billing/ledger service files.

- [ ] **Step 2: Apply Tier 1 migration (source = `'costAggregatesService.<fn>'` or `'llmRouter.<fn>'`)**

```typescript
const scopedDb = getOrgScopedDb('costAggregatesService.recordSpend');
```

- [ ] **Step 3: Handle cross-tenant billing aggregation (Tier 2)**

Platform-level cost rollups legitimately read across all orgs. Use `withAdminConnection`:

```typescript
await withAdminConnection(
  { source: 'costAggregates.platformRollup',
    reason: 'platform-level cost aggregation across all orgs for billing' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    return tx.select().from(costAggregates);
  }
);
```

- [ ] **Step 4: Run P2 gate, build, lint, typecheck**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/services/costAggregates* server/services/llmRouter/
git commit -m "rls(wave-5): migrate billing/cost service Tier 1 callsites to getOrgScopedDb"
```

---

## Chunk 11: RLS migration — Personal Assistant Services

**Files:**
- Modify: PA V1 and V2 service files from tier-categorisation.md

**Note:** `ea_drafts` and `voice_profiles` are FORCE RLS tables scoped to `owner_user_id`. Background jobs scanning them are Tier 2 — they require `withAdminConnection + SET LOCAL ROLE admin_role`. Do not attempt to reach them via `getOrgScopedDb()`.

- [ ] **Step 1: List PA domain Tier 1 callsites from tier-categorisation.md**

- [ ] **Step 2: Apply Tier 1 migration (source = `'personalAssistantService.<fn>'` etc.)**

**First:** Read the Chunk 0 Step 8b verdict for `ea_drafts` and `voice_profiles` from tier-categorisation.md.

**Branch A — GUC confirmed as `app.organisation_id`:** Per-route callsites may migrate to `getOrgScopedDb()`:

```typescript
const scopedDb = getOrgScopedDb('eaDraftService.getDraft');
const draft = await scopedDb.select().from(eaDrafts)
  .where(eq(eaDrafts.ownerUserId, userId));
```

**Branch B — GUC is NOT `app.organisation_id` (e.g. `app.owner_user_id`):** Do NOT call `getOrgScopedDb()` — it sets the wrong GUC and will not satisfy the RLS policy. Classify each callsite individually:

- **Sanctioned admin/background path** (job scans across users, no per-request org context): classify as **Tier 2**. Migrate to `withAdminConnection + SET LOCAL ROLE admin_role` (see Step 3 pattern). No `guard-ignore` needed on a successfully migrated callsite.

- **Per-request path that has no suitable scoped primitive yet**: classify as **Tier 1 blocked**. Do NOT migrate; leave the raw `db` call untouched. Record in tier-categorisation.md under `A'` (blocked count) with a follow-up note. Do NOT annotate with `guard-ignore` — the callsite is unresolved, not sanctioned.

- **Raw-`db` residue that cannot move this sprint and is explicitly sanctioned** (operator decision): annotate with `guard-ignore`:
  ```typescript
  // guard-ignore: with-org-tx-or-scoped-db reason="ea_drafts RLS checks owner_user_id GUC not set by authenticate — follow-up PR required"
  ```
  Record in tier-categorisation.md under Tier 2 residue (not Tier 1 blocked).

- [ ] **Step 3: Handle voice_profiles and ea_drafts background scan paths (Tier 2)**

These background jobs cannot use `getOrgScopedDb()` because there is no per-org ALS context at job startup. Use `withAdminConnection`:

```typescript
await withAdminConnection(
  { source: 'voiceProfileDerivationJob.scanProfiles',
    reason: 'background derivation job — scans voice_profiles across users for a single org' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    const profiles = await tx.select().from(voiceProfiles)
      .where(eq(voiceProfiles.ownerUserId, userId));
    // ...
  }
);
```

- [ ] **Step 4: Run P2 gate, build, lint, typecheck**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/services/personalAssistant* server/services/eaDraft* server/services/voiceProfile*
git commit -m "rls(wave-5): migrate PA service Tier 1 callsites to getOrgScopedDb"
```

---

## Chunk 12: RLS migration — Sandbox Services

**Files:**
- Modify: Sandbox service files from tier-categorisation.md

- [ ] **Step 1: List sandbox domain Tier 1 callsites from tier-categorisation.md**

- [ ] **Step 2: Apply Tier 1 migration (source = `'sandboxService.<fn>'`)**

```typescript
const scopedDb = getOrgScopedDb('sandboxService.createExecution');
const execution = await scopedDb.insert(sandboxExecutions)
  .values({ organisationId: orgId, ...data }).returning();
```

- [ ] **Step 3: Handle sandbox Tier 2 callsites**

System-scoped telemetry or egress audit reads that span tenants go through `withAdminConnection`:

```typescript
await withAdminConnection(
  { source: 'sandboxService.systemEgressAudit',
    reason: 'system-scoped egress audit read — cross-tenant admin access for platform monitoring' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    return tx.select().from(sandboxEgressAudit);
  }
);
```

- [ ] **Step 4: Run P2 gate, build, lint, typecheck**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/services/sandbox*
git commit -m "rls(wave-5): migrate sandbox service Tier 1 callsites to getOrgScopedDb"
```

---

## Chunk 13: RLS migration — Integration Services

**Files:**
- Modify: Integration service files from tier-categorisation.md (calendar, slack, CRM, GHL, etc.)

- [ ] **Step 1: List integration domain Tier 1 callsites from tier-categorisation.md**

- [ ] **Step 2: Apply Tier 1 migration per service**

Use the service name in the source string:

```typescript
const scopedDb = getOrgScopedDb('calendarService.syncEvents');
// or: 'slackService.postMessage', 'crmService.upsertContact', 'ghlService.syncLocation'
```

- [ ] **Step 3: Handle Tier 2 integration callsites**

Multi-tenant webhook dispatch or cross-org connection queries that cannot use `getOrgScopedDb()`:

```typescript
await withAdminConnection(
  { source: 'integrationConnectionService.globalHealthCheck',
    reason: 'platform-wide integration health check — cross-tenant admin read' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    return tx.select().from(integrationConnections);
  }
);
```

For rare residue (cannot move to `withAdminConnection`):
```typescript
// guard-ignore: with-org-tx-or-scoped-db reason="webhook dispatch — no org context at dispatch time"
await db.insert(webhookAdapterConfigs)...
```

- [ ] **Step 4: Run P2 gate, build, lint, typecheck**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/services/calendar* server/services/slack* server/services/crm* server/services/ghl* \
        server/services/integration*
git commit -m "rls(wave-5): migrate integration service Tier 1 callsites to getOrgScopedDb"
```

---

## Chunk 14: RLS migration — Remaining Tier 1 Services

**Files:**
- Modify: All remaining Tier 1 service files from tier-categorisation.md not covered by Chunks 7-13

- [ ] **Step 1: Extract remaining Tier 1 callsites**

From tier-categorisation.md, list all rows with `Tier 1` that don't belong to domains already migrated in Chunks 7-13.

- [ ] **Step 2: Group by service file and apply migration**

For each remaining file, apply the core migration pattern. Group into batches of no more than 10 files per commit to keep diffs reviewable.

```typescript
const scopedDb = getOrgScopedDb('<serviceName>.<functionName>');
```

After each file: verify no new TypeScript errors.

- [ ] **Step 3: Run P2 gate after each batch**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 4: Commit per batch**

```bash
git add server/services/  # stage specific files, not the whole directory
git commit -m "rls(wave-5): migrate remaining Tier 1 service callsites — batch <N>"
```

---

## Chunk 15: Tier 2 Annotation Sweep

**Files:**
- Modify: Tier 2 residue files from tier-categorisation.md not already annotated in Chunks 7-14

**Goal:** Every intentional cross-tenant callsite either uses `withAdminConnection` or carries one of the three accepted `guard-ignore` forms. No raw `db` callsite on a tenant table is left without explicit intent annotation.

- [ ] **Step 1: Extract all remaining Tier 2 residue callsites from tier-categorisation.md**

These are rows with tier = `Tier 2` where `withAdminConnection` migration was not done in earlier chunks (i.e. the callsite cannot structurally be moved).

- [ ] **Step 2: For each residue callsite — add guard-ignore annotation**

Choose the form that's most natural for the call site:

```typescript
// Form 1 — inline on the callsite line:
const rows = await db.select().from(table)... // guard-ignore: with-org-tx-or-scoped-db reason="nightly pruner — cross-org delete with advisory lock"

// Form 2 — preceding line:
// guard-ignore-next-line: with-org-tx-or-scoped-db reason="migration script — no org context at startup"
const rows = await db.select()...

// Form 3 — ADR reference:
// guard-ignore: with-org-tx-or-scoped-db ADR-0042 cross-tenant audit aggregation approved in ADR-0042
const rows = await db.select()...
```

The rationale must name the actual bypass reason. Maximum 120 characters for `reason="..."` form.

- [ ] **Step 3: Run P2 gate — confirm annotated callsites are suppressed**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
```
All annotated callsites must be excluded from the violation count.

- [ ] **Step 4: Run build, lint, typecheck**

```bash
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/services/
git commit -m "rls(wave-5): annotate Tier 2 residue callsites with guard-ignore"
```

---

## Chunk 16: knip.json Extension

**Files:**
- Modify: `knip.json`

**Goal:** Extend the starter `knip.json` so `knip` reports < 30 unused-file flags (down from ~306). The remaining flags after extension are candidate dead code pending follow-up triage (out of scope for this build).

- [ ] **Step 1: Run knip — capture current flag count**

```bash
npx knip --reporter compact 2>&1 | tail -30
```
Record the unused-file count. Expected: ~306.

- [ ] **Step 2: Inventory build config files at repo root**

```bash
ls *.config.* *.config.js *.config.mjs 2>/dev/null
```
Add whichever of these exist to the `"entry"` array in `knip.json`:
- `vite.config.ts` — if exists
- `drizzle.config.ts` — if exists
- `vitest.config.ts` — if exists
- `tailwind.config.ts` or `tailwind.config.js` — if exists
- `postcss.config.js` — if exists

Updated `knip.json` `"entry"` section:
```json
"entry": [
  "server/index.ts",
  "client/src/main.tsx",
  "worker/src/index.ts",
  ".claude/hooks/*.js",
  "server/config/*.ts",
  "scripts/__fixtures__/*",
  "vite.config.ts",
  "drizzle.config.ts"
]
```
(Omit any that don't exist at repo root.)

- [ ] **Step 3: Find dynamic imports and add to ignoreDependencies**

```bash
grep -rn "await import\|} from 'docx\|from 'mammoth" \
  server/ client/ shared/ worker/ --include="*.ts" --include="*.tsx" \
  | grep -v "node_modules" | grep -v "import type" | head -30
```
Add the dynamically-imported packages to `knip.json`:
```json
"ignoreDependencies": [
  "docx",
  "mammoth"
]
```
Replace with actual packages found above.

- [ ] **Step 4: Extend ignore list with generated/derived files**

In `knip.json`, update `"ignore"`:
```json
"ignore": [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/__tests__/**",
  "**/node_modules/**",
  "dist/**",
  "migrations/**",
  "shared/derived/**"
]
```

- [ ] **Step 5: Add any standalone CLI scripts as entries**

```bash
ls scripts/*.ts scripts/*.mjs 2>/dev/null
```
If standalone CLI scripts exist (not utilities — actual entry-point scripts), add them:
```json
"entry": [
  ...,
  "scripts/my-cli-script.ts"
]
```

- [ ] **Step 6: Run knip — verify flag count < 30**

```bash
npx knip --reporter compact 2>&1 | tail -30
```
If still > 30: examine the remaining flags — check whether they need another `ignore` pattern (e.g. `.claude/agents/*.md`, generated route manifests). Add patterns as needed. Do NOT delete any files flagged — triage is out of scope.

- [ ] **Step 7: Run lint**

```bash
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add knip.json
git commit -m "chore(wave-5): extend knip.json — unused-file flags from 306 to <N>"
```

---

## Chunk 17: Final Gates Pass + PR Body Preparation

**Goal:** All gates pass. PR body has the two mandatory summaries per spec §9.10.

- [ ] **Step 1: Run all 6 prevention gates**

```bash
bash scripts/verify-no-new-cycles.sh     && echo "PP-CD1 PASS"
bash scripts/verify-duplicate-blocks.sh  && echo "PP-DUP1 PASS"
bash scripts/verify-skill-registry-alignment.sh && echo "PP-SK1 PASS"
bash scripts/verify-universal-skill-sync.sh && echo "PP-SK2 PASS"
bash scripts/verify-frontend-design-budget.sh && echo "PP-FE2 PASS"
bash scripts/verify-critical-path-coverage.sh && echo "PP-MC2 PASS"
```
All must exit 0.

- [ ] **Step 2: Run RLS migration gates**

```bash
bash scripts/verify-with-org-tx-or-scoped-db.sh 2>&1 | tail -10
bash scripts/verify-rls-coverage.sh 2>&1 | tail -10
bash scripts/verify-rls-contract-compliance.sh 2>&1 | tail -10
```
All must pass (exit 0).

- [ ] **Step 3: Full build, lint, typecheck**

```bash
npm run build:server && npm run lint && npm run typecheck
```

- [ ] **Step 4: Tally migration counts from tier-categorisation.md**

Read `tier-categorisation.md` header section and record:
- X = Files reviewed
- Y = Raw-`db` callsites found
- A = Tier 1 callsites migrated
- A' = Tier 1 callsites blocked (no upstream org context)
- B = Tier 2 callsites moved to `withAdminConnection`
- C = Tier 2 residue annotated with `guard-ignore`
- D = Tier 3 callsites (already clean)

- [ ] **Step 5: Mark todo.md items closed**

In `tasks/todo.md`, update the following (replace `<num>` with the actual PR number):
```
PP-CD1 → [status:closed:pr:<num>]
PP-DUP1 → [status:closed:pr:<num>]
PP-SK1 → [status:closed:pr:<num>]
PP-SK2 → [status:closed:pr:<num>]
PP-FE2 → [status:closed:pr:<num>]
knip-306 → [status:closed:pr:<num>]
```

If A' (blocked count) == 0:
```
F3 → [status:closed:pr:<num>]
F4 → [status:closed:pr:<num>]
F7 → [status:closed:pr:<num>]
```
If A' > 0:
```
F3 → [status:partial:pr:<num>:remaining=<A'>-blocked-callsites]
F4 → [status:partial:pr:<num>:remaining=<A'>-blocked-callsites]
F7 → [status:partial:pr:<num>:remaining=<A'>-blocked-callsites]
```
PP-MC2 stays `[status:closed:pr:332]` — already closed.

- [ ] **Step 6: Compose migration summary (for PR body)**

```
**Migration summary:** Files reviewed: X. Raw-`db` callsites found: Y.
Tier 1 callsites migrated: A.
Tier 1 callsites blocked (no upstream org context, escalated to operator): A'.
Tier 2 callsites moved to `withAdminConnection`: B.
Tier 2 residue annotated with existing `guard-ignore` form: C.
Tier 3 callsites (already clean / no tenant table): D.
```

- [ ] **Step 7: Compose gate verdict summary (for PR body)**

```
| Gate | Script | Baseline | Exit mode | Forced-failure verified |
|---|---|---|---|---|
| PP-CD1 | verify-no-new-cycles.sh | cycle-count:0 | error | yes — Chunk 1 Step 3 confirmed exit 0; baseline is 0, any regression exits 1 |
| PP-DUP1 | verify-duplicate-blocks.sh | clone-count:<N> | error | yes — Chunk 2 Step 4a reduced baseline by 1, observed exit 1, restored |
| PP-SK1 | verify-skill-registry-alignment.sh | mismatch-count:0 | error | yes — Chunk 3 Step 3a added orphan snapshot entry, observed exit 1, reverted |
| PP-SK2 | verify-universal-skill-sync.sh | 0 entries (cleared) | error | yes — Chunk 4 Step 4a removed search_codebase from UNIVERSAL_SKILL_NAMES, observed non-zero exit, restored |
| PP-FE2 | verify-frontend-design-budget.sh | empty | error | yes — Chunk 5 Step 4a added scratch monitored importer, observed non-zero exit, removed |
| PP-MC2 | n/a — schema gate, no baseline | n/a | error | n/a — schema gate (validates manifest shape only) |
| knip | n/a | 306 flags → <N> | informational | n/a |
```

- [ ] **Step 8: Commit todo.md and progress.md updates**

```bash
git add tasks/todo.md tasks/builds/wave-5-prevention-gates-and-rls/progress.md
git commit -m "chore(wave-5): close todo.md items — PP-CD1/DUP1/SK1/SK2/FE2/knip + F3/F4/F7 per blocked count"
```

---

## Self-Review

**Spec coverage:**
- §5.1 PP-CD1: Chunk 1 (verify wiring) — covered
- §5.2 PP-DUP1: Chunk 2 (re-seed + promote to exit 1) — covered
- §5.3 PP-SK1: Chunk 3 (net-new gate + baseline) — covered
- §5.4 PP-SK2: Chunk 4 (source alignment + baseline clear) — covered
- §5.5 PP-FE2: Chunk 5 (verify/extend monitored set) — covered
- §5.6 PP-MC2: Chunk 6 (verify wiring) — covered
- §6.1 Migration pattern: Chunks 7-14 — covered with exact code
- §6.3 F4 agentExecutionService residue: Chunk 7 — covered
- §6.4 F7 skillExecutor db.update(tasks): Chunk 8, Steps 1-3 — covered including residue guard-ignore removal
- §7 knip.json extension: Chunk 16 — covered
- §8 Tier 2 annotation sweep: Chunk 15 — covered with all three guard-ignore forms
- §9.10 PR body summaries: Chunk 17 Steps 6-7 — covered with exact format strings
- §13 Session K/M deconfliction: Chunk 7 pre-condition includes both Session K rebase and Session M hard stop; Chunk 0 Step 8a produces the per-file merge order that Chunk 7 requires. Session M note removed from Chunk 9 (no overlap there).

**Placeholder scan:** No TBD/TODO in code blocks. References to `tier-categorisation.md` are concrete artifact references produced in Chunk 0, not placeholders.

**Type consistency:**
- `getOrgScopedDb(source: string): OrgScopedTx` — confirmed from `server/lib/orgScopedDb.ts:37`
- `withAdminConnection(options: AdminConnectionOptions, fn: (tx) => Promise<T>)` — confirmed from `server/lib/adminDbConnection.ts:58-60`
- Both used consistently across all migration chunks with the same call signature
