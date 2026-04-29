# Spec Review Log — pre-prod-tenancy — Iteration 1

**Spec path:** `docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`
**Spec commit at start of iteration:** `bb0b276671de652929c21b23a0e7eae8adcaaffe`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Pre-loop plan:** `tasks/review-logs/spec-review-plan-pre-prod-tenancy-2026-04-29T02-26-40Z.md`
**Codex output (raw):** `tasks/review-logs/.codex-output-iter1.txt`
**Codex prompt (raw):** `tasks/review-logs/.codex-prompt-iter1.txt`

> **Provenance note.** Iteration 1 was started by the `spec-reviewer` agent (foreground invocation). The agent applied all eight Codex findings as mechanical edits, plus four `bash …` → `CI gate …` rewrites required by the CLAUDE.md "test gates are CI-only — never run locally" rule (these are mandatory mechanical fixes per the agent's Step 6 rubric). The session was finalised in the same main session that invoked the agent (manual scratch-log + commit) after the agent's stream timed out before it could write its iteration-end summary; the spec edits, the Codex transcripts, and the per-finding classifications below are all the agent's work, captured here for the audit trail.

---

## Findings

### FINDING 1 — Phase 1 table count is stated two ways

- **Source:** Codex
- **Section:** §0.2 / §3.2 (lines 44, 177–182 at start-of-iteration)
- **Severity:** important
- **Description:** §0.2 said "60 currently-unregistered tenant tables" while §3.2 said 63. The 60 was stale.
- **Codex's suggested fix:** Change §0.2 to "63 currently-unregistered tenant tables" or point at §3.4 as the source of truth.
- **Classification:** `mechanical` (consistency contradiction; fix does not change scope or direction).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §0.2 now reads "61 currently-unregistered tenant tables (per §3.2 / §3.4.1 — that section is the source of truth for the count) … plus 4 stale entries (§3.4.2) … plus 2 caller-level violations on `systemMonitor` files (§3.4.3)." §3.2 expanded to enumerate the 61 + 4 + 2 = 67 breakdown explicitly. The 60-figure was the brief's; the post-merge count was actually 61 (one of the original 63 already counted as 2 caller-level entries the brief didn't surface).

### FINDING 2 — Phase 1 classification table has no explicit verdicts

- **Source:** Codex
- **Section:** §3.4 (lines 202–231 at start-of-iteration)
- **Severity:** critical
- **Description:** §3.4 said each row "carries the verdict" but immediately said verdicts were "not yet filled in" and §3.4.1 was a comma-separated list — violating the explicit-verdict requirement.
- **Codex's suggested fix:** Replace the comma-separated list with `Table | Owning migration | Has policy? | Verdict | Notes` and fill every row, OR mark Phase 1 explicitly as discovery-only.
- **Classification:** `mechanical` (the table SHAPE issue is mechanical — give the table the verdict columns it advertises). The choice of "fill at spec-authoring time vs. fill at implementation time" is directional, but the spec already says verdict-filling IS Phase 1's first deliverable — so the resolution is to give the table the structured columns and keep "implementer fills in" framing explicit per row.
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §3.4.1 replaced with a 61-row table with columns `Table | Owning migration | Has policy? | Verdict | Notes`. Every cell is `_(implementer)_` to flag the pending-fill state. Two rows (`workflow_engines`, `workflow_runs`) carry sister-branch-scope-out notes per §0.4. Framing block above the table now explicitly says "the verdict column is INTENTIONALLY EMPTY at spec-authoring time" with the rationale that pre-classifying 61 tables here would do the implementation work in the spec.

### FINDING 3 — Files-to-change inventory omits modified files named by the implementation

- **Source:** Codex
- **Section:** §2.2 / §3.5 / §4.3 / §4.8
- **Severity:** critical
- **Description:** §4.3 modifies `server/services/interventionService.ts` but it wasn't in §2.2. §3 + §4 require writing `tasks/builds/pre-prod-tenancy/progress.md` but that wasn't in the inventory either.
- **Codex's suggested fix:** Add `interventionService.ts`, `progress.md`, and `tasks/todo.md` (if applicable) to §2.
- **Classification:** `mechanical` (file-inventory drift — rule lives at spec-authoring-checklist §2; fix is a one-line append per missing file).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §2.2 now lists `server/services/interventionService.ts` (Phase 2 — `recordOutcome` signature change) plus the two `systemMonitor` callers identified by FINDING 1's expanded scope (Phase 1, §3.4.3). New §2.6 "Build artefacts" added for `tasks/builds/pre-prod-tenancy/progress.md` and `tasks/todo.md`.

