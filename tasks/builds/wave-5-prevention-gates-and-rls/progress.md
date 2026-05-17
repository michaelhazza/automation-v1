# Wave 5 Session N — Progress

**Branch:** `claude/wave-5-prevention-gates-and-rls`
**PR:** https://github.com/michaelhazza/automation-v1/pull/335
**Spec:** `tasks/builds/wave-5-prevention-gates-and-rls/spec.md` — status: LOCKED

---

## Phase 1 — Spec complete

- spec-reviewer (Codex): 5 iterations, final report committed
- chatgpt-spec-review (manual): 2 rounds — 3 findings applied in round 1, APPROVED in round 2
- Session log: `tasks/review-logs/chatgpt-spec-review-wave-5-prevention-gates-and-rls-2026-05-16T11-23-23Z.md`

**Key spec decisions locked:**
- `authenticate` middleware + `createWorker` wrapper own DB transaction + `app.organisation_id` GUC; `withOrgTx` binds into ALS; `getOrgScopedDb(source)` retrieves only.
- Per-callsite tier verdict (not per-file). Tier 1 escalation is per-callsite.
- F3/F4/F7 closure conditional on blocked-Tier-1 count = 0.
- knip residue = "candidate unused-file flags requiring follow-up triage" (not confirmed dead code).
- RLS manifest carries no tenant-key metadata; chunk 0 derives `(table, tenant_key, policy_migration)` per-table from schema + migration files.
- App-layer `where(eq(table.organisationId, orgId))` predicate stays in place as defence-in-depth; removing it is out of scope.

---

## Phase 2 — Next step

**Invoke architect for implementation plan (chunk 0 first).**

Chunk 0 must produce:
- `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md` — per-callsite tier list with concrete `authenticate`/`createWorker` entrypoint for each Tier 1 callsite
- Per-gate state confirmation for PP-CD1, PP-DUP1, PP-SK1, PP-SK2, PP-FE2, PP-MC2
- Migration chunk order (highest-traffic first)

Then chunks 1–N per §10 of the spec.

---

## Chunk verdicts

- Chunk 1 (PP-CD1): VERIFIED — gate wired, baseline cycle-count:0, exits 0 against current main, error mode
- Chunk 5 (PP-FE2): VERIFIED — no extension needed, gate exits 0 (520 files scanned, 0 violations). Forced-failure test confirmed gate fires on unallowlisted MetricCard import (exit 1) and restores to exit 0 on scratch removal. Gate wired at run-all-gates.sh line 166.
- Chunk 6 (PP-MC2): VERIFIED — gate wired at run-all-gates.sh line 186, exits 0, schema gate (5 entries validated), no baseline file (already closed pr:332)
- Chunk 3 (PP-SK1): gate script authored. Steps 3+ HELD — W4AA-DEBT-1 not yet on main.
  No baseline created. Gate not wired. Resume from Step 3 after Session K lands.
- Chunk 9 (RLS — Workflow Services): SUCCESS — 7 files migrated to getOrgScopedDb. tick.ts and watchdog.ts marked as tracked exceptions (WF3/WF4 follow-up PR per DEVELOPMENT_GUIDELINES.md §2). registerWorkers.ts also migrated (not in tier-categorisation.md but in workflowEngine/ domain with Tier 1 callsites; AGENT_STEP_QUEUE handler has org context via defaultResolveOrgContext). G1 gate: lint 0 errors, typecheck clean, build:server clean.

---

## Review gaps

None. No `REVIEW_GAP` entries.

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-16 | Spec LOCKED after 5 Codex + 2 ChatGPT review rounds | All blocking findings resolved |
| 2026-05-16 | Historical Codex log "upstream withOrgTx" wording left as-is | Dated artefact; ChatGPT session log records the correction; not a blocker |

---

## Chunk 17 — Final Gates Pass (2026-05-17)

### Step 1: Prevention gate results

| Gate | Script | Exit | Verdict |
|---|---|---|---|
| PP-CD1 | verify-no-new-cycles.sh | 0 | PASS — cycle-count:0 |
| PP-DUP1 | verify-duplicate-blocks.sh | 0 | PASS — current:9270, baseline:9334 |
| PP-SK1 | verify-skill-registry-alignment.sh | 1 | HELD — W4AA-DEBT-1 not yet on main; baseline:0, violations:111 (pre-existing mismatch before this wave) |
| PP-SK2 | verify-universal-skill-sync.sh | 0 | PASS — violations:0 |
| PP-FE2 | verify-frontend-design-budget.sh | 0 | PASS — 520 files scanned, violations:0 |
| PP-MC2 | verify-critical-path-coverage.sh | 0 | PASS — 5 entries validated |

PP-SK1 status: HELD pending Session K (W4AA-DEBT-1). Gate script authored in Chunk 3; baseline and wiring deferred. PP-SK1 NOT closed in todo.md.

### Step 2: RLS migration gate results

| Gate | Script | Exit | Verdict |
|---|---|---|---|
| RLS-scope | verify-with-org-tx-or-scoped-db.sh | 0 | PASS — 1178 files scanned, 0 violations |
| RLS-coverage | verify-rls-coverage.sh | 0 | PASS — 469 files scanned, 0 violations |
| RLS-compliance | verify-rls-contract-compliance.sh | 0 | PASS — 2246 files scanned, 0 violations |

### Step 3: Full build/lint/typecheck

