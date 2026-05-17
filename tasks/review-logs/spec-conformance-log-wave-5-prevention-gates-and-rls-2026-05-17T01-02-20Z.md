# Spec Conformance Log

**Spec:** `tasks/builds/wave-5-prevention-gates-and-rls/spec.md`
**Spec commit at check:** `656cbce232af60009d37800ae299f29691caf04e`
**Branch:** `claude/wave-5-prevention-gates-and-rls`
**Base:** `8c51aa65e79deef3265d1997eb81da3e977c7e55`
**Scope:** all-of-spec (Major-class build; caller confirmed full spec coverage)
**Changed-code set:** 130 source files (162 total inc. docs, baselines, review logs)
**Run at:** 2026-05-17T01:02:20Z

---

## Summary

- Requirements extracted:     22
- PASS:                       21
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (REQ #4 — PP-SK1 baseline/wiring, explicitly held pending Session K W4AA-DEBT-1 per spec §13)

**Verdict:** CONFORMANT

The implementation satisfies every concrete, named requirement in the spec that is in scope for this build. The single OUT_OF_SCOPE item (PP-SK1 baseline seeding and `run-all-gates` wiring) is explicitly deferred by spec §13 until Session K's orphan-resolution work merges. The PP-SK1 gate script itself was authored as required; only its activation (baseline file + run-all-gates wiring) is held — exactly what the spec describes.

No mechanical fixes applied. No directional gaps routed.

---

## Requirements extracted (full checklist)

| REQ | Section | Category | Requirement | Verdict |
|---|---|---|---|---|
| #1 | §5.1 | config | `verify-no-new-cycles.sh` wired in `run-all-gates`, baseline cycle-count:0, error mode | PASS |
| #2 | §5.2 | config | `duplicate-blocks.txt` re-seeded post-Wave-4; gate promoted to exit-1; wired | PASS |
| #3 | §5.3 | file | Net-new gate script `verify-skill-registry-alignment.sh` authored | PASS |
| #4 | §5.3 | config | PP-SK1 baseline seeded at mismatch-count:0 + wired into `run-all-gates` | OUT_OF_SCOPE |
| #5 | §5.4 | behavior | Two grandfathered `universal-skill-sync.txt` entries resolved; baseline cleared | PASS |
| #6 | §5.5 | behavior | PP-FE2 monitored set covers complexity budget doc; gate passes | PASS |
| #7 | §5.6 | config | PP-MC2 gate wired and passing | PASS |
| #8 | §8, §10 | file | `tier-categorisation.md` artifact produced with per-callsite verdicts | PASS |
| #9 | §6.1/6.3/6.4/9.2 | behavior | All Tier 1 callsites with verified upstream entrypoint migrated to `getOrgScopedDb` | PASS |
| #10 | §9.2, §9.9 | behavior | Tier 1 blocked count = 0; F3/F4/F7 closure unblocked | PASS |
| #11 | §8/§9.3 | behavior | Tier 2 callsites moved to `withAdminConnection` or annotated with `guard-ignore` | PASS |
| #12 | §9.4 | behavior | `verify-with-org-tx-or-scoped-db.sh` continues to pass | PASS (per progress.md; CI-only) |
| #13 | §7, §9.5 | config | `knip.json` extended; unused-file flags < 30 | PASS (0 flags reported) |
| #14 | §9.6 | behavior | `npm run build:server` exits 0 | PASS (per progress.md) |
| #15 | §9.7 | behavior | `npm run lint` exits 0 | PASS (locally re-verified) |
| #16 | §9.8 | behavior | All listed static gates pass | PASS (per progress.md; CI-only) |
| #17 | §9.9 | docs | `tasks/todo.md` items closed per spec rule; PP-SK1 remains open per §13 deferral | PASS |
| #18 | §9.10 | docs | PR body migration + gate verdict summaries | PASS (in progress.md Chunk 17) |
| #19 | §6.1 | behavior | App-layer `organisationId` predicate retained as defence-in-depth | PASS |
| #20 | §3, §6.1 | behavior | No new `withOrgTx` callsites; no primitive implementation changes | PASS |
| #21 | §5.4 | export | `search_codebase` added to `UNIVERSAL_SKILL_NAMES` | PASS |
| #22 | §5.4 | schema | `read_codebase` registry entry has `isUniversal: true` | PASS |

---

## Detailed verification notes per REQ

### REQ #1 — PP-CD1 (PASS)
`scripts/run-all-gates.sh:159` calls `verify-no-new-cycles.sh`. Baseline `scripts/.gate-baselines/circular-deps.txt` unchanged on branch (already `cycle-count:0` from Wave 4). Progress.md Chunk 1 records VERIFIED.

### REQ #2 — PP-DUP1 (PASS)
`scripts/.gate-baselines/duplicate-blocks.txt` re-seeded to `clone-count:9334`, expires 2027-05-16. `scripts/verify-duplicate-blocks.sh` promoted to exit 1 for regression (line 9, comment line 6 documents the promotion). Wired at `run-all-gates.sh:160`. Forced-failure verification recorded in progress.md Chunk 2.

### REQ #3 — PP-SK1 script (PASS)
`scripts/verify-skill-registry-alignment.sh` exists. Implements the spec's symmetric-set check: reads `scripts/snapshots/action-registry.snapshot.json`, walks `server/skills/**/*.md` excluding `README.md` and `__tests__/**`, applies the X.Y ↔ X_Y filename rule, emits violations both directions. Forced-failure test recorded in progress.md Chunk 3.

### REQ #4 — PP-SK1 baseline + wiring (OUT_OF_SCOPE)
Spec §13 explicit deferral: *"if W4AA-DEBT-1 slips, PP-SK1's chunk is reordered to land after K's merge."* Progress.md Chunk 3: "PP-SK1: gate script authored. Steps 3+ HELD — W4AA-DEBT-1 not yet on main." `scripts/.gate-baselines/skill-registry-alignment.txt` intentionally does not exist; the gate is intentionally absent from `run-all-gates.sh`; the PP-SK1 row in `tasks/todo.md` correctly remains `[status:open]`. This matches spec §9.9 conditional-closure semantics.

### REQ #5 — PP-SK2 (PASS)
`server/config/universalSkills.ts:25` includes `'search_codebase'`. `scripts/snapshots/action-registry.snapshot.json:5994` adds `"isUniversal": true` for `read_codebase`. `server/config/actionRegistry/core.ts:543` adds the matching canonical-registry field. `scripts/.gate-baselines/universal-skill-sync.txt` contains only header comments (no grandfathered entries remain).

### REQ #6 — PP-FE2 (PASS)
`docs/frontend-design-principles.md § Complexity budget per screen` lists element categories (KPI tiles, Charts, Panels, Sidebar cards) — it does NOT name specific component literals beyond the existing MONITORED_COMPONENTS array. No extension needed per spec §5.5 conditional language. `scripts/verify-frontend-design-budget.sh:65` MONITORED_COMPONENTS unchanged. Progress.md Chunk 5: "PP-FE2: VERIFIED — no extension needed, gate exits 0 (520 files scanned, 0 violations)."

### REQ #7 — PP-MC2 (PASS)
`run-all-gates.sh:186` calls `verify-critical-path-coverage.sh`. Schema gate; no baseline file (correct per spec §5.6). Progress.md Chunk 6 records VERIFIED with 5 manifest entries validated.

### REQ #8 — tier-categorisation.md (PASS)
File present at `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md`. Contains summary counts, per-callsite table (`file:line | callsite | table | tenant_key | policy_migration | tier | upstream entrypoint`), gate-state pre-build, Session M deconfliction, ea_drafts/voice_profiles GUC derivation per spec §6.1 manifest-derivation rule, migration chunk order, P2 gate baseline.

### REQ #9 — Tier 1 migrations (PASS)
Sampled migrations confirm the documented pattern:
- `server/services/agentExecutionService.ts` — `db` import replaced with `getOrgScopedDb`; multiple call sites use `getOrgScopedDb('agentExecutionService.<fn>')` with `organisationId` predicates preserved.
- `server/services/voiceProfile/voiceProfileService.ts` — all `db.*` calls migrated; `db` import removed.
- `server/services/eaDrafts/eaDraftService.ts` — all Tier 1 calls migrated; `withAdminConnection` retained for the existing cross-tenant lookup.
- `server/services/workflowEngine/contextHelpers.ts`, `definitionHelpers.ts`, `queueLifecycle/*.ts`, `readySet.ts`, `stepLifecycle.ts` — all migrated.
- `server/services/skillExecutor/pipeline.ts` (F7) — `db` import removed; migrations applied to `enqueueHandoff` and the inner transaction.
- `server/services/integrationConnectionService.ts` (17 callsites) — migrated, with `withAdminConnection` retained for sanctioned bypasses.
- `server/services/auditService.ts` — single Tier 1 callsite migrated; `db` import removed.
- 35 service files had their `db` import fully removed; many more migrated in mixed-posture files with `db` retained for documented Tier 2 residue.
- Source string convention `'<callerName>.<functionName>'` observed throughout.

### REQ #10 — Tier 1 blocked count = 0 (PASS)
Progress.md Chunk 17 Step 4: `A' — Tier 1 callsites blocked (no upstream org context) = 0`. F3, F4, F7 marked `[status:closed:pr:tbd-wave-5]` in `tasks/todo.md`, consistent with spec §9.9 conditional-closure rule.

### REQ #11 — Tier 2 migrations + annotations (PASS)
- `server/services/agentExecutionService/runLifecycle/prepare.ts:43` — migrated to `withAdminConnection({ source: 'prepare.prepareRun', reason: '...' }, ...)` with explicit `await tx.execute(sql\`SET LOCAL ROLE admin_role\`)` per spec §4 contract.
- `server/services/configUpdateOrganisationService.ts` — 7 `guard-ignore-next-line: with-org-tx-or-scoped-db reason="..."` annotations on residue callsites (config-agent worker; no GUC context).
- `server/services/userService.ts` — 20 `guard-ignore` annotations on bootstrap/identity callsites where org context is the *result* of the lookup, not yet known (spec §4 third accepted form).
- Total `guard-ignore.*with-org-tx-or-scoped-db` annotations across `server/services/`: 175.
- All annotations carry a `reason="..."` rationale.

### REQ #12 — P2 gate passes (PASS via progress.md)
Progress.md Chunk 17 Step 2: `verify-with-org-tx-or-scoped-db.sh` — EXIT 0, 1178 files scanned, 0 violations. Not re-run locally (CI-only per CLAUDE.md § "Test gates are CI-only"). `scripts/lib/with-org-tx-analyser.mjs` is unchanged in the changed-code set — analyser semantics preserved per spec §3 and §9.4.

### REQ #13 — knip < 30 (PASS)
`knip.json` extended: added `vite.config.ts`, `drizzle.config.ts`, `vitest.config.ts`, expanded the `entry` array to cover `scripts/*.ts`, `scripts/*.mjs`, `scripts/gates/*.mjs`, `scripts/lib/*`, `scripts/migrations/*`, `server/jobs/*`, `server/routes/*`, `server/workflows/*`, `server/processors/*`, `server/scripts/*`, `server/tests/**`, `worker/src/browser/*`, `worker/src/persistence/*`, `worker/src/lib/*`; expanded `ignore` to cover `shared/derived/**`, known false-positive components/pages, and `ignoreDependencies` for dev-only packages. Local `npx knip --reporter json` produced 0 unused-file flags (well below the < 30 threshold). Progress.md PR body: "unused-file flags from 249 to 0".

### REQ #14 — build:server exits 0 (PASS via progress.md)
Progress.md Chunk 17 Step 3: `build:server EXIT 0`.

### REQ #15 — lint exits 0 (PASS verified locally)
`npm run lint` re-run during this audit: 0 errors, 881 warnings (all pre-existing per progress.md). Typecheck also re-run: exits 0.

### REQ #16 — Static gates pass (PASS via progress.md)
Progress.md Chunk 17 Step 2 records EXIT 0 for: `verify-with-org-tx-or-scoped-db.sh` (0 violations), `verify-rls-coverage.sh` (0 violations), `verify-rls-contract-compliance.sh` (0 violations), plus all 5 wired prevention gates (PP-CD1, PP-DUP1, PP-SK2, PP-FE2, PP-MC2). PP-SK1 is HELD per spec §13 — its absence from `run-all-gates` is intentional, not a regression.

### REQ #17 — todo.md items closed (PASS)
Verified via diff against origin/main:
- PP-CD1, PP-DUP1, PP-SK2, PP-FE2, knip-306 → `[status:closed:pr:tbd-wave-5]`
- F3, F4, F7 → `[status:closed:pr:tbd-wave-5]` (consistent with blocked count = 0 per §9.9 conditional-closure)
- PP-MC2 → unchanged (`[status:closed:pr:332]`)
- PP-SK1 → `[status:open]` (correct per spec §13 deferral)

### REQ #18 — PR body summaries (PASS)
Progress.md Chunk 17 includes both required summaries:
- **Migration summary** with X=190 files reviewed, Y=586 callsites, A=~410 Tier 1 migrated, A'=0 blocked, B=~90 Tier 2, D=116+ Tier 3.
- **Gate verdict summary** table with one row per gate, listing script path, baseline path, exit mode, and forced-failure verification note. Knip flag-count before/after row included.

### REQ #19 — organisationId predicate retained (PASS)
Spot-checked diffs for `eaDraftService.listDrafts`, `eaDraftService.claimSend`, `integrationConnectionService.listOrgConnections`, `agentExecutionService.startRunAsync`, `voiceProfileService.deriveProfile`, `agentExecutionLoop`, `auditService` — all retain `eq(table.organisationId, ctx.organisationId)` / `eq(table.organisationId, orgId)` in their WHERE clauses post-migration.

### REQ #20 — No new primitives / withOrgTx callsites (PASS)
`git diff origin/main...HEAD --unified=0 -- 'server/services/**/*.ts' | grep '^+' | grep 'withOrgTx('` returns zero lines. `server/lib/orgScopedDb.ts`, `server/lib/adminDbConnection.ts`, and `scripts/lib/with-org-tx-analyser.mjs` are NOT in the changed-code set — implementations preserved.

### REQ #21 — search_codebase added to UNIVERSAL_SKILL_NAMES (PASS)
`server/config/universalSkills.ts:25`: `'search_codebase',      // matches isUniversal:true in ACTION_REGISTRY (PP-SK2 alignment)`.

### REQ #22 — read_codebase isUniversal: true (PASS)
`scripts/snapshots/action-registry.snapshot.json:5994` adds `"isUniversal": true` inside the `read_codebase` entry. `server/config/actionRegistry/core.ts:543` adds `isUniversal: true` to the canonical core registry entry — the snapshot is regenerated from this source.

---

## Mechanical fixes applied

None. Every requirement either PASSed or was explicitly out-of-scope per the spec's own deferral rule.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None.

---

## Files modified by this run

None (no mechanical fixes applied; this run only emits the review log).

---

## Next step

**CONFORMANT** — no gaps. Proceed to `pr-reviewer`.

### PP-SK1 follow-up reminder (not a gap)

The PP-SK1 baseline file and `run-all-gates` wiring are explicitly held pending Session K's W4AA-DEBT-1 merge. The implementation correctly stops at the script-authoring step. When Session K lands:
1. Run `scripts/verify-skill-registry-alignment.sh` to confirm mismatch count is 0 against the post-K codebase.
2. Create `scripts/.gate-baselines/skill-registry-alignment.txt` with `mismatch-count:0`.
3. Append the gate to `scripts/run-all-gates.sh` under the "Wave 5 Session N prevention gates" header (plan.md Chunk 3 Step 5).
4. Update the `tasks/todo.md` PP-SK1 row from `[status:open]` to `[status:closed:pr:<num>]`.

This follow-up does NOT block merge of the current PR — it is a planned cross-session sequencing handoff, not a conformance gap.
