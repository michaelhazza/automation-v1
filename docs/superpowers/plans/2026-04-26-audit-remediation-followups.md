# Audit Remediation Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 21-item post-merge backlog from PR #196 audit-remediation review (defence-in-depth gaps, test coverage, drift guards, performance, system invariants) per `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`.

**Architecture:** Wave-by-wave delivery per spec §2 Sequencing — Wave 1 (signal foundation + cleanup) → Wave 2 (drift guards + small refactors) → Wave 3 (heavy migrations). Each item ships its own PR (or bundled into a small "drift-guards" / "trivial" PR per the §4 Definition of Done table). The spec itself is the per-item implementation guide; this plan locks orchestration, build slug structure, and the canonical "what files do I touch / what is the commit shape / what is the DoD" pointer for every item.

**Tech Stack:** TypeScript, Drizzle ORM, `node:test` via `tsx`, bash gates with `scripts/lib/guard-utils.sh`, Postgres RLS + `pg_advisory_xact_lock`, GitHub Actions (manual-trigger workflows), Claude Code hooks under `.claude/hooks/`.

---

## Contents

- [Plan-of-plans posture](#plan-of-plans-posture)
- [Pre-flight setup](#pre-flight-setup)
- [Wave 1 — Signal foundation + cleanup](#wave-1--signal-foundation--cleanup)
- [Wave 2 — Drift guards + small refactors](#wave-2--drift-guards--small-refactors)
- [Wave 3 — Heavy migrations](#wave-3--heavy-migrations)
- [F2 — Parked behind Phase-5A](#f2--parked-behind-phase-5a)
- [Closing — exit criteria + audit posture](#closing--exit-criteria--audit-posture)

---

## Plan-of-plans posture

This spec is a backlog of 21 independently-shippable items, not a single feature build. The implementation strategy:

1. **Master plan** (this document) defines Wave/PR sequencing, the canonical build slug structure, per-item file inventory, commit shape, and DoD pointer.
2. **Per-item detailed step-by-step plans** are authored at the moment an item is picked up, under `tasks/builds/audit-remediation-followups/<item-id>/plan.md` — using that item's spec section (§1 Group X, item Y) as the source of truth for Approach + Acceptance + Tests.
3. **Status** is tracked in spec §5 Tracking (single source of truth). Update on item start (☐ → ⧖) and completion (⧖ → ✓) in the same PR that ships the item.
4. **Build slug:** `audit-remediation-followups` is the parent slug; each item lives under `tasks/builds/audit-remediation-followups/<item-id>/` (e.g. `…/g2-post-merge-smoke/`, `…/a1a-principal-context-surface/`).

This split is deliberate. The spec's per-item structure (Files / Goal / Approach / Acceptance / Tests / Dependencies / Risk / DoD) already reads as a per-item implementation guide; ChatGPT review Rounds 1–4 already exhaustively tightened the per-item Approach text. Duplicating that detail here adds no signal and goes stale on every spec edit. The master plan locks orchestration; the spec locks implementation.

**Execution invariant per `CLAUDE.md`:** after this plan, proceed with `superpowers:subagent-driven-development` directly when picking up an item — do NOT prompt for execution choice.

**Cross-cutting rules from spec §0 — apply to every item:**

- §0.1 Gate quality bar (FP < 5%, deterministic, fix-time < 10 min) — applies to A1b, A2, C2, C3, D3, E2, H1.
- §0.2 No new primitives unless explicitly named — A1a/A1b add none; A2 names exactly 3 files + 1 hook; B2 reuses existing locks; F2 introduces zero new primitives; H1 names exactly 2 files.
- §0.3 No cross-item scope expansion — discovered adjacent issues route to `tasks/todo.md`, not into the active item.
- §0.4 Determinism over cleverness — explicit flags, regex with AST fallback, injected test hooks.
- §0.5 No silent success on partial execution — roll back, return structured partial-state, OR log explicit partial.
- §0.6 Default lock scope is per-org (B2 / B2-ext) unless explicitly justified otherwise in the header comment.
- §0.7 Baseline rot prevention — every PR that increases a baseline in `scripts/guard-baselines.json` carries a `Baseline increase: <guard_id> from <N> to <M>. Reason: …` line in its description.
- §4.1 Per-item integrity check — before flipping any §5 row from ⧖ to ✓: (a) all DoD conditions pass in CI, (b) no TODO/FIXME/HACK markers in the diff, (c) every new invariant has log or test trace, (d) no silent fallbacks introduced.

---

## Pre-flight setup

Run once, before any Wave 1 item starts.

**Files:**
- Create: `tasks/builds/audit-remediation-followups/progress.md`
- Modify: `tasks/current-focus.md`

- [ ] **Step 1: Create the parent build slug directory**

```bash
mkdir -p tasks/builds/audit-remediation-followups
```

- [ ] **Step 2: Initialise the parent progress log**

Create `tasks/builds/audit-remediation-followups/progress.md` with the following content:

```markdown
# Audit Remediation Follow-ups — Progress Log

**Spec:** docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
**Plan:** docs/superpowers/plans/2026-04-26-audit-remediation-followups.md

## Per-item status
See spec §5 Tracking — the single source of truth for ☐ / ⧖ / ✓ / ↗ / ✗ flips.

## Wave progress
- Wave 1 (signal foundation + cleanup): 0 / 10 items merged
- Wave 2 (drift guards + small refactors): 0 / 5 items merged
- Wave 3 (heavy migrations): 0 / 5 items merged
- F2 (parked behind Phase-5A): not started

## Decisions / observations
(append-only; one heading per item that lands a non-trivial decision)
```

- [ ] **Step 3: Update the sprint-level focus pointer**

Edit `tasks/current-focus.md` so it points at this plan + spec:

```markdown
**Active spec:** docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
**Active plan:** docs/superpowers/plans/2026-04-26-audit-remediation-followups.md
**Active build slug:** audit-remediation-followups (Wave 1)
**Last updated:** 2026-04-26
```

- [ ] **Step 4: Commit pre-flight scaffolding**

```bash
git add tasks/builds/audit-remediation-followups/progress.md tasks/current-focus.md
git commit -m "chore(audit-remediation-followups): initialise build slug + progress log"
```

Expected: clean commit, no test/lint runs needed (docs-only change).

---

## Wave 1 — Signal foundation + cleanup

Per spec §2 Sequencing: G2 → **C1 (must land before any other gate work)** → G1 → D1 / D2 / D3 → E1 / E2 → B1 / C4. Once C1 ships, the rest of Wave 1 is parallel-friendly. Total: ~1–1.5 weeks pipelined.

**Wave 1 invariant:** every gate this spec touches MUST emit `[GATE] <guard_id>: violations=<count>` from the moment it ships — that is what C1 establishes. No item in Wave 1 (or beyond) ships a gate output that lacks the standard line.

---

### Task 1.1 — G2: Post-merge smoke test runbook

**Spec section:** §1 Group G — G2 (lines 1276–1315). **Build slug:** `tasks/builds/audit-remediation-followups/g2-post-merge-smoke/`. **Risk:** zero (observational).

**Files:**
- Create: `tasks/runbooks/audit-remediation-post-merge-smoke.md`
- Modify (final step): `KNOWLEDGE.md` — append "Post-merge observations: PR #196" entry.
- Modify (final step): `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` § 5 row G2 (☐ → ✓).

- [ ] **Step 1: Author the runbook from spec §G2 Approach steps 1–7**

Translate the seven Approach steps into a numbered runbook under `tasks/runbooks/`. Mirror the verbatim wording so a future operator can re-execute. Keep it under 150 lines.

- [ ] **Step 2: Execute steps 1–3 (agent creation + automation + GHL webhook)**

Tail client + server logs in parallel. Capture step outcomes inline in the runbook execution log (a new section `## First-run output (2026-04-26)`).

- [ ] **Step 3: Execute step 4 (the four jobs)**

Per spec §G2 step 4 — `bundleUtilizationJob` (manual enqueue), `measureInterventionOutcomeJob` (manual or wait), `ruleAutoDeprecateJob` (manual), `connectorPollingSync` (observe natural cycle). Capture exit status for each.

- [ ] **Step 4: Execute steps 5–6 (log tail + LLM router metrics, 10 min each)**

Note any WARN spike, cost-per-request anomaly, retry-rate drift.

- [ ] **Step 5: Append KNOWLEDGE.md entry**

Add `## Post-merge observations: PR #196` with the seven step outcomes; flag any escalations as separate entries in `tasks/todo.md` per §G2 Acceptance criterion 3.

- [ ] **Step 6: Flip §5 Tracking row + commit**

Edit the spec §5 row for G2 from `☐ todo` to `✓ done` with PR/commit hash in Notes.

```bash
git add tasks/runbooks/audit-remediation-post-merge-smoke.md KNOWLEDGE.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "chore(audit-remediation-followups): G2 — post-merge smoke runbook + first run + KNOWLEDGE entry"
```

**DoD pointer:** spec §G2 Definition of Done. **§4.1 integrity check:** observation runbook completed, KNOWLEDGE entry present, no TODOs left in runbook.

---

### Task 1.2 — C1: Parseable `[GATE]` count line in every gate

**Spec section:** §1 Group C — C1 (lines 619–666). **Build slug:** `…/c1-gate-count-line/`. **Risk:** low (additive only). **Foundational — every Wave 1 item from 1.3 onward depends on this landing first.**

**Files:**
- Modify: `scripts/lib/guard-utils.sh` — extend `emit_summary()` per spec §C1 step 1.
- Modify: every `scripts/verify-*.sh` and `scripts/verify-*.mjs` not using `emit_summary` — append the `[GATE]` line as the LAST application-level line per spec §C1 step 2.
- Modify: `architecture.md` § Architecture Rules — one paragraph per spec §C1 step 4.
- Optional (same PR if cheap): `.github/workflows/<gates>.yml` capture artefact per §C1 step 3.

- [ ] **Step 1: Inventory non-shared scripts**

```bash
grep -L "guard-utils.sh" scripts/verify-*.sh scripts/verify-*.mjs
```

Capture the list in `tasks/builds/audit-remediation-followups/c1-gate-count-line/progress.md`.

- [ ] **Step 2: Patch `emit_summary()` in `scripts/lib/guard-utils.sh`**

Per spec §C1 step 1 — emit the human-readable `Summary:` line, THEN emit `[GATE] $GUARD_ID: violations=$violations` as the last application-level line. Honour the framework-log exception (per spec §C1 Round-3 note) and the subscript-output constraint (per spec §C1 Round-4 note — no helper script invocation may emit application-level output after `emit_summary`).

- [ ] **Step 3: Patch each non-shared script**

For each script in Step 1's inventory, append a final `echo "[GATE] <id>: violations=$count"` (or `console.log` for `.mjs`). Ensure no application-level output follows.

- [ ] **Step 4: Manual smoke test across 5 sampled gates**

Pick 5 gates (e.g. `verify-principal-context-propagation.sh`, `verify-action-call-allowlist.sh`, `verify-rls-coverage.sh`, `verify-help-hint-length.mjs`, `verify-integration-reference.mjs`). Run each:

```bash
bash scripts/verify-principal-context-propagation.sh 2>&1 | grep -E '^\[GATE\] [a-z0-9-]+: violations=[0-9]+$' | tail -n 1
```

Expected: one match per gate. Record results in the build-slug progress log.

- [ ] **Step 5: Author the gate-self-test fixture for subscript-output discipline**

Per spec §C1 Round-4 note — wire up a deliberately-misconfigured fixture script that prints AFTER `emit_summary`; assert the canonical `grep -E '^\[GATE\] ' | tail -n 1` parser still returns the correct violation count, AND a strict-tail form (`tail -n 1 | grep -qE '^\[GATE\] '`) reports the violation. Live under `scripts/__tests__/gate-output-discipline/`.

- [ ] **Step 6: Update `architecture.md` § Architecture Rules**

Add the paragraph from spec §C1 step 4 verbatim — names the canonical `grep -E '^\[GATE\] ' | tail -n 1` parser shape and the framework-vs-application distinction.

- [ ] **Step 7: Flip §5 Tracking row + commit**

```bash
git add scripts/ architecture.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md tasks/builds/audit-remediation-followups/c1-gate-count-line/progress.md
git commit -m "feat(gates): C1 — parseable [GATE] count line on every verify-* script"
```

Verification before merge: `npm run lint`, `bash scripts/run-all-gates.sh` (or whichever aggregate runs every gate), confirm every gate emits the `[GATE]` line.

**DoD pointer:** spec §C1 Definition of Done.

---

### Task 1.3 — G1: Migration sequencing verification (re-runnable script)

**Spec section:** §1 Group G — G1 (lines 1228–1273). **Build slug:** `…/g1-migration-sequencing/`. **Risk:** low (verification-by-controlled-write on disposable DB).

**Files:**
- Create: `scripts/verify-migration-sequencing.sh` — implements the four checks from spec §G1 Approach step 1.
- Output capture: `tasks/builds/audit-remediation-followups/g1-migration-sequencing/first-run.txt`.
- Optional: `.github/workflows/migration-sequencing.yml` (manual-trigger only — NOT blocking).

- [ ] **Step 1: Scaffold the script**

Create `scripts/verify-migration-sequencing.sh` parameterised on `DATABASE_URL`. Use `set -euo pipefail`; source `scripts/lib/guard-utils.sh` for `[GATE]` emission per Wave 1 invariant.

- [ ] **Step 2: Implement Check 1 — fresh-DB migration replay + Drizzle introspection diff**

Per spec §G1 Approach step 1.1 — run every `migrations/*.sql` against a disposable DB, then `npx drizzle-kit introspect` and diff against `server/db/schema/*.ts` after `prettier --parser typescript` normalisation.

- [ ] **Step 3: Implement Checks 2 + 3 — RLS write/read behaviour with org SET vs UNSET**

Per spec §G1 Approach steps 1.2–1.3 — for each tenant table (`agents`, `automations`, `memory_review_queue`, `document_bundles`, `agent_run_snapshots`, plus any added since PR #196), exercise SELECT/INSERT inside `BEGIN…ROLLBACK`. With `app.organisation_id` SET: both succeed. UNSET: SELECT returns 0 rows; INSERT/UPDATE/DELETE rejected with a Postgres error.

- [ ] **Step 4: Add deliberate-fault fixtures**

Under `scripts/__tests__/migration-sequencing/` — one fixture for out-of-order migrations, one for a tenant table missing `FORCE RLS`. Each must cause the script to fail with the offending name surfaced.

- [ ] **Step 5: First run against local dev DB**

Capture stdout to `first-run.txt`. Per spec §G1 step 3 — treat as the post-deploy validation for PR #196.

- [ ] **Step 6: Flip §5 Tracking row + commit**

```bash
git add scripts/verify-migration-sequencing.sh scripts/__tests__/migration-sequencing/ tasks/builds/audit-remediation-followups/g1-migration-sequencing/ docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(verify): G1 — re-runnable migration-sequencing script + first-run capture"
```

**DoD pointer:** spec §G1 Definition of Done. **Out of scope** (per spec §G1): cross-commit replay or historical schema-snapshot diff.

---

### Task 1.4 — D1: Capture `verify-input-validation` + `verify-permission-scope` baselines

**Spec section:** §1 Group D — D1 (lines 824–867). **Build slug:** `…/d1-baseline-capture/`. **Risk:** low (investigative-first; no code change unless step 4 turns up regressions).

**Files:**
- Modify: `tasks/builds/audit-remediation/progress.md` — append baseline counts (Phase 2's build slug; this closes its audit-trail gap).
- Modify: `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` § 5 row D1.

- [ ] **Step 1: Stash any in-flight work + check out `f824a03^1`**

```bash
git stash
git checkout f824a03^1
```

- [ ] **Step 2: Run both gates pre-PR-196 and capture counts**

```bash
bash scripts/verify-input-validation.sh > /tmp/iv-pre.txt 2>&1
bash scripts/verify-permission-scope.sh > /tmp/ps-pre.txt 2>&1
```

- [ ] **Step 3: Check out current `main` and run both gates again**

```bash
git checkout main
bash scripts/verify-input-validation.sh > /tmp/iv-post.txt 2>&1
bash scripts/verify-permission-scope.sh > /tmp/ps-pre.txt 2>&1
```

- [ ] **Step 4: Diff + decide per spec §D1 Approach step 4**

- Counts unchanged → record baselines, close.
- Counts higher → enumerate new violations; for each: fix on follow-up PR, OR document as pre-existing-but-newly-surfaced with evidence.
- Counts lower → record the delta; update baselines.

- [ ] **Step 5: Append baselines to `tasks/builds/audit-remediation/progress.md`**

One section: `## D1 baseline capture (2026-04-XX)` with both gate counts at both commits and the verdict.

- [ ] **Step 6: Flip §5 Tracking row + commit**

```bash
git add tasks/builds/audit-remediation/progress.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "docs(audit-remediation): D1 — baseline capture for verify-input-validation + verify-permission-scope"
```

**DoD pointer:** spec §D1 Definition of Done. **Do NOT amend the merged source spec** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md` — it is historical record.

---

### Task 1.5 — D2: Server cycle-count operator framing decision

**Spec section:** §1 Group D — D2 (lines 870–919). **Build slug:** `…/d2-cycle-count-framing/`. **Risk:** zero (decision-only, no code).

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md` § 6.3 / § 13.3 / § 13.5A.
- Modify: `tasks/builds/audit-remediation/plan.md`.

- [ ] **Step 1: Operator picks one of {a, b, c}**

Present the three framings verbatim from spec §D2 Approach (a / b / c). Recommended default: **(c) — accept the 43 residual to Phase 5A with cluster breakdown**. Record the choice + rationale in the build-slug progress log.

- [ ] **Step 2: Apply the chosen framing to the source spec**

Edit the audit-remediation source spec (which is post-merge documentation, so editing is OK — this is a meta-decision about the original spec's DoD bar). Use commit message: `docs(audit-remediation): record §6.3 cycle-count framing decision — <a|b|c>`.

- [ ] **Step 3: For framing (c), enumerate the cluster breakdown**

Three known clusters per spec §D2: `skillExecutor↔tools`, `agentExecutionService↔middleware`, `agentService↔llmService↔queueService`. Add one paragraph per cluster naming the chains and a one-line rationale (why deferred — refactor cost vs. defer-to-Phase-5A).

- [ ] **Step 4: Update `tasks/builds/audit-remediation/plan.md`**

Cross-link the framing decision and (if c) the cluster breakdown.

- [ ] **Step 5: Flip §5 Tracking row + commit**

```bash
git add docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md tasks/builds/audit-remediation/plan.md
git commit -m "docs(audit-remediation): record §6.3 cycle-count framing decision — <a|b|c>"
```

**DoD pointer:** spec §D2 Definition of Done.

---

### Task 1.6 — D3: `verify-skill-read-paths.sh` cleanup (P3-H8)

**Spec section:** §1 Group D — D3 (lines 923–991). **Build slug:** `…/d3-skill-read-paths/`. **Risk:** low. **Depends on:** C1 (Task 1.2 must ship first).

**Files:**
- Modify: `scripts/verify-skill-read-paths.sh` — possibly the calibration constant.
- Modify (likely): `server/config/actionRegistry.ts` — fix the 5 surplus `readPath:` occurrences OR add missing `actionType:` lines, depending on Step 1 finding.
- Modify: `tasks/todo.md` — close P3-H8 entry at line 862.

- [ ] **Step 1: Locate the 5 surplus `readPath:` occurrences**

Per spec §D3 Approach step 1:

```bash
grep -n "actionType:" server/config/actionRegistry.ts | wc -l   # → 94
grep -n "readPath:"   server/config/actionRegistry.ts | wc -l   # → 101 (= 99 + 2 the gate subtracts)
```

List both grep outputs side-by-side. Identify the 5 `readPath:` lines NOT immediately preceded by an `actionType:` line in the same object literal. Document in build-slug progress log.

- [ ] **Step 2: Pick patch shape per spec §D3 Approach step 2**

(a) Non-entry uses → update calibration constant from 2 to 7 with the **mandatory grep-pattern listing** per spec §D3 Round-4 calibration-constant change discipline. (b) Duplicate `readPath:` fields → remove duplicates. (c) Orphan entries → add `actionType:` OR remove dead code.

- [ ] **Step 3: If (a) — author the calibration-constant comment block**

Use the exact shape from spec §D3 step 2 (a) — every excluded occurrence gets a unique grep pattern + one-line reason. Verify each pattern returns exactly-one-hit with `grep -n "<pattern>" server/config/actionRegistry.ts`.

- [ ] **Step 4: Re-run gate; capture the C1 standard line**

```bash
bash scripts/verify-skill-read-paths.sh 2>&1 | grep -E '^\[GATE\] ' | tail -n 1
```

Expected: matching action and readPath counts; `[GATE] skill-read-paths: violations=0`.

- [ ] **Step 5: Cross-reference and close the P3-H8 entry**

Edit `tasks/todo.md:862` — strike through P3-H8 with commit hash.

- [ ] **Step 6: Append a one-paragraph root-cause note to build-slug progress**

Per spec §D3 Acceptance criterion — explain what the 5 surplus actually were.

- [ ] **Step 7: Flip §5 Tracking row + commit**

```bash
git add scripts/verify-skill-read-paths.sh server/config/actionRegistry.ts tasks/todo.md tasks/builds/audit-remediation-followups/d3-skill-read-paths/progress.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "fix(verify-skill-read-paths): D3 — reconcile readPath count with calibration listing"
```

**DoD pointer:** spec §D3 Definition of Done.

---

### Task 1.7 — E1: Triage 4 pre-existing unit test failures

**Spec section:** §1 Group E — E1 (lines 997–1046). **Build slug:** `…/e1-pre-existing-test-triage/`. **Risk:** low.

**Files:**
- Modify or delete (per Step 3 disposition): the 4 test files in spec §E1 Files block.
- Possibly modify the services under test (only if Step 3 disposition is "logic regression").
- Modify: `KNOWLEDGE.md` — append "Audit-remediation followups: pre-existing test triage" entry.

- [ ] **Step 1: Run each failing test file individually**

```bash
npx tsx --test server/services/__tests__/referenceDocumentServicePure.test.ts
npx tsx --test server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts
npx tsx --test server/services/__tests__/skillHandlerRegistryEquivalence.test.ts
npx tsx --test server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts
```

Capture exact failure for each in build-slug progress log.

- [ ] **Step 2: Per test, decide disposition (per spec §E1 Approach step 3)**

Three options: **logic regression** (fix service), **test-only bug** (fix test), **test no longer relevant** (delete OR convert to `node:test` `skip` option). Document the choice + reasoning per file.

- [ ] **Step 3: Apply each disposition**

For `skip`-converted tests, use the `node:test` `skip` option:
```ts
test('covers removed-behaviour X — see <commit>', { skip: 'X removed in <commit>' }, () => { ... });
```

- [ ] **Step 4: Re-run and confirm clean**

```bash
npm run test:unit
```

Expected: zero failures across the 4 files.

- [ ] **Step 5: Append KNOWLEDGE.md entry**

`## Audit-remediation followups: pre-existing test triage` listing each file, the failure observed, and the disposition chosen.

- [ ] **Step 6: Flip §5 Tracking row + commit**

```bash
git add server/services/__tests__/ server/services/crmQueryPlanner/__tests__/ KNOWLEDGE.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "test(triage): E1 — disposition 4 pre-existing failing tests + KNOWLEDGE entry"
```

**DoD pointer:** spec §E1 Definition of Done.

---

### Task 1.8 — E2: Pre-existing gate failures (verify-pure-helper-convention + verify-integration-reference)

**Spec section:** §1 Group E — E2 (lines 1049–1093). **Build slug:** `…/e2-pre-existing-gate-triage/`. **Risk:** low. **Depends on:** C1 (Task 1.2).

**Files:**
- Modify: `scripts/verify-pure-helper-convention.sh` (gate; possibly recognise an exemption annotation).
- Modify: 7 (verify count) `*Pure.test.ts` offender files OR rename/annotate.
- Modify: `scripts/verify-integration-reference.mjs` AND its YAML/data source (only if Step 0 finds a real blocking error).
- Modify: `scripts/guard-baselines.json` — record any residual advisory warning counts under each gate's `GUARD_ID`.
- PR description: §0.7 baseline-increase note if any baseline is committed above zero.

- [ ] **Step 0 (MANDATORY, BEFORE any code work): Re-capture `verify-integration-reference.mjs` state**

```bash
node scripts/verify-integration-reference.mjs 2>&1 | tee /tmp/vir-current.txt
```

Per spec §E2 Step 0 — the historical "1 blocking error in YAML parse / 26 warnings" diagnosis is stale. Replace with current findings before scheduling work. If the gate already exits 0, close the `verify-integration-reference.mjs` track with "verified clean on <commit>".

- [ ] **Step 1: Run `verify-pure-helper-convention.sh`; confirm violator count**

```bash
bash scripts/verify-pure-helper-convention.sh
```

Capture the 7 (or current N) offender file paths.

- [ ] **Step 2: Per offender — disposition**

Per spec §E2 Approach for `verify-pure-helper-convention.sh`:
- **Misnamed** → rename `*Pure.test.ts` to `*.test.ts` (drop `Pure`).
- **Genuinely pure-self-contained** → add `// @pure-helper-convention-exempt: <reason>` annotation; update gate to recognise.

- [ ] **Step 3: For `verify-integration-reference.mjs` — apply Step 0's finding**

Per spec §E2 Approach steps 1–4 — fix at source if blocking error remains, OR record advisory warnings in `scripts/guard-baselines.json`.

- [ ] **Step 4: Confirm both gates emit C1 standard lines**

```bash
bash scripts/verify-pure-helper-convention.sh 2>&1 | grep -E '^\[GATE\] '
node scripts/verify-integration-reference.mjs 2>&1 | grep -E '^\[GATE\] '
```

- [ ] **Step 5: PR description — §0.7 baseline note (if applicable)**

If E2 commits a baseline above zero in `scripts/guard-baselines.json`, the PR description carries: `Baseline increase: <guard_id> from 0 to <M>. Reason: carrying forward pre-existing advisory warnings; resolution tracked under tasks/todo.md.`

- [ ] **Step 6: Flip §5 Tracking row + commit**

```bash
git add scripts/ server/services/__tests__/ docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "fix(verify): E2 — clear verify-pure-helper-convention + verify-integration-reference baselines"
```

**DoD pointer:** spec §E2 Definition of Done.

---

### Task 1.9 — B1: `saveSkillVersion` orgId-required throw test

**Spec section:** §1 Group B — B1 (lines 436–484). **Build slug:** `…/b1-save-skill-version-throw-test/`. **Risk:** zero (purely additive). **Bundle-friendly** — can ship in a "trivial bundle" PR with C4 / G2 leftovers.

**Files:**
- Create: `server/services/__tests__/skillStudioServicePure.test.ts`
- Read-only: `server/services/skillStudioService.ts:295–319`

- [ ] **Step 1: Write the failing test (TDD posture)**

Create `server/services/__tests__/skillStudioServicePure.test.ts` with three assertions per spec §B1 Approach step 3 — exact-message regex matching for the two `assert.rejects` calls; happy-path `await` for `system` scope.

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { saveSkillVersion } from '../skillStudioService.js';

test('saveSkillVersion rejects null orgId for org scope', async () => {
  await assert.rejects(
    () => saveSkillVersion(skillId, 'org', null, payload),
    /saveSkillVersion: orgId is required for scope=org/,
  );
});

test('saveSkillVersion rejects null orgId for subaccount scope', async () => {
  await assert.rejects(
    () => saveSkillVersion(skillId, 'subaccount', null, payload),
    /saveSkillVersion: orgId is required for scope=subaccount/,
  );
});

test('saveSkillVersion accepts null orgId for system scope', async () => {
  await saveSkillVersion(skillId, 'system', null, payload); // must not throw
});
```

Mock the transaction wrapper so the test stays pure (no DB).

- [ ] **Step 2: Run test — expect PASS on current main**

```bash
npx tsx --test server/services/__tests__/skillStudioServicePure.test.ts
```

Expected: 3/3 PASS in <500ms.

- [ ] **Step 3: Verify drift detection**

Temporarily change the throw message in `skillStudioService.ts:303` (e.g. drop `orgId is required`); re-run the test; expect FAIL on the regex match. Revert the temporary change.

- [ ] **Step 4: Flip §5 Tracking row + commit**

```bash
git add server/services/__tests__/skillStudioServicePure.test.ts docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "test(skillStudioService): B1 — lock orgId-required throw contract for saveSkillVersion"
```

**DoD pointer:** spec §B1 Definition of Done.

---

### Task 1.10 — C4: `actionRegistry.ts` comment cleanup

**Spec section:** §1 Group C — C4 (lines 781–818). **Build slug:** `…/c4-action-registry-comment/`. **Risk:** zero. **Bundle-friendly** — pair with B1 in a "trivial bundle" PR.

**Sequencing-sensitive:** the right fix depends on whether A1b (Wave 3, Task 3.2) has shipped.

**Files:**
- Modify: `server/config/actionRegistry.ts:2-3`

- [ ] **Step 1: Determine A1b status**

Check spec §5 Tracking row A1b. If `☐ todo` or `⧖ in progress` → take Path A. If `✓ done` → take Path B.

- [ ] **Step 2A (Path A — A1b NOT shipped): Replace comment per spec §C4 Approach Path A**

```ts
// fromOrgId imported here to satisfy verify-principal-context-propagation gate.
// This registry does not invoke canonicalDataService directly today; future handler
// additions that do should pass fromOrgId(organisationId, subaccountId) explicitly.
```

- [ ] **Step 2B (Path B — A1b shipped): Remove import + comment entirely**

Delete lines 1–3 (the `import { fromOrgId } …` line and the misleading comment). The file drops out of the gate's scope (no `canonicalDataService.<method>(` invocations exist in the file).

- [ ] **Step 3: Verify gate still passes**

```bash
bash scripts/verify-principal-context-propagation.sh 2>&1 | grep -E '^\[GATE\] '
```

Expected: `[GATE] principal-context-propagation: violations=0`.

- [ ] **Step 4: Flip §5 Tracking row + commit**

```bash
git add server/config/actionRegistry.ts docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "docs(actionRegistry): C4 — correct misleading canonicalDataService comment"
```

**DoD pointer:** spec §C4 Definition of Done.

---

---

## Wave 2 — Drift guards + small refactors

Per spec §2 Sequencing: C2 + C3 (drift-guards bundled PR) → A3 + F1 (independent small PRs) → H1 (high-leverage system rule). C2 and H1 depend on C1 already shipped in Wave 1. Total: ~1 week parallel-friendly.

---

### Task 2.1 — C2: `architect.md` context-section drift guard

**Spec section:** §1 Group C — C2 (lines 670–712). **Build slug:** `…/c2-architect-context-drift/`. **Risk:** low. **Depends on:** C1 (Task 1.2). **Bundle-friendly with C3** as a single "drift-guards" PR.

**Files:**
- Create: `scripts/verify-architect-context.sh`
- Create: `scripts/architect-context-expected.txt` (fixture — one path per line, in order, mirroring the current `## Context files` section of `.claude/agents/architect.md`).
- Create: `scripts/__tests__/architect-context/` — fixture variants for the failure modes per spec §C2 step 3.
- Modify: `package.json` script aggregator OR CI workflow — wire the gate into the standard run.

- [ ] **Step 1: Author the expected-paths fixture**

Read `.claude/agents/architect.md:44-54`'s `## Context files` section. Copy the numbered list verbatim into `scripts/architect-context-expected.txt` — one path per line, in order. Each line is `<path>` only (no numbering); skip non-file lines like "the specific task...".

- [ ] **Step 2: Implement the gate logic per spec §C2 Approach step 1**

```bash
#!/usr/bin/env bash
set -euo pipefail
GUARD_ID="architect-context"
# 1. Read .claude/agents/architect.md ## Context files section.
# 2. Diff extracted entries vs. scripts/architect-context-expected.txt.
# 3. Per entry naming a file path (.md or known pattern), assert path exists.
# 4. Emit [GATE] line via emit_summary.
source scripts/lib/guard-utils.sh
…
emit_summary
```

Detect: missing entry, unexpected entry, order mismatch, dangling path. Each emits a specific error per spec §C2 Approach step 1.

- [ ] **Step 3: Author 3 failure-mode fixtures under `scripts/__tests__/architect-context/`**

(a) `architect-deleted-entry.md` (missing one path), (b) `architect-extra-entry.md` (one extra), (c) `architect-renamed-target.md` (path no longer resolves on disk). Each must cause the gate to fail with a specific error naming the offender.

- [ ] **Step 4: Wire into gates suite**

Add to `package.json` `verify` script (or whichever aggregate runs every `verify-*` gate). Trigger conditions: every commit that touches `.claude/agents/architect.md` OR any listed context file.

- [ ] **Step 5: Verify gate emits C1 standard line**

```bash
bash scripts/verify-architect-context.sh 2>&1 | grep -E '^\[GATE\] '
```

Expected: `[GATE] architect-context: violations=0`.

- [ ] **Step 6: Bundle commit (drift-guards PR — see Task 2.2)**

Hold the commit until C3 (Task 2.2) is also ready; ship together.

**DoD pointer:** spec §C2 Definition of Done.

---

### Task 2.2 — C3: Canonical registry drift validation tests

**Spec section:** §1 Group C — C3 (lines 716–778). **Build slug:** `…/c3-canonical-registry-drift/`. **Risk:** low. **Bundle with C2** as drift-guards PR.

**Files:**
- Create: `server/services/__tests__/canonicalRegistryDriftPure.test.ts`
- Read-only inputs: `server/db/schema/*.ts` (`canonical_*` tables), `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`, `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`.
- Modify (likely): `tasks/todo.md` — add the **C3 follow-up entry** with owner, trigger condition, back-link per spec §C3 Round-3 + Round-4 requirements.

- [ ] **Step 1: Build `schemaTables` and `dictionaryTables` sets**

Per spec §C3 Approach step 2 — either `import` Drizzle table objects and read their internal name symbol, OR filesystem-scan schema files with `pgTable\('canonical_[a-z_]+'`. Pick the more stable approach.

- [ ] **Step 2: Inspect `canonicalQueryRegistry` — forced decision per spec §C3 Round-2**

Open `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`. Decide:

- **(a) Metadata exists** — entries carry `canonicalTable` field → extract into `queryPlannerTables` set; ship 3-set comparison.
- **(b) No metadata on `main`** — ship 2-set comparison (schema vs. dictionary) AND author the follow-up backlog entry per spec §C3 Round-3 + Round-4.

Document the decision in `tasks/builds/audit-remediation-followups/c3-canonical-registry-drift/progress.md`.

- [ ] **Step 3: Author the test with 2-set OR 3-set assertions**

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
// import or scan to build sets

test('schemaTables ⊆ dictionaryTables', () => {
  const missing = [...schemaTables].filter(t => !dictionaryTables.has(t));
  assert.deepStrictEqual(missing, [], `Unregistered canonical_* tables: ${missing.join(', ')}`);
});

test('dictionaryTables ⊆ schemaTables', () => {
  const stale = [...dictionaryTables].filter(t => !schemaTables.has(t));
  assert.deepStrictEqual(stale, [], `Stale dictionary entries: ${stale.join(', ')}`);
});

// (a) only:
test('queryPlannerTables ⊆ dictionaryTables', () => {
  const orphan = [...queryPlannerTables].filter(t => !dictionaryTables.has(t));
  assert.deepStrictEqual(orphan, [], `Planner references unregistered tables: ${orphan.join(', ')}`);
});
```

Failure messages MUST name the offending table.

- [ ] **Step 4: Run test**

```bash
npx tsx --test server/services/__tests__/canonicalRegistryDriftPure.test.ts
```

Expected: PASS on current main.

- [ ] **Step 5: Verify drift detection**

Temporarily add a `canonical_* ` table to schema without dictionary registration; re-run; expect FAIL with the new table name in the failure message. Revert.

- [ ] **Step 6: If Step 2 chose (b) — author the C3 follow-up backlog entry**

Append to `tasks/todo.md` per the exact shape in spec §C3 Round-3 — must include owner, trigger condition (Phase-5A entry OR new `canonical_*` table addition, whichever fires first), back-link to spec § C3.

Per spec §C3 Round-4: ALSO note in the C3 PR description that "the Phase-5A spec, when authored, must carry the C3 upgrade as a checklist item per § C3 of the audit-remediation-followups spec". Verify at C3 ship time that no Phase-5A spec already exists; if one does, add the checklist item directly to it in the same PR.

- [ ] **Step 7: Bundle commit (drift-guards PR with C2)**

```bash
git add scripts/verify-architect-context.sh scripts/architect-context-expected.txt scripts/__tests__/architect-context/ server/services/__tests__/canonicalRegistryDriftPure.test.ts tasks/todo.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(verify): C2 + C3 — architect.md context drift guard + canonical registry drift test"
```

**DoD pointer:** spec §C3 Definition of Done — note that DoD requires both owner AND trigger condition AND back-link in the follow-up entry if 2-set path was taken.

---

### Task 2.3 — A3: `briefVisibilityService` + `onboardingStateService` → `getOrgScopedDb`

**Spec section:** §1 Group A — A3 (lines 394–430). **Build slug:** `…/a3-services-org-scoped-db/`. **Risk:** low (internal-only refactor).

**Files:**
- Modify: `server/services/briefVisibilityService.ts` (lines 9, 30, 49, plus any others discovered during migration).
- Modify: `server/services/onboardingStateService.ts` (lines 13, 51, plus any reads).
- Create: `server/services/__tests__/briefVisibilityServicePure.test.ts`
- Create: `server/services/__tests__/onboardingStateServicePure.test.ts`

- [ ] **Step 1: Audit current import + call sites**

```bash
grep -n "import { db }" server/services/briefVisibilityService.ts server/services/onboardingStateService.ts
grep -n "db\." server/services/briefVisibilityService.ts server/services/onboardingStateService.ts
```

Capture all hits. The reference modern pattern is `server/services/documentBundleService.ts:672` — `const db = getOrgScopedDb('documentBundleService')` at function scope (NOT module top).

- [ ] **Step 2: Write failing tests first (TDD posture)**

`briefVisibilityServicePure.test.ts` — mock `getOrgScopedDb`; assert each function calls it with `'briefVisibilityService'` source string and uses the returned tx for the read. Same shape for `onboardingStateServicePure.test.ts` (transaction path).

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx tsx --test server/services/__tests__/briefVisibilityServicePure.test.ts
npx tsx --test server/services/__tests__/onboardingStateServicePure.test.ts
```

Expected: FAIL because services still import `db` directly.

- [ ] **Step 4: Migrate `briefVisibilityService.ts`**

Per spec §A3 Approach step 1 — replace module-top `import { db }` with `import { getOrgScopedDb } from '../lib/orgScopedDb.js'`. Inside each function, `const tx = getOrgScopedDb('briefVisibilityService')`. Replace `db.select(...)` with `tx.select(...)`. **Function-scope ONLY** — `getOrgScopedDb` throws on missing org context; module-top evaluation runs before any tx is opened.

- [ ] **Step 5: Migrate `onboardingStateService.ts`**

Per spec §A3 Approach step 2 — same pattern; for the existing transaction at `:51`, use `getOrgScopedDb('onboardingStateService').transaction(async (innerTx) => { … })`. **Do NOT use `withOrgTx` directly** — it is the entry-point primitive in `auth.ts` / `createWorker.ts`, not a per-call helper.

- [ ] **Step 6: Run tests — expect PASS**

```bash
npx tsx --test server/services/__tests__/briefVisibilityServicePure.test.ts
npx tsx --test server/services/__tests__/onboardingStateServicePure.test.ts
```

- [ ] **Step 7: Manual smoke (per spec §A3 Acceptance criteria)**

Brief-read with request principal's org bound returns expected row; deliberate org-mismatch returns `{ canView: false, canWrite: false }`.

- [ ] **Step 8: Lint guardrail check**

Per spec §A3 Approach step 4 — `scripts/verify-rls-contract-compliance.sh` allowlists `server/services/**`; A2 (Wave 3) provides the long-term regression guarantee. Note this in the build-slug progress log.

- [ ] **Step 9: Flip §5 Tracking row + commit**

```bash
git add server/services/briefVisibilityService.ts server/services/onboardingStateService.ts server/services/__tests__/briefVisibilityServicePure.test.ts server/services/__tests__/onboardingStateServicePure.test.ts docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "refactor(services): A3 — briefVisibilityService + onboardingStateService use getOrgScopedDb"
```

**DoD pointer:** spec §A3 Definition of Done.

---

### Task 2.4 — F1: `findAccountBySubaccountId` targeted method

**Spec section:** §1 Group F — F1 (lines 1099–1150). **Build slug:** `…/f1-find-account-by-subaccount/`. **Risk:** low. **Depends on:** A1a preferred (signature standard) but not blocking.

**Files:**
- Modify: `server/services/canonicalDataService.ts` — add new method.
- Modify: `server/jobs/measureInterventionOutcomeJob.ts:208-218` — rewrite `resolveAccountIdForSubaccount`.
- Create: `server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts`

- [ ] **Step 1: Audit other call sites of the all-accounts-then-filter pattern**

```bash
grep -rn "getAccountsByOrg" server/ | grep -v __tests__
```

For each hit: confirm whether it's doing `.find(a => a.subaccountId === ...)` client-side. List in build-slug progress log; decide which to migrate now vs. defer.

- [ ] **Step 2: Write failing test (TDD)**

```ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('findAccountBySubaccountId emits single-row SELECT with both predicates', async () => {
  const captured: { where?: any } = {};
  const mockDb = { select: () => ({ from: () => ({ where: (w) => { captured.where = w; return { limit: () => Promise.resolve([fixtureRow]) }; } }) }) };
  // … inject mockDb …
  const account = await findAccountBySubaccountId(principal, subaccountId);
  assert.ok(captured.where, 'WHERE clause must be set');
  // assert both predicates appear (organisation_id AND subaccount_id)
  assert.equal(account?.subaccountId, subaccountId);
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
npx tsx --test server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts
```

- [ ] **Step 4: Add `findAccountBySubaccountId` to `canonicalDataService`**

Signature depends on A1a status:
- **A1a shipped:** `findAccountBySubaccountId(principal: PrincipalContext, subaccountId: string): Promise<CanonicalAccount | null>`
- **A1a not shipped:** `findAccountBySubaccountId(orgId: string, subaccountId: string): Promise<CanonicalAccount | null>` — migrate when A1a lands.

Implementation:
```ts
const result = await tx.select()
  .from(canonicalAccounts)
  .where(and(
    eq(canonicalAccounts.organisationId, organisationId),
    eq(canonicalAccounts.subaccountId, subaccountId),
  ))
  .limit(1);
return result[0] ?? null;
```

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Migrate `measureInterventionOutcomeJob.ts:208-218`**

Per spec §F1 Approach step 2 — replace `getAccountsByOrg` + `.find(...)` with `findAccountBySubaccountId(principal | orgId, subaccountId)`.

- [ ] **Step 7: Migrate any additional call sites from Step 1**

Per spec §F1 Approach step 4 — migrate or explicitly note as out-of-scope and route to `tasks/todo.md` per §0.3.

- [ ] **Step 8: Flip §5 Tracking row + commit**

```bash
git add server/services/canonicalDataService.ts server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts server/jobs/measureInterventionOutcomeJob.ts docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "perf(canonicalDataService): F1 — targeted findAccountBySubaccountId; replace org-wide fetch+filter"
```

**DoD pointer:** spec §F1 Definition of Done.

---

### Task 2.5 — H1: Cross-service derived-data null-safety contract (Phase 1: ADVISORY)

**Spec section:** §1 Group H — H1 (lines 1321–1412). **Build slug:** `…/h1-derived-data-null-safety/`. **Risk:** low (additive defensive code). **Highest-leverage item in Wave 2.** **Depends on:** C1 (Wave 1).

**Files:**
- Modify: `architecture.md` § Architecture Rules — add the H1 paragraph verbatim per spec §H1 Approach step 1.
- Create: `scripts/verify-derived-data-null-safety.sh` (gate — **ships ADVISORY in Phase 1**).
- Create: `scripts/derived-data-null-safety-fields.txt` (allowlist).
- Create: `server/lib/derivedDataMissingLog.ts` (shared WARN helper, sibling of `server/lib/logger.ts`).
- Modify: every in-scope read site (Phase 1 scope = consumers of `bundleUtilizationJob`, `measureInterventionOutcomeJob`, `ruleAutoDeprecateJob`, `connectorPollingSync` outputs ONLY).
- Create: per-service `__tests__/<service>.derivedDataNullSafety.test.ts` for in-scope services.
- Create: `tasks/builds/audit-remediation-followups/h1-derived-data-null-safety/null-safety-call-sites.md`

- [ ] **Step 1: Codify the rule in `architecture.md` § Architecture Rules**

Insert the rule paragraph verbatim from spec §H1 Approach step 1 — `**Derived-data null-safety.**` block. Naming the rate-limit pattern (A or B) is deferred to Step 4; the architecture line points operators at `server/lib/derivedDataMissingLog.ts` for the chosen pattern.

- [ ] **Step 2: Build the in-scope read-site inventory**

Author `tasks/builds/audit-remediation-followups/h1-derived-data-null-safety/null-safety-call-sites.md` — Phase 1 scope ONLY (the four named jobs per spec §H1 Approach step 2 scope-lock). Search:

```bash
grep -rn "bundleUtilization\|interventionOutcome\|ruleAutoDeprecat\|connectorPollingSync" server/ | grep -v __tests__
```

For each hit: classify as in-scope-Phase-1 OR out-of-scope (note "pulse-derived metric, out of Phase 1 scope" or similar). **Document deliberately-not-touched adjacent sites with one-line reason** per spec §H1 Acceptance criterion (Phase 1).

- [ ] **Step 3: Author `server/lib/derivedDataMissingLog.ts`**

Single export: `logDataDependencyMissing(service: string, field: string, orgId: string)`. **Pick rate-limit pattern based on call-site distribution from Step 2** per spec §H1 Approach step 5 Round-4 contract:

- **Pattern A (preferred for hot paths):** in-memory `Map<string, number>` keyed `<service>.<field>:<orgId>`; skip if last emit within window (default 60s, env-overridable via `DATA_DEPENDENCY_MISSING_RATE_LIMIT_MS`).
- **Pattern B (preferred for low-volume paths):** in-memory `Set<string>`; first emit WARN, subsequent DEBUG.

Document the chosen pattern in JSDoc + in `architecture.md`'s H1 line per spec §H1 step 5.

- [ ] **Step 4: Refactor each in-scope read site**

Per spec §H1 Approach step 3:
- Replace `data!` non-null assertions with `if (!data) { logDataDependencyMissing(...); return null; }` (or empty list / sentinel per the consumer's contract).
- Replace `if (!data) throw …` with WARN-and-return.

**Additive-only output shapes invariant** per spec §H1 Round-3 — no field renames, no field removals during Phase 1 rollout. If a refactor surfaces a need to rename, STOP and write a follow-up backlog entry per §0.3.

- [ ] **Step 5: Author per-service tests**

For each in-scope service: `__tests__/<service>.derivedDataNullSafety.test.ts` exercising the "upstream not yet populated" path — assert no throw, returns sentinel/null/empty, and **assert the WARN line is emitted** (capture logs in test).

Tests MUST cover BOTH the first-occurrence emit AND the rate-limited-skip / debug-downgrade behaviour per spec §H1 step 5 Round-4 contract.

- [ ] **Step 6: Author the gate `scripts/verify-derived-data-null-safety.sh`**

Per spec §H1 Approach step 4 — ships ADVISORY (exits 0 even on hits). Reads `scripts/derived-data-null-safety-fields.txt`. Greps for `<field>!` non-null assertions or `if (!<value>) throw` patterns referencing those fields. Allows `// @null-safety-exempt: <reason>` annotation. Emits `[GATE] derived-data-null-safety: violations=<count>` per C1.

- [ ] **Step 7: Add gate self-test fixture**

Under `scripts/__tests__/derived-data-null-safety/` — fixture file with deliberate `data!` assertion on an allowlisted field; gate must report it (advisory, exit 0).

- [ ] **Step 8: Run gate; record initial baseline**

```bash
bash scripts/verify-derived-data-null-safety.sh 2>&1 | tee /tmp/h1-baseline.txt
```

Expected: 0 violations after Step 4's refactor; if non-zero, drive to zero before Phase 2 promotion.

- [ ] **Step 9: Schedule Phase 2 promotion (separate PR, ≥2-3 weeks later)**

Per spec §H1 Acceptance criteria (Phase 2) — record promotion criteria in build-slug progress log:
- No FP issues filed during 2-3 week window.
- Violation count week-over-week stable.

Promotion is a one-line change to gate exit logic. Promotion date logged when it happens.

- [ ] **Step 10: Flip §5 Tracking row (Phase 1 only) + commit**

```bash
git add architecture.md scripts/verify-derived-data-null-safety.sh scripts/derived-data-null-safety-fields.txt server/lib/derivedDataMissingLog.ts server/ tasks/builds/audit-remediation-followups/h1-derived-data-null-safety/ docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(observability): H1 Phase 1 — derived-data null-safety contract + advisory gate + per-service refactor"
```

**DoD pointer:** spec §H1 Definition of Done — Phase 1 only at this point. Phase 2 (promote to blocking) is tracked separately in build-slug progress log.

---

---

## Wave 3 — Heavy migrations

Per spec §2 Sequencing: A1a → A1b → B2 (per-job sequence) → A2 (phased). **Sequential.** Total: ~2–2.5 weeks.

**Wave 3 invariant:** every item in Wave 3 has a per-item PR; do NOT bundle. Per-job ordering inside B2 is also strict (lowest-risk-first). A2 ships in three sequential phases.

---

### Task 3.1 — A1a: Principal-context propagation — service surface change

**Spec section:** §1 Group A — A1a (lines 174–232). **Build slug:** `…/a1a-principal-context-surface/`. **Risk:** medium. **Effort:** 2–3 days.

**Files:**
- Modify: `server/services/canonicalDataService.ts` — migrate all 31 method signatures.
- Modify: 4 caller files — `server/config/actionRegistry.ts`, `server/services/connectorPollingService.ts`, `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`, `server/routes/webhooks/ghlWebhook.ts`.
- Read-only: `server/services/principal/fromOrgId.ts`, `server/services/principal/types.ts`, `server/db/withPrincipalContext.ts`.
- Create: `server/services/__tests__/canonicalDataService.principalContext.test.ts`
- Create: `tasks/builds/audit-remediation-followups/a1a-principal-context-surface/canonical-call-sites.md` (inventory).

**Strategic note:** A1a leaves the `verify-principal-context-propagation.sh` gate at file-level; A1b (Task 3.2) flips it to call-site granularity AFTER A1a's caller migration is done.

- [ ] **Step 1: Build the call-site inventory**

Per spec §A1a Approach step 1 — enumerate every `canonicalDataService.<method>(...)` call site in `server/` (excluding `__tests__`). Group by method signature shape. Capture in `canonical-call-sites.md`.

- [ ] **Step 2: Pick uniform migration shape — split positional**

Per spec §A1a Approach step 2 — recommended: **(principal: PrincipalContext, ...rest)** for positional methods; **(principal: PrincipalContext, args: { ... })** for args-object methods (with `orgId` / `subaccountId` removed from args, placed on principal). One uniform shape across the service — easier to grep for, becomes load-bearing in A1b.

- [ ] **Step 3: Write failing tests first (TDD)**

Author `canonicalDataService.principalContext.test.ts` per spec §A1a Tests required — read method (e.g. `getAccountById`) + write method (e.g. `upsertAccount`). Spy on `withPrincipalContext`; assert it is invoked inside method body. Assert session vars bound. Assert calling without `PrincipalContext` (e.g. `null as any`) throws BEFORE any DB work.

- [ ] **Step 4: Run tests — expect FAIL**

```bash
npx tsx --test server/services/__tests__/canonicalDataService.principalContext.test.ts
```

- [ ] **Step 5: Migrate `canonicalDataService` method signatures**

For each of the 31 methods:
1. Add new signature `(principal: PrincipalContext, ...rest)` (or `(principal, args)` for args-object methods).
2. Wrap DB work in `withPrincipalContext(principal, async (tx) => { ... })` per spec §A1a Approach step 2.
3. Keep deprecated overload retained per spec §A1a Approach step 3 with `// @deprecated — remove in A1b` JSDoc tag — internally calls `fromOrgId(organisationId, null)` and forwards to new body. **MUST NOT silently no-op** per §0.5; new body either succeeds or throws.

- [ ] **Step 6: Run tests — expect PASS for the new signature path**

- [ ] **Step 7: Migrate the 4 caller files**

Each caller's import becomes a real call site. Pass `fromOrgId(organisationId, subaccountId)` (or `fromOrgId(organisationId, null)` if no subaccount). **Do NOT rely on the shim for new code** per spec §A1a step 4 — every caller migrates in A1a.

- [ ] **Step 8: Enforce PrincipalContext-construction discipline (per spec §A1a step 5)**

Production code: `PrincipalContext` MUST be obtained via `fromOrgId(...)` OR propagation of an existing typed value. Inline object literals / `as PrincipalContext` casts / ad-hoc helpers — REJECTED in non-test code. Tests are exempt.

- [ ] **Step 9: Run full server build + lint + tests**

```bash
npm run build:server
npm run lint
npm run test:unit
```

All must pass.

- [ ] **Step 10: Confirm existing gate still passes (file-level)**

```bash
bash scripts/verify-principal-context-propagation.sh 2>&1 | grep -E '^\[GATE\] '
```

Expected: `[GATE] principal-context-propagation: violations=0` (file-level enforcement; A1b flips to call-site).

- [ ] **Step 11: Flip §5 Tracking row + commit**

```bash
git add server/services/canonicalDataService.ts server/config/actionRegistry.ts server/services/connectorPollingService.ts server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts server/routes/webhooks/ghlWebhook.ts server/services/__tests__/canonicalDataService.principalContext.test.ts tasks/builds/audit-remediation-followups/a1a-principal-context-surface/ docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(canonicalDataService): A1a — PrincipalContext as first parameter; deprecated overloads retained for A1b"
```

**DoD pointer:** spec §A1a Definition of Done.

---

### Task 3.2 — A1b: Principal-context gate hardening + caller enforcement

**Spec section:** §1 Group A — A1b (lines 235–290). **Build slug:** `…/a1b-principal-context-gate/`. **Risk:** low (mostly mechanical). **Effort:** 1–2 days. **Depends on:** A1a (Task 3.1).

**Files:**
- Modify: `scripts/verify-principal-context-propagation.sh` — flip to call-site granularity per spec §A1b step 2.
- Modify: `server/services/canonicalDataService.ts` — remove all `// @deprecated — remove in A1b` shims.
- Modify: `scripts/guard-baselines.json` — regenerate `principal-context-propagation` baseline.
- Create: `scripts/__tests__/principal-context-propagation/` — fixture per accepted-shape category.

- [ ] **Step 1: PRE-CONDITION shim-usage greps (MANDATORY before any code change)**

Per spec §A1b Approach pre-condition section — capture all four greps' output to `tasks/builds/audit-remediation-followups/a1b-principal-context-gate/progress.md`:

```bash
grep -rn "@deprecated — remove in A1b" server/                                              # → N (the count A1a landed)
grep -rn "canonicalDataService\.\w+(\s*organisationId" server/ | grep -v __tests__          # → 0
grep -rn "canonicalDataService\.\w+(\s*orgId" server/ | grep -v __tests__                   # → 0
# + cross-check inventory from A1a
```

If any of greps 2 / 3 returns non-zero — A1b STOPS. Migrate the offending caller first (in A1a's PR or as A1a-2 PR). No "looks fine" override.

- [ ] **Step 2: Remove all deprecated shims**

```bash
grep -l "@deprecated — remove in A1b" server/services/canonicalDataService.ts
```

For each method's deprecated overload — delete. Only the `(principal, ...)` signature remains.

- [ ] **Step 3: Write the regex matcher with positive allowlist**

Per spec §A1b Approach step 2 — first-arg accepted shapes:
- `fromOrgId(` / `fromOrgId<`
- `withPrincipalContext(`
- Locally-typed `PrincipalContext` variable (same-file `: PrincipalContext` annotation in scope).

Bare identifiers, raw object literals, spread expressions in first-arg position → violations.

- [ ] **Step 4: Sample 50 call sites; check FP/FN rate**

Per spec §A1b Approach step 2 Round-3 trigger — minimum sample 50 call sites; if **≥3 misclassifications** caused by imported typed variables, destructured parameters, or helper-function wrappers → AST fallback is **mandatory**. Log the sample (file:line list) and misclassification count in build-slug progress.

- [ ] **Step 5: If AST fallback triggered — implement minimal AST check**

Scoped ONLY to `canonicalDataService.<method>(` call expressions. AST inspects first argument's identifier; asserts type resolves to `PrincipalContext`. Implement inside the gate script (or sibling `.mjs`); NOT a new general-purpose AST primitive per §0.2.

- [ ] **Step 6: Add `@principal-context-import-only` annotation contract**

Per spec §A1b Approach step 3 — gate scans for top-of-file `// @principal-context-import-only — reason: <one-sentence rationale>` and exempts the file. Files without invocations (e.g. `intelligenceSkillExecutor.ts`) carry the annotation.

- [ ] **Step 7: Author fixture per accepted-shape category**

Under `scripts/__tests__/principal-context-propagation/` — one fixture file per violation category (bare identifier, object literal, spread). Gate must report each.

- [ ] **Step 8: Regenerate baseline in `scripts/guard-baselines.json`**

```bash
bash scripts/verify-principal-context-propagation.sh
```

Expected: post-A1a, baseline drops to 0. Update the entry.

- [ ] **Step 9: Confirm gate emits C1 standard line**

```bash
bash scripts/verify-principal-context-propagation.sh 2>&1 | grep -E '^\[GATE\] '
```

- [ ] **Step 10: Flip §5 Tracking row + commit**

```bash
git add scripts/verify-principal-context-propagation.sh scripts/__tests__/principal-context-propagation/ scripts/guard-baselines.json server/services/canonicalDataService.ts tasks/builds/audit-remediation-followups/a1b-principal-context-gate/ docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(verify): A1b — call-site granularity for principal-context gate; remove deprecated shims"
```

**DoD pointer:** spec §A1b Definition of Done — pre-condition greps captured BEFORE any code change; counts as specified; deliberate-regression fixtures pass for each accepted-shape category.

---

### Task 3.3 — B2 + B2-ext: Job idempotency + concurrency standard

**Spec section:** §1 Group B — B2 + B2-ext (lines 488–611). **Build slug:** `…/b2-job-idempotency-concurrency/`. **Risk:** medium (concurrency bugs are notoriously hard to surface). **Effort:** 3–4 days, one PR per job.

**Per-job ordering (STRICT — do NOT bundle):**
1. `connectorPollingSync` (already lease-protected; comment-only formalisation; validates standard header shape first).
2. `bundleUtilizationJob` (advisory-lock + upsert work; disabled-until-Phase-6 so regression is contained).
3. `measureInterventionOutcomeJob` (claim+verify; runs hourly in production — schedule impact if regression).
4. `ruleAutoDeprecateJob` (global advisory lock; nightly cadence — safest to land last).

Each job is its own mini-spec; do NOT start the next until previous has been live for one scheduled cycle without alerts.

**Files (per-job — repeated 4×):**
- Modify: `server/jobs/<jobName>.ts` — add header + idempotency mechanism + concurrency mechanism + `__testHooks` seam + structured `noop` return.
- Create: `server/jobs/__tests__/<jobName>.idempotency.test.ts`
- Modify: `architecture.md` § Architecture Rules (only on the LAST job — the paragraph lands once).
- Optional: `scripts/verify-job-concurrency-headers.sh` (or extend existing `scripts/verify-job-idempotency-keys.sh`).

**Per-job iteration (run for each of the 4 jobs in order):**

- [ ] **Step 1: Write failing tests first — sequential + parallel + mid-execution-failure**

Per spec §B2 Approach step 3:
- **Sequential double-invocation:** call job twice; assert state matches single-invocation; no duplicate side effects.
- **Parallel double-invocation:** `Promise.all([job(), job()])`; assert exactly one performs work; one returns `{ status: 'noop', reason, jobName }`.
- **Mid-execution failure:** simulate transient throw inside work block; on retry, assert no partial state.

**Race-window control (MANDATORY):** use injected `__testHooks` seam, NOT solely `pg_sleep`. Per spec §B2 step 3 Round-2 + Round-4 contract — three production-safety conditions:
1. Tree-shaken or no-op in production builds.
2. No execution change when unset (canonical pattern: `if (!__testHooks.<hook>) return; await __testHooks.<hook>();`).
3. Reset-on-import enforcement at test boundaries (`beforeEach` reset).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx tsx --test server/jobs/__tests__/<jobName>.idempotency.test.ts
```

- [ ] **Step 3: Apply standard header per spec §B2 step 1**

Insert the exact header form:

```ts
/**
 * <jobName>
 *
 * Concurrency model: <advisory lock on <key> | singleton key | queue-level exclusivity>
 *   Mechanism:       <pg_advisory_xact_lock | UPDATE … RETURNING claim | …>
 *   Key/lock space:  <description>
 *
 * Idempotency model: <upsert-on-conflict | claim+verify | content-addressed | replay-safe>
 *   Mechanism:       <description>
 *   Failure mode:    <what happens on partial mid-execution state>
 */
```

**Default lock scope: per-org** per §0.6. Justify any deviation (global / per-entity) inline in the header.

- [ ] **Step 4: Implement the per-job idempotency + concurrency mechanism**

Per spec §B2 Approach step 2:
- **bundleUtilizationJob:** pg advisory lock on `(orgId, jobName)`; replay-safe upsert with `INSERT … ON CONFLICT DO UPDATE` on `(orgId, bundleId, windowStart)`.
- **measureInterventionOutcomeJob:** per-org advisory lock; claim+verify via `UPDATE … WHERE measured_at IS NULL RETURNING id`.
- **ruleAutoDeprecateJob:** global advisory lock (justified: nightly cadence, no per-org parallelism needed); `WHERE deprecated_at IS NULL` predicate.
- **connectorPollingSync:** lease via `sync_lock_token` (already in place); add per-phase no-op-if-already-done predicates per spec §B2 step 2 (separate idempotency from concurrency).

- [ ] **Step 5: Implement structured no-op return per spec §B2 step 5**

Return shape: `{ status: 'noop', reason: <one-of: "lock_held" | "no_rows_to_claim" | "predicate_filtered" | "already_processed">, jobName: <string> }`. Emit `job_noop: <jobName> reason=<reason>` INFO log line. **Zero-side-effects invariant** per spec §B2 step 5 Round-3 — `noop` MUST mean "nothing changed", full stop. Pre-write check evaluated BEFORE any mutation.

- [ ] **Step 6: Implement `__testHooks` seam**

Export `__testHooks` object with `pauseBetweenClaimAndCommit?: () => Promise<void>`. Default no-op. Honour 3 production-safety conditions per Step 1 contract.

- [ ] **Step 7: Run tests — expect PASS**

Run sequential + parallel + mid-execution-failure cases.

- [ ] **Step 8: Run parallel test 10 times to surface flakiness**

Per spec §B2 Risk mitigation — wrap parallel-double-invocation in 10-iteration `for` loop inside the test file, OR re-invoke the test 10 times via shell. **Do NOT add Jest as a dependency.** Run all 10 iterations clean.

- [ ] **Step 9: For LAST job — author/extend the gate per spec §B2 step 4**

Either new `scripts/verify-job-concurrency-headers.sh` OR **preferred** extend `scripts/verify-job-idempotency-keys.sh` to cross-check every `JOB_CONFIG` entry's handler file carries the standard header (if extension stays under ~30 lines). Lint every `server/jobs/*.ts` for `Concurrency model:` and `Idempotency model:` lines. Add advisory `__testHooks` discipline check per spec §B2 step 3 Round-4 (grep for unconditional `await __testHooks.` calls; advisory only).

- [ ] **Step 10: For LAST job — append paragraph to `architecture.md` § Architecture Rules**

Per spec §B2-ext DoD — exact paragraph from spec lines 608. Includes concurrency rule, per-org default lock-scope rule, and §0.5 partial-execution rule for jobs.

- [ ] **Step 11: Per-job commit (one PR per job)**

```bash
git add server/jobs/<jobName>.ts server/jobs/__tests__/<jobName>.idempotency.test.ts docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(jobs): B2 — <jobName> idempotency + concurrency standard with regression tests"
```

For the last job — also include `scripts/verify-job-*.sh` and `architecture.md`.

- [ ] **Step 12: Wait one scheduled cycle in production before next job starts**

Per the per-job ordering rule — do not start next job until current has been live one cycle without alerts.

- [ ] **Step 13: Flip §5 Tracking — TWO rows**

B2 (idempotency) and B2-ext (concurrency) ship in separate rows. Both can be flipped to ✓ when all 4 jobs carry both Idempotency model: + Concurrency model: header sections, all 4 sequential + parallel tests pass, and (for B2-ext) `architecture.md` carries the paragraph.

**DoD pointer:** spec §B2 Definition of Done (idempotency only) + spec §B2-ext Definition of Done (concurrency only) — partial completion is fine; either row can flip independently.

---

### Task 3.4 — A2: RLS write-boundary enforcement guard (THREE PHASES)

**Spec section:** §1 Group A — A2 (lines 296–391). **Build slug:** `…/a2-rls-boundary-guard/`. **Risk:** medium. **Effort:** 3–4 days, spread across phases. **Independent of A1.** **Ships LAST in this spec to maximise observation time on Wave 1+2 changes.**

**Files (across phases):**
- Create (Phase 1): `scripts/verify-rls-protected-tables.sh`, `scripts/rls-not-applicable-allowlist.txt`.
- Create (Phase 2): `.claude/hooks/rls-migration-guard.js`.
- Create (Phase 3): `server/lib/rlsBoundaryGuard.ts`, `server/lib/__tests__/rlsBoundaryGuard.test.ts`.
- Modify: `server/config/rlsProtectedTables.ts` (header-comment path correction), `scripts/verify-rls-coverage.sh` (cross-link).
- Modify (Phase 3): `architecture.md` § Architecture Rules — add the A2 paragraph per spec §A2 Phase-3 DoD.

**Phasing rule:** ship Phase N only after Phase N-1 has been live one full sprint with no FP-issues filed. Per spec §A2 confidence-gate.

---

#### Phase 1 — schema-vs-registry diff gate

- [ ] **Step 1.1: Create `scripts/rls-not-applicable-allowlist.txt`**

One table-name + one-line rationale per row. Initial entries — any tables with `organisation_id` but legitimately no RLS (e.g. read replicas, audit ledgers). Single source of truth for both gate and runtime guard.

- [ ] **Step 1.2: Author `scripts/verify-rls-protected-tables.sh`**

Per spec §A2 Approach step 1 — parse `migrations/*.sql` (top-level path) for every `CREATE TABLE` with `organisation_id` column. Diff against `rlsProtectedTables` registry. Three failure modes:
- In migrations + not in registry + not in allowlist → fail.
- In registry + not in any migration → fail (stale entry).
- In allowlist → exempt.

Source `scripts/lib/guard-utils.sh`; emit `[GATE] rls-protected-tables: violations=<count>` per C1.

- [ ] **Step 1.3: Correct header comment in `server/config/rlsProtectedTables.ts:8`**

The header references `scripts/gates/verify-rls-coverage.sh`; actual path is `scripts/verify-rls-coverage.sh` (no `gates/` subdirectory). Fix to point at the correct path AND cross-link the new `verify-rls-protected-tables.sh`.

- [ ] **Step 1.4: Author gate self-test fixture**

Under `scripts/__tests__/rls-protected-tables/` — fixture migration introducing deliberate gap. Gate must fail naming the new tenant table.

- [ ] **Step 1.5: Run gate; expect 0 violations on current main**

```bash
bash scripts/verify-rls-protected-tables.sh 2>&1 | grep -E '^\[GATE\] '
```

- [ ] **Step 1.6: Commit Phase 1**

```bash
git add scripts/verify-rls-protected-tables.sh scripts/rls-not-applicable-allowlist.txt scripts/verify-rls-coverage.sh server/config/rlsProtectedTables.ts scripts/__tests__/rls-protected-tables/ docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(verify): A2-Phase-1 — schema-vs-registry RLS diff gate (blocking)"
```

**Phase 1 DoD pointer:** spec §A2 Definition of Done — A2-Phase-1.

**Phase 1 confidence gate:** wait one sprint; confirm zero FP-issues filed before starting Phase 2.

---

#### Phase 2 — migration-time hook (advisory)

- [ ] **Step 2.1: Author `.claude/hooks/rls-migration-guard.js`**

Per spec §A2 Approach step 3 — PostToolUse hook on Write/Edit to `migrations/*.sql`. Parse SQL diff. If new `CREATE TABLE` includes `organisation_id` AND no matching `CREATE POLICY` in same file or sibling migration files → emit advisory warning pointing at registry file.

- [ ] **Step 2.2: Wire into `.claude/settings.json` hooks config**

Use the `update-config` skill if needed. Hook is advisory-only (NOT blocking).

- [ ] **Step 2.3: Manual test — author a deliberate migration without `CREATE POLICY`**

Confirm warning emits.

- [ ] **Step 2.4: Commit Phase 2**

```bash
git add .claude/hooks/rls-migration-guard.js .claude/settings.json docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(hooks): A2-Phase-2 — advisory migration hook for RLS policy authoring"
```

**Phase 2 DoD pointer:** spec §A2 Definition of Done — A2-Phase-2.

**Phase 2 confidence gate:** wait one sprint; confirm Phase 1 still has zero FP-issues; Phase 2 advisory warnings produce no false positives.

---

#### Phase 3 — runtime guard (dev/test only)

- [ ] **Step 3.1: Write failing tests first per spec §A2 Tests required**

`server/lib/__tests__/rlsBoundaryGuard.test.ts` — 6 cases per spec lines 361–367:
1. `getOrgScopedDb` writes registered table → succeeds.
2. `getOrgScopedDb` writes unregistered + non-allowlisted in dev → throws `RlsBoundaryUnregistered`.
3. `getOrgScopedDb` writes table in allowlist → succeeds.
4. `withAdminConnectionGuarded({ allowRlsBypass: false }, …)` writes registered table in dev → throws `RlsBoundaryAdminWriteToProtectedTable`.
5. Same write under `allowRlsBypass: true` → succeeds.
6. **Proxy-transparency check** — chained `tx.insert(table).values(row).returning()` via guarded handle returns same shape as raw handle.

- [ ] **Step 3.2: Run tests — expect FAIL (no implementation yet)**

- [ ] **Step 3.3: Author `server/lib/rlsBoundaryGuard.ts`**

Per spec §A2 Approach step 2:
- Export `assertRlsAwareWrite(tableName)`.
- Wrap `getOrgScopedDb`'s returned handle with Proxy intercepting `.insert(table)`, `.update(table)`, `.delete(table)`. Production: no-op. Dev/test: enforce.
- Define `withAdminConnectionGuarded({ allowRlsBypass: boolean }, fn)` — wraps `withAdminConnection`; applies Proxy interception to `tx`. Default `allowRlsBypass: false` → throws on protected-table writes. `allowRlsBypass: true` → permits.
- **Proxy must NOT change method signatures** per spec §A2 Approach step 2 — forwards args unchanged, returns whatever underlying method returns.
- Sibling of `server/lib/orgScopedDb.ts`; NOT under a new `server/lib/db/` subdirectory.

- [ ] **Step 3.4: Run tests — expect PASS for all 6 cases**

- [ ] **Step 3.5: Run NODE_ENV=production smoke**

Same writes under `NODE_ENV=production` → no throw (production delegates to RLS policy itself).

- [ ] **Step 3.6: Extend `verify-rls-protected-tables.sh` with `allowRlsBypass: true` justification check**

Per spec §A2 Approach step 2 Round-3 flag-drift protection — grep for `allowRlsBypass:\s*true` across `server/`. Fail if any hit lacks an inline justification comment within ±1 line. Mandatory comment shape: `// allowRlsBypass: <one-sentence justification>`.

**Blocking from day 1** — no advisory-mode interim. Gate ships alongside Phase 3.

- [ ] **Step 3.7: Extend `verify-rls-protected-tables.sh` with write-path advisory check**

Per spec §A2 Approach step 2 Round-4 Proxy coverage completeness — grep `server/` for `\.execute\(\s*sql` calls referencing tenant-table names (from `rlsProtectedTables`) without a same-block `assertRlsAwareWrite(` call within ±10 lines. **Ships ADVISORY** — emits violations, exits 0; baseline tracked in `scripts/guard-baselines.json`. Promotion to blocking follows §0.1 protocol.

- [ ] **Step 3.8: Audit + annotate existing `allowRlsBypass: true` call sites**

For every existing `allowRlsBypass: true` call site (initially none — `withAdminConnectionGuarded` is new in Phase 3, so this only applies as callers migrate): add inline justification comment.

- [ ] **Step 3.9: Update `architecture.md` § Architecture Rules**

Add the A2 paragraph verbatim per spec §A2 Phase-3 DoD (lines 388 of spec). Names the write contract, `allowRlsBypass` declaration semantics, justification-comment requirement, and allowlist file path.

- [ ] **Step 3.10: Commit Phase 3**

```bash
git add server/lib/rlsBoundaryGuard.ts server/lib/__tests__/rlsBoundaryGuard.test.ts scripts/verify-rls-protected-tables.sh architecture.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "feat(rls): A2-Phase-3 — runtime write-boundary guard (dev/test) + flag-drift checks"
```

- [ ] **Step 3.11: Flip §5 Tracking row to ✓ — A2 phases all complete**

Phase-by-phase annotations in build-slug progress log; single ✓ flip when all three phases ship.

**Phase 3 DoD pointer:** spec §A2 Definition of Done — A2-Phase-3. Confidence gate: no FP-issues filed against Phases 1+2 in preceding 2-3 weeks.

---

---

## F2 — Parked behind Phase-5A

**Spec section:** §1 Group F — F2 (lines 1154–1223). **Status:** PARKED. **Cannot start until Phase-5A `rateLimitStoreService` ships.**

F2 has three possible outcomes determined at the moment Phase-5A merges. **Do NOT start any code work until then.**

- [ ] **Wait gate: Monitor Phase-5A status**

Check periodically (during sprint planning, e.g.). When Phase-5A merges, evaluate `server/services/rateLimitStoreService.ts`'s API surface.

- [ ] **Decision: Pick case (a), (b), or (c) per spec §F2 Approach step 1**

- **(a) Phase-5A merged with general-purpose KV-with-TTL surface** (`set(key, value, ttlMs)` / `get(key)`) → proceed with consumer-only migration of `configDocuments.ts:33-36, 103-104`. Author the F2 build slug `…/f2-config-documents-cache/` and follow spec §F2 Approach steps 2–4.
- **(b) Phase-5A merged with shape-specific surface** (`incrementBucket` / `sumWindow` only) → STOP. Append the F2 deferred entry to `tasks/todo.md` per spec §F2 Acceptance criteria (case b) — MUST include owner, three measurable re-evaluation triggers per spec §F2 Round-4 contract, back-link to spec § F2. Flip §5 Tracking row to `↗ migrated to deferred`.
- **(c) Phase-5A still not merged** → continue waiting; do not start.

- [ ] **(a) only) Migrate `configDocuments.ts`**

Per spec §F2 Approach step 2 — replace `parsedCache.set(id, summary)` + `setTimeout` deletion with `await rateLimitStoreService.set(id, summary, CACHE_TTL_MS)`; replace `parsedCache.get(id)` with `await rateLimitStoreService.get(id)`.

- [ ] **(a) only) Add cache-miss → re-parse pure-function test**

Per spec §F2 Tests required — pure test only (NO multi-process integration test; that sits outside the carved-out integration envelope per spec §0 testing posture). Restart durability is verified via the manual smoke step in spec §F2 Acceptance criteria.

- [ ] **(a) only) Manual smoke — restart durability**

Start server, set value, restart, read value. Asserts the store survives process restart.

- [ ] **(a) only) Commit + flip §5 row**

```bash
git add server/routes/configDocuments.ts server/routes/__tests__/configDocuments.test.ts docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "perf(configDocuments): F2 — migrate parsedCache to rateLimitStoreService for durability"
```

- [ ] **(b) only) Append deferred entry to tasks/todo.md**

Use the exact shape from spec §F2 Acceptance criteria (case b) — include owner, three re-evaluation triggers (second KV-TTL consumer surfaces, route median latency >500ms, OR `configDocuments`-domain build slug opens), back-link.

```bash
git add tasks/todo.md docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
git commit -m "docs(audit-remediation-followups): F2 — defer to follow-up; rateLimitStoreService surface doesn't fit"
```

**DoD pointer:** spec §F2 Definition of Done.

**STRICT scope rule per §0.2:** F2 MUST NOT introduce a new generic `kvStoreWithTtl` primitive. If Phase-5A's surface doesn't fit, F2 stays deferred until a second KV-TTL consumer surfaces.

---

---

## Closing — exit criteria + audit posture

### Exit criteria (per spec §4)

The spec is complete when:
- All §5 Tracking rows are `✓` or `↗` (migrated).
- Every gate introduced by this spec emits the C1 standard count line.
- `architecture.md` § Architecture Rules carries:
  - The H1 derived-data null-safety rule (Wave 2 Task 2.5).
  - The B2 / B2-ext concurrency-model + per-org-default-lock-scope + §0.5 partial-execution paragraph (Wave 3 Task 3.3).
  - The A2 RLS write-boundary contract paragraph (Wave 3 Task 3.4 Phase 3).
  - The C1 `[GATE]` line emission rule (Wave 1 Task 1.2).
- Every new gate has a deliberate-violation fixture proving it fires.
- No items moved to "deferred" silently — anything not implemented is rejected (spec §3) or rescheduled with rationale.

### Per-item integrity check (spec §4.1)

Before flipping any §5 row from `⧖` to `✓`:
1. **All DoD conditions pass in CI.** Not "passes locally"; not "passes if you skip the flaky test"; not "ships red because the gate is advisory". Independent CI verification on the merge commit.
2. **No TODOs or placeholders remain in changed files.** Grep diff for `TODO`, `FIXME`, `XXX`, `HACK`, `<placeholder>`, `<TBD>`, item-specific markers (e.g. `// @deprecated — remove in A1b` is OK in A1a's PR but must NOT survive A1b's PR).
3. **All new invariants are observable via logs or tests.** `[GATE]` line, `job_noop:` INFO log, `data_dependency_missing:` WARN log, regression-test assertions, gate self-test fixtures — all exercised by something an operator or test can read.
4. **No silent fallbacks introduced.** Every catch-and-continue path emits a log line naming what was caught and why; otherwise re-throw.

### Review pipeline reminder

For every Wave 1+2+3 item that is Standard/Significant/Major:
1. **`spec-conformance`** first (spec-driven items). If it returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set.
2. **`pr-reviewer`** — always.
3. **`dual-reviewer`** — optional, local-only, ONLY when user explicitly asks.
4. **`chatgpt-pr-review`** — optional, in a dedicated new Claude Code session.

Trivial items (B1, C4, D2, G2) can skip the full pipeline; spot-check via lint + tests.

### Spec / plan / progress maintenance

- **Spec §5 Tracking** is the single source of truth for item status. Update in the same PR that ships the item.
- **Plan (this document)** is structural — update only if Wave sequencing changes or a new item is added to the spec.
- **`tasks/builds/audit-remediation-followups/progress.md`** — update Wave merge counts as items complete; append decisions/observations under the named heading.
- **`tasks/current-focus.md`** — update when Wave shifts (Wave 1 → Wave 2 → Wave 3 → done).

### Total estimate (per spec §2)

- 4–5 weeks of focused effort (one engineer).
- 3–3.5 weeks if multiple chunks ship in parallel within Waves 1+2.
- Wave 3 is intentionally serial; do not bundle items there.
- Re-estimate per-chunk during build slug planning.

---

## Self-review

**1. Spec coverage:** all 21 items in spec §1 (A1a, A1b, A2, A3, B1, B2, B2-ext, C1, C2, C3, C4, D1, D2, D3, E1, E2, F1, F2, G1, G2, H1) have a Task in this plan. ✓

**2. Cross-cutting rules (§0.1–§0.7, §4.1):** referenced in plan-of-plans posture; per-item Tasks invoke them where load-bearing. ✓

**3. Sequencing fidelity:** Wave order matches spec §2 — G2, C1 (foundational), G1, D1/D2/D3, E1/E2, B1/C4 (Wave 1); C2/C3, A3, F1, H1 (Wave 2); A1a, A1b, B2 (4 jobs strict order), A2 (3 phases) (Wave 3); F2 parked. ✓

**4. Per-item structure:** every Task carries Build slug, Files, Risk, DoD pointer. ✓

**5. No execution-choice prompt:** plan honours `CLAUDE.md` override — proceed directly with `superpowers:subagent-driven-development` per item; no menu offered. ✓

**6. Long-doc-guard compliance:** plan authored via chunked workflow (Write skeleton + Edit per Wave) per the long-doc-guard discipline. ✓