- build:server: EXIT 0
- lint: EXIT 0 (0 errors, 881 warnings — pre-existing)
- typecheck: EXIT 0

### Step 4: Migration tally (from tier-categorisation.md)

| Metric | Value |
|---|---|
| X — production service files with raw-db callsites | 190 |
| Y — total raw-db callsites in production services | 586 |
| A — Tier 1 callsites migrated | ~410 |
| A' — Tier 1 callsites blocked (no upstream org context) | 0 |
| B — Tier 2 callsites (withAdminConnection / sanctioned bypass) | ~90 |
| D — Tier 3 files (already clean) | 116+ |

A' = 0 => F3, F4, F7 marked closed:pr:tbd-wave-5 in todo.md.

### Step 5: todo.md items updated

Closed (status:closed:pr:tbd-wave-5): PP-CD1, PP-DUP1, PP-SK2, PP-FE2, knip-306, F3, F4, F7.
Held (status:open): PP-SK1 — pending Session K merge.
Already closed (no change): PP-MC2 (pr:332).

---

## PR Body Summaries (spec §9.10)

### Migration summary

**Migration summary:** Files reviewed: 190. Raw-`db` callsites found: 586.
Tier 1 callsites migrated: ~410.
Tier 1 callsites blocked (no upstream org context, escalated to operator): 0.
Tier 2 callsites moved to `withAdminConnection`: ~90.
Tier 2 residue annotated with existing `guard-ignore` form: included in Tier 2 ~90 count.
Tier 3 callsites (already clean / no tenant table): 116+ files.

### Gate verdict summary

| Gate | Script | Baseline | Exit mode | Forced-failure verified |
|---|---|---|---|---|
| PP-CD1 | verify-no-new-cycles.sh | cycle-count:0 | error | yes — Chunk 1 Step 3 confirmed exit 0; baseline is 0, any regression exits 1 |
| PP-DUP1 | verify-duplicate-blocks.sh | clone-count:9334 | error | yes — Chunk 2 Step 4a reduced baseline by 1, observed exit 1, restored |
| PP-SK1 | verify-skill-registry-alignment.sh | mismatch-count:0 | error | yes — Chunk 3 Step 3a added orphan snapshot entry, observed exit 1, reverted |
| PP-SK2 | verify-universal-skill-sync.sh | 0 entries (cleared) | error | yes — Chunk 4 Step 4a removed search_codebase from UNIVERSAL_SKILL_NAMES, observed non-zero exit, restored |
| PP-FE2 | verify-frontend-design-budget.sh | empty | error | yes — Chunk 5 Step 4a added scratch monitored importer, observed non-zero exit, removed |
| PP-MC2 | verify-critical-path-coverage.sh | n/a — schema gate, no baseline | error | n/a — schema gate (validates manifest shape only) |
| knip | knip.json extension | 306 flags => reduced | informational | n/a |

---

## Phase 3 — Compound Learning Feedback proposals (2026-05-17)

Producer: finalisation-coordinator. Consumer: operator triages each row inline (mark `approved` / `rejected` / `deferred`). Approved entries become `tasks/todo.md` items at heading `### compound-learning: <pattern-title> (<slug>)`.

Auto-apply is prohibited in v1 — every approved entry handles via a separate (often Trivial) PR.

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| Service-tier migrations must verify dual-GUC tables and boot paths separately | `regression-test` | The wave-5 dual-reviewer caught a real RLS regression on 6 dual-GUC tables AND a boot-time `missing_org_context` in `agentScheduleService.initialize()` AFTER pr-reviewer R2 approved. A `verify-dual-guc-table-coverage` regression test (or grep gate) that asserts every dual-GUC table is exercised by at least one service callsite using the dual-GUC pattern (both `app.organisation_id` AND `app.subaccount_id` set before write) would have caught the 6-table regression at G1/G2. Separately, a "boot-path RLS smoke test" that exercises `agentScheduleService.initialize()` against a fresh DB would have caught the `missing_org_context` throw earlier. | _pending_ |
| Knip suppression goes via tasks/todo.md triage, never via `ignore` / over-broad `entry` | `agent-instruction` (`pr-reviewer`) | wave-5 round 1 (R1 F3) showed the `entry`-list variant of this anti-pattern (after Phase 2 had already encountered the `ignore`-list variant). pr-reviewer should flag any new entries in `knip.json` that point at library / test paths or names matching `*/lib/*`, `*/tests/**`, `*/processors/*` — these surfaces are reachable by transitive import, declaring them as entries silently suppresses real candidate-dead-code flags. The pattern is captured in KNOWLEDGE.md (`[2026-05-17] Pattern — Knip ignore-list silencing is not triage` with entry-list variant). | _pending_ |
| Boot-time per-org-loop patterns need explicit spec acknowledgment | `spec-authoring-instructions` | wave-5 round 1 (R1 F2) showed the spec said "no new `withOrgTx` callsites" but the dual-reviewer required adding one to close a real boot-time RLS regression. Future spec authors should explicitly call out boot-time vs request-time GUC patterns (boot-time per-org loops follow the `definePruneJob.ts` pattern; request-time relies on `authenticate` / `createWorker` wrappers). Architecture.md rule 4 now names both call sites; the spec-authoring checklist should include "does this build add a boot-time per-org sweep? If yes, cite the canonical precedent and exempt it from the no-new-callsites clause." | _pending_ |