### FINDING 4 — Migration batching is internally contradictory

- **Source:** Codex
- **Section:** §2.1 / §3.5 / §6 (lines 110, 245–249, 486 at start-of-iteration)
- **Severity:** important
- **Description:** §2.1 said "one file per tenant-scoped table" but the same row also said "batched up to 4 tables per file." §3.5 + §6 relied on batching.
- **Codex's suggested fix:** Replace "one file per tenant-scoped table" with "one migration file per policy-shape batch — up to 4 canonical tables per file; parent-EXISTS / custom tables get standalone files."
- **Classification:** `mechanical` (internal contradiction; resolution adopts the rule the rest of the spec already relies on).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §2.1 row rewritten to "Batching rule: one migration file per policy-shape batch — up to 4 canonical-org-isolation tables per file; tables that need parent-EXISTS or any other custom shape each get their own standalone file." §6 row 2 also picked up the `0245_<batch>_rls.sql` naming.

### FINDING 5 — Phase 2's RLS-gate acceptance contradicts Phase 1's open inventory

- **Source:** Codex
- **Section:** §3.4.1 / §4.8 / §6 / §8.1 (lines 216, 394, 485, 553–557 at start-of-iteration)
- **Severity:** important
- **Description:** `intervention_outcomes` is in §3.4.1's unregistered-tables list, but §4.8 said the Phase 2 schema change is a no-op for the gate "because the table is already in the registry." Logically inconsistent — at branch tip, the table is unregistered.
- **Codex's suggested fix:** Either Phase 2 depends on Phase 1's registration of `intervention_outcomes`, or Phase 2 carries a local registration step before the unique-index acceptance gate.
- **Classification:** `mechanical` (a load-bearing claim — "RLS gate is a no-op for the schema change" — was contradicted elsewhere in the spec and needs reconciliation).
- **Disposition:** ACCEPT — applied (with the framing clarified rather than introducing a Phase-2-local registration).
- **Fix applied:** §4.8's "still exits 0" criterion replaced with "The Phase 2 schema change introduces no new RLS-gate violations of its own. (`intervention_outcomes` is named in §3.4.1 as a Phase 1 deliverable — Phase 1 owns driving `verify-rls-protected-tables.sh` to exit 0. Phase 2 is required not to *worsen* the gate; it is not on the hook for the pre-existing violation. See §6 / §8.1 for ordering.)" §6's row 1 and §3.4.1's `intervention_outcomes` row now also note this Phase 1 / Phase 2 division of labour.

### FINDING 6 — Phase 3 changes concurrency semantics but §10 declares no concurrency contract needed

- **Source:** Codex
- **Section:** §5.2 / §5.3 / §10 (lines 451–455, 461–463, 616 at start-of-iteration)
- **Severity:** important
- **Description:** §5 explicitly says advisory-lock semantics may change and the implementer must decide whether locks protect enumeration or per-org work, but §10's table said Phase 3 introduces "no new concurrent-write contests." Load-bearing claim without a per-job mechanism.
- **Codex's suggested fix:** Add a Phase 3 execution-safety subsection naming each job's lock scope, retry classification, idempotency posture, and losing-run/noop behaviour, OR defer Phase 3 entirely.
- **Classification:** `mechanical` (Section-10 contract gap; the fix is to add the missing per-job contract — adding the contract does not change Phase 3's scope).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** New §5.6 "Per-job concurrency contract (Section-10 §10.3)" added. Pinned: Pattern A (enumeration-only lock) vs. Pattern B (per-org session-level lock required) decision tree, the pre-commit `progress.md` deliverable per job, idempotency posture (`state-based`), retry classification (`safe`). §10's table updated to point at §5.6 for §10.1 / §10.2 / §10.3 / §10.5 in the Phase 3 column. The closing paragraph of §10 also rewritten to acknowledge Phase 3's lock-lifetime change.

### FINDING 7 — Load-test acceptance has conflicting pass/fallback language

- **Source:** Codex
- **Section:** §4.7 / §4.8 / §9 (lines 374–383, 392, 592 at start-of-iteration)
- **Severity:** minor
- **Description:** §4.7 said the 5× speedup must still be demonstrated even with a blocker, but §4.8 accepted "≥5× speedup vs. legacy or recorded blocker" — a blocker on the relative comparison itself.
- **Codex's suggested fix:** Change §4.8 to require "5× speedup vs. legacy on either the full fixture or named smaller fixture; absolute rows/sec/org may be deferred with a blocker note."
- **Classification:** `mechanical` (acceptance-criterion drift from the prose).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §4.8 acceptance criterion now reads "Load-test result appears in `tasks/builds/pre-prod-tenancy/progress.md`. The 5× speedup vs. legacy must be demonstrated against either the full §4.7 fixture (10,000 rows / 5 orgs) or the smaller fallback fixture (1,000 rows / 2 orgs); only the absolute rows/sec/org figure may be deferred (with a blocker note explaining why the local seed couldn't be set up — routed to §9)."

### FINDING 8 — `recordOutcome` return contract is not pinned as a concrete signature

- **Source:** Codex
- **Section:** §4.3 / §4.4 (with source evidence `server/services/interventionService.ts:53`)
- **Severity:** important
- **Description:** Spec used `const wrote = await interventionService.recordOutcome(...)` and said the function returns `true/false`, but the current signature is `Promise<void>` and the spec never gave the replacement signature.
- **Codex's suggested fix:** Add the exact new signature in §4.3 (e.g. `async recordOutcome(data: RecordOutcomeInput): Promise<boolean>`).
- **Classification:** `mechanical` (unnamed primitive — Section-1 / spec-authoring-checklist gap; resolution is to pin the signature).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §4.3 now contains an explicit before/after signature block: before `Promise<void>`, after `Promise<boolean>`, with a parenthetical pinning that the input shape is the existing inline object literal at `server/services/interventionService.ts:53–70` and is reused unchanged.

---

## Rubric findings (raised by the agent, not by Codex)

### RUBRIC-1 — Acceptance criteria reference local gate runs (CLAUDE.md "gates are CI-only")

- **Source:** Rubric (gate-cadence rule from CLAUDE.md § *Test gates are CI-only — never run locally*; spec-reviewer Step-6 mandatory rejection — applied here as a mechanical SPEC fix per the same rule's positive form: specs MUST NOT instruct implementers to run gates locally).
- **Section:** §3.1, §3.6, §4.8, §5.4
- **Description:** Multiple acceptance criteria contained `bash scripts/verify-rls-protected-tables.sh` as a checkable invariant the implementer must run.
- **Classification:** `mechanical` (rephrase the criterion to a CI invariant; scope unchanged).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** Every `bash scripts/...` invocation in acceptance / implementation prose was rewritten to "CI gate `<name>` …" or to a grep / typecheck the implementer can run locally without invoking the broader gate harness. §3.1 now adds an explicit framing line: "Gates are CI-only per CLAUDE.md — no part of this phase asks an implementer to run them locally; the acceptance criteria below are CI invariants."

### RUBRIC-2 — `verify-rls-protected-tables.sh` produces 2 caller-level `allowRlsBypass` violations the spec did not surface

- **Source:** Rubric (gate-output completeness — agent re-checked the violation breakdown during context-gathering).
- **Section:** §3.2 / §3.4
- **Description:** The 67-violation total is 61 unregistered + 4 stale + **2 caller-level** (`server/services/systemMonitor/baselines/refreshJob.ts:39` and `server/services/systemMonitor/triage/loadCandidates.ts:45` carry `allowRlsBypass: true` without an inline justification comment within ±1 line). The original spec described only the 60+4 and 63+4 framings.
- **Classification:** `mechanical` (the spec's stated open-inventory was incomplete; surfacing the residual two-violation class is a consistency fix the implementer must address to drive the gate to exit 0).
- **Disposition:** ACCEPT — applied.
- **Fix applied:** §3.2 now lists the two caller-level violations alongside the 61 unregistered + 4 stale. New §3.4.3 "Caller-level `allowRlsBypass` justification-comment violations (2)" pins the per-file remediation. §2.2 picks up the two `systemMonitor` files. §3.5 step 5 adds the resolution as an explicit step in the per-commit cadence.

---

## Iteration 1 Summary

- Mechanical findings accepted: **10** (8 Codex + 2 rubric)
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 0
- Spec commit after iteration: _(set by commit step below)_

**Stopping-heuristic relevance:** iteration 1 is mechanical-only (no directional / ambiguous / reclassified). One more mechanical-only round would trigger the two-consecutive-mechanical-only stop. No early stop is available at iteration 1.
