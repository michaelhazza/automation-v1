# Pre-Launch Hardening — Spec Authoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Important:** This branch is **spec-only**. No application code changes. Each task produces / iterates a spec document and (for some tasks) an architect output. Implementation is out of scope and will be picked up on follow-on branches once each spec is merged.

**Goal:** Turn `docs/pre-launch-hardening-mini-spec.md` into 6 fully-authored, spec-reviewer-clean per-chunk specs and land each via its own PR before any pre-launch hardening code work begins.

**Architecture:** Six independent spec documents in `docs/`, each scoped to one chunk of the mini-spec. Two chunks (Schema Decisions, Dead-Path Completion) get a pre-spec architect pass; the other four are planned inline. Every finished draft runs through `spec-reviewer` until clean (or its 5-iteration lifetime cap). Cited todo items are annotated in `tasks/todo.md` with the owning spec slug.

**Tech Stack:** Markdown spec authoring · `architect` agent · `spec-reviewer` agent · git branching per spec / per PR.

---

## Table of contents

1. Pre-flight findings (must read before Task 0)
2. Repository assumptions · File structure · Sequencing
3. Per-task structure template
4. Task 0 — Branch setup
5. Task 0.5 — Bring the mini-spec onto the branch
6. Task 0.6 — Author cross-chunk invariants doc
7. Task 1 — Chunk 1 — RLS Hardening Sweep (inline)
8. Task 2.1 — Architect dispatch for Chunk 2
9. Task 3.1 — Architect dispatch for Chunk 3
10. Task 4 — Chunk 4 — Maintenance Job RLS Contract (inline)
11. Task 6 — Chunk 6 — Gate Hygiene Cleanup (inline)
12. Architect-output conflict check (pre-Task-2/3 gate)
13. Task 2 — Chunk 2 — Schema Decisions + Renames
14. Task 5 — Chunk 5 — Execution-Path Correctness (inline)
15. Task 3 — Chunk 3 — Dead-Path Completion
16. Task 6.5 — Spec freeze gate
17. Task 6.6 — Cross-spec consistency sweep
18. Task 7 — Handoff log
19. Cross-cutting protocols
20. Self-Review
21. Open questions for the user before Task 0 starts

---

## §1 Pre-flight findings (must read before Task 0)

These were surfaced while validating the mini-spec against the working tree and `tasks/todo.md`. They affect Task 0 (branch setup) and the per-chunk specs that own the affected IDs.

### Branch state

- Current branch: `claude/add-system-monitoring-BgLlY` (active system-monitor work — unrelated).
- Mini-spec was committed as `1023ff02 docs(planning): add pre-launch hardening mini-spec` on `claude/deferred-quality-fixes-ZKgVV` (PR #203).
- That commit is **not** on `main` and **not** on the current branch. It exists at `origin/claude/deferred-quality-fixes-ZKgVV` and locally as a reachable commit.
- The mini-spec recommends `spec/pre-launch-hardening` as the branch name. We will create that branch from `main` and bring the mini-spec across.

### IDs cited in the mini-spec but not labeled in `tasks/todo.md`

The mini-spec coined new handles for unlabeled todo entries. Each will be cited in the owning spec as `<mini-spec-handle> (todo.md:<line> "<short description>")` so reviewers can trace provenance.

| Mini-spec handle | Owning chunk | todo.md location | Resolution |
|---|---|---|---|
| `DELEG-CANONICAL` | Chunk 2 | line 332 — "Designate a canonical source of truth for delegation analytics" | Cite line + description |
| `BUNDLE-DISMISS-RLS` | Chunk 2 | line 480 — "`bundle_suggestion_dismissals` unique-key vs. org-scoped RLS mismatch" | Cite line + description |
| `CACHED-CTX-DOC` | Chunk 2 | line 491 — "Subaccount isolation decision — document Option B-lite posture" | Cite line + description |
| `C4a-REVIEWED-DISP` | Chunk 3 | line 665 — "Review-gated `invoke_automation` steps never dispatch after approval" | Cite line + description |
| `C4a-6-RETSHAPE` | Chunk 5 | line 337 — "REQ #C4a-6 — Return-shape contract for delegation errors" | Cite todo's existing label `C4a-6` + the suffix |
| `C4b-INVAL-RACE` | Chunk 5 | line 667 — "Inline-dispatch step handlers do not re-check invalidation after awaiting external I/O" | Cite line + description |
| `HERMES-S1` | Chunk 5 | lines 92–105 — "Hermes Tier 1 — Deferred Item (S1 from pr-reviewer) §6.8 errorMessage gap" | Cite todo's existing handle "Hermes S1" |
| `H3-PARTIAL-COUPLING` | Chunk 5 | line 152 — "H3 — `runResultStatus='partial'` coupling to summary presence" | Cite todo's existing label `H3` |

### IDs cited in the mini-spec that need investigation before their owning spec is drafted

| Mini-spec handle | Owning chunk | Issue | Investigation |
|---|---|---|---|
| `SC-1` / `SC-2026-04-26-1` | Chunk 1 | "60-table delta between RLS-protected-tables registry and migrations" — not found as a labeled item in `tasks/todo.md` | Re-run / re-derive the delta during Chunk 1 spec drafting. Per-table classification (tenant vs system) is the spec's first deliverable. |
| `GATES-2026-04-26-1` | Chunk 1 | "`reference_documents` / `_versions` FORCE RLS via parent-EXISTS WITH CHECK" — closest match is line 935 (RESOLVED B-1/B-2/B-3 with explicit follow-on note) | Cite line 935's resolved-with-followup note as the source. Spec describes the parent-EXISTS variant migration. |
| `SC-COVERAGE-BASELINE` | Chunk 6 | "capture pre-Phase-2 baseline counts before testing changes them" — closest match is `REQ #35` at line 916 | Cite line 916. Spec defines the baseline-capture procedure. |
| `GATES-2` / `RLS-CONTRACT-IMPORT` | Chunk 6 | "gate skips `import type` lines" — no labeled item in todo.md | Investigate gate scripts during Chunk 6 drafting; if no source-of-truth exists, the spec proposes it as the first authoritative description. |

These investigations happen **inside** the Task they affect (not in pre-flight) so the plan stays linear.

---

## §2 Repository assumptions · File structure · Sequencing

### Repository assumptions

- `docs/spec-authoring-checklist.md` and `docs/spec-context.md` exist on this branch. (Verified.)
- `tasks/todo.md` exists on this branch. (Verified, 954 lines.)
- The mini-spec content is not on this branch; it is reachable at commit `1023ff02`. We will copy it onto the new branch via `git show` rather than cherry-pick (mini-spec content only — no other commit baggage).
- No application code is touched. No verification commands beyond `git status` and grep.

### File structure

Each chunk produces one spec at `docs/pre-launch-<chunk-slug>-spec.md`. Architect outputs land in `tasks/builds/pre-launch-hardening-specs/architect-output/<chunk-slug>.md` so they're reviewable but separate from the spec PR. Spec-reviewer logs follow the existing convention at `tasks/review-logs/spec-reviewer-log-<spec-slug>-<timestamp>.md` (the agent self-writes; we don't pre-create the directory).

```
docs/
  pre-launch-hardening-mini-spec.md           ← copied from 1023ff02 (Task 0.5)
  pre-launch-rls-hardening-spec.md            ← Chunk 1
  pre-launch-schema-decisions-spec.md         ← Chunk 2
  pre-launch-dead-path-completion-spec.md     ← Chunk 3
  pre-launch-maintenance-job-rls-spec.md      ← Chunk 4
  pre-launch-execution-correctness-spec.md    ← Chunk 5
  pre-launch-gate-hygiene-spec.md             ← Chunk 6
tasks/
  builds/pre-launch-hardening-specs/
    plan.md                                   ← this file
    progress.md                               ← created in Task 0
    architect-output/
      schema-decisions.md                     ← Task 2.1
      dead-path-completion.md                 ← Task 3.1
  todo.md                                     ← annotated in each chunk's Task N.4
  review-logs/spec-reviewer-log-...           ← agent-written
```

### Sequencing summary

The mini-spec mandates implementation order `1 → {2, 4, 6} parallel → 5 after 2 → 3 last`. Spec-authoring order is different — driven by where architect calls block, not by code dependency:

```
Task 0     Branch setup
Task 0.5   Bring mini-spec onto branch
Task 1     Chunk 1 spec (inline)         ← foundation
Task 2.1   Architect on Chunk 2          ← can run in background while Task 1 is reviewed
Task 3.1   Architect on Chunk 3          ← can run in background while Task 1 is reviewed
Task 4     Chunk 4 spec (inline)         ← runs after Task 1 PR opened
Task 6     Chunk 6 spec (inline)
Task 2     Chunk 2 spec (uses 2.1 output)
Task 5     Chunk 5 spec (inline; depends on Chunk 2 schema decisions — flagged in "Depends on")
Task 3     Chunk 3 spec (uses 3.1 output) ← last, references Chunks 1/2/5 as prerequisites
Task 7     Final progress log + handoff
```

Each spec ships in its own PR. PRs do not depend on each other for review — but each spec's "Depends on" line in the body declares the implementation-time ordering for the downstream code branches.

---

## §3 Per-task structure template

Every chunk task has the same five steps (six for chunks with inline investigations):

1. **Plan / architect input** — for inline chunks this is a re-read of mini-spec + cited todo items; for architect chunks this is the architect dispatch and review of its output.
2. **Draft the spec** — produce the full document at the named path, conforming to the spec-authoring-checklist and the framing in spec-context.
3. **Run `spec-reviewer`** — iterate until clean or 5-iteration lifetime cap; resolve any HITL escalations.
4. **Annotate `tasks/todo.md`** — append `→ owned by <spec-slug>` to each cited item line (do not delete or rewrite the item).
5. **Commit on a per-spec branch + open PR** — `spec/pre-launch-<chunk-slug>` branched off `spec/pre-launch-hardening`. PR body: scope summary, depends-on line, link to spec-reviewer log.

Every spec MUST contain (per `docs/spec-authoring-checklist.md` Appendix, plus pre-launch-specific additions):

- **Front-matter block** at the top of each spec:
  - `Source: docs/pre-launch-hardening-mini-spec.md § Chunk N`
  - `Invariants: docs/pre-launch-hardening-invariants.md (commit SHA: <pinned>)` — links the spec to the version of the cross-chunk invariants it was authored against
  - `Architect input: tasks/builds/pre-launch-hardening-specs/architect-output/<chunk-slug>.md (commit SHA: <pinned>)` — only on Chunks 2 and 3; locks traceability so a later spec amendment can't silently drift from the architect's resolution
  - `Implementation order:` quote the mandatory order (1 → {2,4,6} → 5 → 3) plus the spec's own slot
- Goal + non-goals
- Items closed — each cited with **both** the owning `tasks/todo.md` line **and** a quoted text snippet (≥10 words) of the original item, so traceability survives line-number shifts
- Items explicitly NOT closed (and why)
- Key decisions — resolutions where the mini-spec or architect named them, **escalated questions** in `§ Open Decisions` where they are still open
- Files touched (concrete paths, not categories)
- Contracts subsection if any data shape crosses a service / parser boundary (worked example required)
- **Implementation Guardrails** section (mandatory):
  - `MUST reuse:` named primitives from `docs/spec-context.md § accepted_primitives` that this spec relies on
  - `MUST NOT introduce:` patterns / abstractions explicitly out of bounds (e.g. new service layers when an existing one fits, feature flags, supertest)
  - `Known fragile areas:` files / boundaries where past PRs have regressed; engineers must read the related session log before editing
- Test plan consistent with `docs/spec-context.md` (`runtime_tests: pure_function_only`, `static_gates_primary`)
- Done criteria
- Rollback notes where applicable
- `## Deferred Items` section (mandatory; "None." is acceptable)
- **`## Review Residuals`** section (mandatory; populated by Step 4 of each chunk task):
  - `HITL decisions (user must answer):` items routed out of `spec-reviewer` because they need human adjudication
  - `Directional uncertainties (explicitly accepted tradeoffs):` items the spec author chose not to resolve mechanically and is shipping with explicit acceptance — prevents silent ambiguity
  - `Spec-reviewer iteration count:` actual count + whether the lifetime cap was hit
- **`## Coverage Check`** section (mandatory; the last section before commit):
  - Checkbox-list mapping every bullet in the owning mini-spec chunk's `Items` block to the section of this spec that closes it. Format: `- [x] <mini-spec item ID> — addressed in §<spec-section>` or `- [ ] <mini-spec item ID> — explicitly deferred (see § Items NOT closed)`.
  - Final assertion: `- [x] No item from mini-spec § Chunk N is implicitly skipped.`
  - The Coverage Check is the spec author's signed statement that internal correctness has been verified against the mini-spec's intent. `spec-reviewer` reads it as authoritative; an unchecked box blocks merge.

### Scope guard (binding — prevents silent expansion mid-draft)

Any item not explicitly listed in the spec's `## Items closed` section:

- MUST NOT be added during spec drafting, even if the author thinks it's "obviously related" or "trivial to bundle."
- MUST be recorded under `## Deferred Items` with a short rationale, OR captured via `triage-agent` for separate planning.
- The "while we're here, we may as well" reflex is the highest-ROI place to enforce discipline. If a related item surfaces during drafting, write it down and move on — do not absorb it into scope.

The scope guard applies to architect outputs as well: the architect's output is a resolution of decisions named in the mini-spec, not a place to discover new ones.

---

## §4 Task 0 — Branch setup

**Files:**
- Modify: working tree (no file changes; `git checkout -b`).

- [ ] **Step 1: Verify clean working tree on the wrong branch**

```bash
git status
git branch --show-current
```

Expected: `working tree clean`, `claude/add-system-monitoring-BgLlY`. STOP if dirty — escalate to user.

- [ ] **Step 2: Fetch latest main and verify mini-spec source**

```bash
git fetch origin
git rev-parse 1023ff02 --verify
```

Expected: `1023ff02...` SHA is reachable. If not, escalate (mini-spec source missing).

- [ ] **Step 3: Create and check out the spec branch**

```bash
git checkout -b spec/pre-launch-hardening origin/main
```

Expected: branch created from latest `origin/main`. (Reason: do not branch off the system-monitor work-in-progress.)

- [ ] **Step 4: Create the build slug directory + progress file**

Write `tasks/builds/pre-launch-hardening-specs/progress.md` with:

```markdown
# Pre-Launch Hardening Specs — Progress

**Branch:** `spec/pre-launch-hardening`
**Plan:** `tasks/builds/pre-launch-hardening-specs/plan.md`
**Invariants:** `docs/pre-launch-hardening-invariants.md`
**Started:** <ISO timestamp at Task 0 commit>

## Implementation Order (MANDATORY — DO NOT REORDER)

```
1 → {2, 4, 6} → 5 → 3
```

Blocking rules — engineers picking up the implementation branches MUST honour all four:

- **Chunk 1 must land before ANY data-access changes.** RLS posture is the prerequisite for every other chunk; a code branch that touches tenant tables before Chunk 1 is merged risks silently fail-open queries.
- **Chunk 2 must land before any code touching `agent_runs`, schema renames (W1-6 / W1-29), or skill error envelope (C4a-6-RETSHAPE).** Schema decisions are ground-truth for Chunks 3 and 5.
- **Chunks 4 and 6 may run in parallel with 2.** They have no schema dependency.
- **Chunk 3 is last.** Dead-path completion depends on RLS (Chunk 1), schema decisions (Chunk 2), and execution correctness (Chunk 5) being stable.

PR order ≠ implementation order. Do **not** infer dependency ordering from PR merge order. The dependency graph above is authoritative.

## Status

- [ ] Task 0    Branch setup
- [ ] Task 0.5  Mini-spec on branch
- [ ] Task 0.6  Cross-chunk invariants doc
- [ ] Task 1    Chunk 1 — RLS Hardening Sweep
- [ ] Task 2.1  Architect input — Chunk 2
- [ ] Task 3.1  Architect input — Chunk 3
- [ ] Task 4    Chunk 4 — Maintenance Job RLS Contract
- [ ] Task 6    Chunk 6 — Gate Hygiene Cleanup
- [ ] Architect-output conflict check (pre-Task 2/3 gate)
- [ ] Task 2    Chunk 2 — Schema Decisions + Renames
- [ ] Task 5    Chunk 5 — Execution-Path Correctness
- [ ] Task 3    Chunk 3 — Dead-Path Completion
- [ ] Task 6.5  Spec freeze gate
- [ ] Task 6.6  Cross-spec consistency sweep
- [ ] Task 7    Handoff log
```

- [ ] **Step 5: Commit Task 0 setup**

```bash
git add tasks/builds/pre-launch-hardening-specs/
git commit -m "chore(pre-launch-hardening): scaffold spec-only branch

Creates the build slug directory and progress tracker for the
pre-launch hardening spec authoring sprint. Spec authoring branches
off main; per-chunk specs ship as separate PRs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Push branch and confirm**

```bash
git push -u origin spec/pre-launch-hardening
```

Expected: branch tracked on origin. Done.

---

## §5 Task 0.5 — Bring the mini-spec onto the branch

**Files:**
- Create: `docs/pre-launch-hardening-mini-spec.md` (231 lines, exact content of `1023ff02:docs/pre-launch-hardening-mini-spec.md`).

- [ ] **Step 1: Extract the mini-spec verbatim**

```bash
git show 1023ff02:docs/pre-launch-hardening-mini-spec.md > docs/pre-launch-hardening-mini-spec.md
wc -l docs/pre-launch-hardening-mini-spec.md
```

Expected: `231 docs/pre-launch-hardening-mini-spec.md`. Diff against the source SHA:

```bash
git show 1023ff02:docs/pre-launch-hardening-mini-spec.md | diff - docs/pre-launch-hardening-mini-spec.md
```

Expected: no output (byte-identical).

- [ ] **Step 2: Commit**

```bash
git add docs/pre-launch-hardening-mini-spec.md
git commit -m "docs(pre-launch-hardening): add mini-spec source

Brings docs/pre-launch-hardening-mini-spec.md across from PR #203
(commit 1023ff02). The mini-spec is the planning input for the 6
per-chunk specs landed on this branch. Byte-identical to source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 3: Update progress.md**

Mark Task 0 and Task 0.5 complete in `tasks/builds/pre-launch-hardening-specs/progress.md`. Commit + push as a small follow-up commit.

---

## §5b Task 0.6 — Author cross-chunk invariants doc

**Files:**
- Create: `docs/pre-launch-hardening-invariants.md`

**Why this exists.** The 6 chunks share assumptions across RLS, naming, contracts, and gates. Without a single source of truth, each spec restates these assumptions independently and they drift. This doc is referenced (with a pinned commit SHA) by every per-chunk spec and pre-empts integration-time surprise.

**Content shape:**

```markdown
# Pre-Launch Hardening — Cross-Chunk Invariants

This document is the single source of truth for invariants that span the 6 pre-launch hardening
specs. Every per-chunk spec links to this file with a pinned commit SHA. If you need to amend an
invariant, update this file in a dedicated PR — never inline the change in a chunk spec.

## RLS contract invariants

- Every tenant table (org-scoped or subaccount-scoped) is enforced via the three-layer fail-closed
  isolation model in `architecture.md` §1155. RLS is the authority; service-layer filters are
  defence-in-depth.
- All tenant tables MUST appear in `server/config/rlsProtectedTables.ts` (the manifest enforced by
  `verify-rls-coverage.sh`).
- Direct `import { db } from ...` is prohibited in `server/routes/`. Routes go through service-layer
  helpers that resolve principal context.
- Background jobs that read/write tenant tables follow the `memoryDedupJob` admin/org tx contract:
  `withAdminConnection` to enumerate orgs, `withOrgTx` per-org for the actual work.
- Subaccount-isolation exceptions ("Option B-lite" — `reference_documents`, `document_bundles`,
  `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals`) are
  enforced at the service layer; new cached-context tables MUST follow the same posture or carry
  a documented opt-in to DB-layer subaccount RLS.

## Naming and schema invariants

- Renamed columns from W1-6 (`automations.workflow_engine_id` → `automation_engine_id`,
  `parent_process_id` → `parent_automation_id`, `system_process_id` → `system_automation_id`)
  are the canonical names; legacy names are dead.
- File-extension convention from W1-29: `*.workflow.ts` only; `*.playbook.ts` is dead.
- `agent_runs.handoff_source_run_id` write-path resolution (WB-1) is the authority for handoff edges;
  `parent_run_id` reuse for handoff chains is being phased out per the Chunk 2 architect call.
- Skill error envelope contract (C4a-6-RETSHAPE) — one of two options: grandfathered string or
  migrated to `{code, message, context}`. Chunk 5 is the source of truth for the chosen option.
- Delegation analytics canonical truth (DELEG-CANONICAL) — `delegation_outcomes` is canonical for
  "what was attempted and what was the outcome"; `agent_runs` telemetry columns are per-run
  snapshots for joins, not authoritative history.

## Execution contract invariants

- Every dispatcher boundary (`invokeAutomationStepService`, the workflowEngineService tick switch)
  re-checks invalidation after awaiting external I/O — no late writes overriding mid-run invalidation
  (Chunk 5 §C4b).
- Pre-dispatch credential resolution (W1-44) — `required_connections` resolved at dispatch, not
  provider edge.
- §5.7 error vocabulary is closed; new error codes require a spec amendment (W1-38).
- `runResultStatus = 'partial'` is decoupled from summary presence (Chunk 5 H3) — summary failure
  must not demote a successful run.

## Gate expectations

- `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh` — hard or warn posture is the open
  question in Chunk 1 § Open Decisions; reconciled when SC-1 lands.
- `verify-action-call-allowlist.sh`, `verify-skill-read-paths.sh`, `verify-input-validation.sh`,
  `verify-permission-scope.sh`, `verify-integration-reference.mjs` — all green is the Chunk 6 done-criterion.
- `import type` skip rule (RLS-CONTRACT-IMPORT) — gate-side fix lives in Chunk 6.
- Coverage baseline (SC-COVERAGE-BASELINE) — captured before testing-round commits begin; documented
  numbers in `tasks/builds/pre-launch-hardening-specs/progress.md`.

## Spec-vs-implementation translation rules

- All specs default to existing primitives in `docs/spec-context.md § accepted_primitives`. Any new
  primitive requires a "why not reuse" paragraph per `docs/spec-authoring-checklist.md § Section 1`.
- No feature flags introduced for any chunk (rollout model is `commit_and_revert`).
- No supertest, frontend-unit, or e2e tests added (testing posture is `pure_function_only`).

## Amendments

If a per-chunk spec discovers an invariant that should live here, the spec author opens a PR
amending **this file** (not the chunk spec). The chunk spec is then re-pinned to the new SHA.
This pattern prevents silent drift.
```

- [ ] **Step 1: Author the invariants doc**

Create `docs/pre-launch-hardening-invariants.md` with the content above (filled in concretely from the mini-spec, not paraphrased — every invariant must be traceable back to an existing reference). Cite `architecture.md`, `docs/spec-context.md`, and the mini-spec sections by name.

- [ ] **Step 2: Commit**

```bash
git add docs/pre-launch-hardening-invariants.md
git commit -m "docs(pre-launch-hardening): cross-chunk invariants source-of-truth

Single source of truth for RLS, naming, execution, and gate
invariants that span the 6 per-chunk specs. Every per-chunk spec
front-matter pins a commit SHA of this file so amendments cannot
silently drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 3: Capture the commit SHA for spec front-matter**

```bash
git rev-parse HEAD
```

Record this SHA in `progress.md` under `Invariants pinned at:`. Every Chunk N spec front-matter cites this SHA.

- [ ] **Step 4: Mark Task 0.6 complete in `progress.md`**

### Done criteria for Task 0.6

The invariants doc is **done** only when all five hold. If any criterion fails, the doc is incomplete; downstream specs cannot pin its SHA.

- [ ] All 5 invariant categories are documented in dedicated sections: RLS contract · Naming and schema · Execution contract · Gate expectations · Spec-vs-implementation translation rules.
- [ ] Every invariant is **testable or enforceable** — i.e. it can be checked by a script, a code grep, an existing CI gate, a pure-function assertion, or an explicit named convention. Philosophical statements ("we value X") are not invariants and don't belong here.
- [ ] No invariant overlaps with or contradicts `docs/spec-context.md` § `accepted_primitives` / `convention_rejections`, or any rule in `architecture.md` § "Architecture Rules" or §1155.
- [ ] Every invariant cites its source: a section in `architecture.md`, a primitive in `docs/spec-context.md`, a mini-spec chunk reference, or an existing CI gate script. No claims that lack a backing reference.
- [ ] The doc carries an `## Amendments` section (initially empty) — the post-freeze amendment protocol updates this section, not the body.

This blocks Task 1 from starting against an unfinished invariants doc.

---

## §6 Task 1 — Chunk 1 — RLS Hardening Sweep (inline)

**Files:**
- Create: `docs/pre-launch-rls-hardening-spec.md`
- Modify: `tasks/todo.md` (annotations only; no deletions)

**Inputs:**
- Mini-spec § "Chunk 1 — RLS Hardening Sweep"
- Cross-chunk invariants: `docs/pre-launch-hardening-invariants.md` (commit SHA pinned in Task 0.6)
- Cited todo items: `P3-C1..C5` (lines 840–844), `P3-C6..C9` (lines 845–848), `P3-C10` (line 849), `P3-C11` (line 850), `P3-H2` (line 851), `P3-H3` (line 852), `SC-1` (re-derive — see pre-flight), `GATES-2026-04-26-1` (line 935 resolved B-1/B-2/B-3 follow-up note)
- Framing: `docs/spec-context.md` § Architecture defaults; `architecture.md` §1155 "Row-Level Security — Three-Layer Fail-Closed Data Isolation"
- Existing primitives to reuse (per `spec-context.md` `accepted_primitives`): `withOrgTx`, `getOrgScopedDb`, `withAdminConnection`, `RLS_PROTECTED_TABLES`, `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `rls.context-propagation.test.ts`

- [ ] **Step 1: Re-derive the SC-1 60-table delta**

Open `server/config/rlsProtectedTables.ts`. Cross-reference the manifest entries against migrations that contain `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY`. Produce a per-table table inside the spec with columns: `table | tenant_scope (org/sub/system) | manifest_listed | force_rls_present | policy_present | classification`.

This produces the SC-1 deliverable inline — no architect needed.

- [ ] **Step 2: Decide the gate-blocking question (escalation if needed)**

Mini-spec poses: "Should the RLS gate become hard-blocking (vs warn) once the registry is reconciled?" — escalate to the user inside the spec as a § Open Decisions entry. **Do not pre-decide.** Frame the trade-off (false-positive risk during testing vs latent gap) and quote the framing from `spec-context.md`.

- [ ] **Step 3: Author the spec**

Sections (mandatory per spec-authoring-checklist):

1. Goal + non-goals
2. Items closed (each cited with todo.md line + the mini-spec handle)
3. Items explicitly NOT closed (everything in mini-spec § "Explicitly out of scope" that touches RLS, plus anything we punt on intentionally) and why
4. Key decisions:
   - SC-1 per-table classification table (resolved inline)
   - Gate-hard-blocking question (escalated to user — § Open Decisions)
5. Files touched (concrete paths):
   - `server/config/rlsProtectedTables.ts`
   - `server/lib/briefVisibility.ts`
   - `server/lib/workflow/onboardingStateHelpers.ts`
   - `server/routes/memoryReviewQueue.ts`
   - `server/routes/systemAutomations.ts`
   - `server/routes/subaccountAgents.ts`
   - `server/routes/clarifications.ts`
   - `server/services/documentBundleService.ts`
   - `server/services/skillStudioService.ts`
   - `server/services/memoryReviewQueueService.ts` (new — extracted from route)
   - one new corrective migration (replaces phantom `app.current_organisation_id` with `current_setting('app.organisation_id', true)`)
   - per-table FORCE-RLS migrations for `memory_review_queue`, `drop_zone_upload_audit`, `onboarding_bundle_configs`, `trust_calibration_state`
   - `migrations/<n>_reference_documents_force_rls_parent_exists.sql` (new — the GATES-2026-04-26-1 follow-up named in line 935)
   - any new `rlsProtectedTables` entries discovered by SC-1
6. Test plan: per `docs/spec-context.md` testing posture (`runtime_tests: pure_function_only`, `static_gates_primary`) — relies on `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, and the existing `rls.context-propagation.test.ts` harness for default-deny coverage. No new e2e or supertest.
7. Done criteria (mirrors mini-spec): zero `import { db } from` in `server/routes/`; every tenant table has FORCE RLS + valid policies; SC-1 registry == migrations == code expectations (3-set drift = 0); gate posture explicit (hard or warn).
8. Rollback notes: per-migration revert ordering; the corrective phantom-var migration is a pure replacement so revert is the inverse.
9. Deferred items section (mandatory): "None for Chunk 1." (or list any inline-discovered deferrals).

Apply the spec-authoring-checklist Appendix before saving.

- [ ] **Step 4: Run `spec-reviewer`**

Invoke: `spec-reviewer: review docs/pre-launch-rls-hardening-spec.md`. The agent auto-applies mechanical fixes, classifies directional findings, and writes its log under `tasks/review-logs/`. Iterate until the agent reports clean or hits its lifetime cap. Resolve HITL escalations by routing to user via the spec's § Open Decisions section.

- [ ] **Step 5: Annotate `tasks/todo.md`**

For each item the spec closes, append ` → owned by pre-launch-rls-hardening-spec` to the line. Do **not** delete or rewrite. Items affected: lines 840–852 inclusive, plus the resolved-but-followup note at line 935 (annotate even though the parent is `[x]` — the follow-up is what we own).

Example annotation:

```markdown
- [ ] **P3-C5 — Phantom RLS session var ...** → owned by pre-launch-rls-hardening-spec
```

**Traceability note.** The spec body cites every closed item with **both** its `tasks/todo.md` line **and** a verbatim text snippet (≥10 words). Line numbers shift; snippets don't. The annotation in `tasks/todo.md` is for forward navigation; the snippet inside the spec is the durable backward link.

- [ ] **Step 6: Commit + open PR**

```bash
git checkout -b spec/pre-launch-rls-hardening
git add docs/pre-launch-rls-hardening-spec.md tasks/todo.md tasks/review-logs/spec-reviewer-log-pre-launch-rls-hardening-*.md tasks/builds/pre-launch-hardening-specs/progress.md
git commit -m "spec(pre-launch-rls-hardening): full spec — Chunk 1 of 6

Closes the pre-launch RLS hardening sweep: FORCE RLS on the 4 known
tables, kills the phantom session var, removes direct db imports
from 4 routes + 4 services, and reconciles the SC-1 60-table
registry/migration drift.

Source: docs/pre-launch-hardening-mini-spec.md § Chunk 1.
Spec-reviewer log attached.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin spec/pre-launch-rls-hardening
gh pr create --base spec/pre-launch-hardening --title "spec(pre-launch-rls-hardening): Chunk 1 of 6" --body "## Summary
- Per-chunk spec for pre-launch RLS hardening (mini-spec § Chunk 1).
- Closes 14 items from tasks/todo.md (P3-C1..C11, P3-H2, P3-H3, SC-1, GATES-2026-04-26-1).
- Spec-reviewer iterations attached under tasks/review-logs/.

## Depends on
None. Foundation chunk.

## Test plan
- [ ] User reads spec end-to-end and approves § Open Decisions.
- [ ] Spec-reviewer log shows clean exit or documented HITL escalations.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Return PR URL to user. Update `progress.md` and push.

---

## §7 Task 2.1 — Architect dispatch for Chunk 2 (Schema Decisions + Renames)

**Files:**
- Create: `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (architect agent output, captured for review)

- [ ] **Step 1: Dispatch the architect agent**

Invoke the `architect` agent in the **background** with this brief (verbatim — the architect won't see this plan):

```
Read docs/pre-launch-hardening-mini-spec.md § "Chunk 2 — Schema Decisions + Renames" and produce
an architect's resolution document for the following decisions. Do NOT write the spec — write
the decision document only. Save to tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md.

Decisions to resolve (cite todo.md line numbers in your output):
- F6 (line 503): safety_mode vs run_mode collision. Pick split or merge or composite.
- F10 (line 504): name the portal run-mode column on subaccount_agents.
- F11 (line 505): side_effects storage — top-level column, JSONB, or seed-only.
- F15 (line 506): input_schema/output_schema validator + format.
- F21 (line 507): Rule 3 "Check now" — drop or implement.
- F22 (line 508): definition of "meaningful" output.
- WB-1 (line 637): handoff_source_run_id vs parentRunId reuse.
- DELEG-CANONICAL (line 332): canonical truth between agent_runs telemetry and delegation_outcomes.
- W1-6 (line 646) + W1-29 (line 647): rename mechanics + sequencing.
- BUNDLE-DISMISS-RLS (line 480): unique key (org, user, hash) vs cross-org per user.
- CACHED-CTX-DOC (line 491): document Option B-lite RLS posture in spec — what minimum to capture.

Framing: docs/spec-context.md (pre-production, rapid_evolution, prefer_existing_primitives_over_new_ones,
no feature flags, commit_and_revert, runtime_tests: pure_function_only).

For each decision, output: chosen option, rejected options, why, files affected, downstream
ripple (call sites, migrations), open sub-questions for the spec to flag.
```

Architect runs in the background. Move on to Tasks 3.1, 4, and 6 while it runs.

- [ ] **Step 2: When architect completes, read the output**

Verify the file exists at the named path. Sanity-check that all 11 decisions are answered. If any decision is missing or the architect deferred to the spec author, escalate to the user before Task 2 begins.

- [ ] **Step 3: Commit the architect output (no PR) and pin its SHA**

```bash
git add tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md
git commit -m "chore(pre-launch-hardening): architect output for Chunk 2 schema decisions"
git push
git rev-parse HEAD
```

Record the resulting commit SHA in `progress.md` under `Schema-decisions architect SHA:`. The Chunk 2 spec front-matter pins this SHA so spec amendments can't silently drift from the architect's resolution.

This output is consumed by Task 2 — not a standalone deliverable.

---

## §8 Task 3.1 — Architect dispatch for Chunk 3 (Dead-Path Completion)

**Files:**
- Create: `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md`

- [ ] **Step 1: Dispatch the architect agent (parallel with Task 2.1)**

Invoke `architect` in the **background**:

```
Read docs/pre-launch-hardening-mini-spec.md § "Chunk 3 — Dead-Path Completion" and produce an
architect's resolution document. Do NOT write the spec. Save to
tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md.

Decisions to resolve (cite todo.md line numbers):
- DR3 (line 371): BriefApprovalCard approve/reject — server route shape, dispatch via
  actionRegistry vs orchestrator enqueue, execution record linkage to artefact metadata,
  client handler refresh strategy.
- DR2 (line 370): conversation follow-up → agent run trigger semantics. Auto on every
  follow-up, classifyChatIntent gate, threshold-based, or explicit user action? How does it
  apply to non-Brief scopes (task, agent_run)? Idempotency for passive acks. Whether
  simple_reply / cheap_answer can produce inline artefacts on follow-ups.
- DR1 (line 369): POST /api/rules/draft-candidates route — server logic shape (artefact
  scan, kind=='approval' verify, brief load, related-rule lookup, draftCandidates call),
  authentication / org scoping, error envelope.
- C4a-REVIEWED-DISP (line 665): post-approval invoke_automation dispatch — resume original
  step or branch a new one? Which surfaces does the choice break (decideApproval, tick loop,
  step state machine)?

Framing: docs/spec-context.md. Prefer existing primitives (actionService.proposeAction,
playbookEngineService, the WorkflowRunService.decideApproval pattern). State explicit
why-not-reuse for any new primitive.

For each decision, output: chosen option, rejected options, why, files affected, downstream
ripple, open sub-questions.
```

- [ ] **Step 2: When architect completes, read the output**

Same verification as Task 2.1. Escalate gaps to the user before Task 3 begins.

- [ ] **Step 3: Commit and pin the SHA**

```bash
git add tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md
git commit -m "chore(pre-launch-hardening): architect output for Chunk 3 dead-path completion"
git push
git rev-parse HEAD
```

Record the resulting commit SHA in `progress.md` under `Dead-path-completion architect SHA:`. The Chunk 3 spec front-matter pins this SHA.

---

## §9 Task 4 — Chunk 4 — Maintenance Job RLS Contract (inline)

**Files:**
- Create: `docs/pre-launch-maintenance-job-rls-spec.md`
- Modify: `tasks/todo.md` (annotation only)

**Inputs:**
- Mini-spec § "Chunk 4 — Maintenance Job RLS Contract"
- Cross-chunk invariants: `docs/pre-launch-hardening-invariants.md` (commit SHA pinned in Task 0.6)
- Cited todo: `B10` (line 349) — "maintenance jobs bypass the admin/org tx contract" (this is the mini-spec's `B10-MAINT-RLS`)
- Reference contract: `server/jobs/memoryDedupJob.ts`
- Existing primitives: `withAdminConnection`, `withOrgTx` (per `accepted_primitives`)

- [ ] **Step 1: Read the reference contract**

Open `server/jobs/memoryDedupJob.ts` and capture the admin-connection → per-org enumeration → `withOrgTx` shape that the new specs must mirror.

- [ ] **Step 2: Author the spec**

Mandatory sections (full spec-authoring-checklist Appendix):

1. Goal + non-goals
2. Items closed: `B10-MAINT-RLS` → `tasks/todo.md` line 349
3. Items NOT closed: nothing — the chunk is exactly one item
4. Key decisions: none (mini-spec says so) — the contract is fixed by `memoryDedupJob`
5. Files touched:
   - `server/jobs/ruleAutoDeprecateJob.ts`
   - `server/jobs/fastPathDecisionsPruneJob.ts`
   - `server/jobs/fastPathRecalibrateJob.ts`
   - one pure unit test per job: `server/jobs/__tests__/<job>Pure.test.ts` (per testing posture: pure-function only)
6. Test plan: per job, a pure test that asserts a real row is decayed / pruned / recalibrated under the org-scoped tx contract. No DB-backed test — pure-function posture per `spec-context.md`.
7. Done criteria: each job uses `withAdminConnection` + `withOrgTx`; named pure test per job.
8. Rollback notes: each job's previous direct-`db` form remains in git history; revert is per-file.
9. Deferred items: "None."

- [ ] **Step 3: Run `spec-reviewer`**

Same protocol as Task 1.

- [ ] **Step 4: Annotate `tasks/todo.md`**

Append ` → owned by pre-launch-maintenance-job-rls-spec` to line 349.

- [ ] **Step 5: Commit + open PR**

Branch: `spec/pre-launch-maintenance-job-rls`. Base: `spec/pre-launch-hardening`. Same PR-body template as Task 1, with `Depends on: spec/pre-launch-rls-hardening` (for the underlying admin-tx contract).

---

## §10 Task 6 — Chunk 6 — Gate Hygiene Cleanup (inline)

**Files:**
- Create: `docs/pre-launch-gate-hygiene-spec.md`
- Modify: `tasks/todo.md` (annotations only)

**Inputs:**
- Mini-spec § "Chunk 6 — Gate Hygiene Cleanup"
- Cross-chunk invariants: `docs/pre-launch-hardening-invariants.md` (commit SHA pinned in Task 0.6)
- Cited todo items: `P3-H4` (line 858), `P3-H5` (line 859), `P3-H6` (line 860), `P3-H7` (line 861) and follow-up `S-2` (line 940), `P3-M10..M16` (lines 879–883), `P3-L1` (line 882), `S2-SKILL-MD` → `S2` (line 350), `S3-CONFLICT-TESTS` → `S3` (line 351), `S5-PURE-TEST` → `S-5` (line 947), `SC-COVERAGE-BASELINE` → `REQ #35` (line 916), `RLS-CONTRACT-IMPORT` → investigate (no labeled item)

- [ ] **Step 1: Investigate `RLS-CONTRACT-IMPORT` / `GATES-2`**

Open `scripts/gates/verify-rls-contract-compliance.sh` (or wherever the import-type filtering rule lives). Confirm whether the gate currently treats `import type` differently from runtime imports. If the gate doesn't yet handle it, this spec is the source-of-truth that introduces the rule. Capture findings in the spec's § Key decisions.

- [ ] **Step 2: Author the spec**

Mandatory sections; cleanup chunk has the most items (~15) so the file inventory will be the longest.

1. Goal + non-goals
2. Items closed (full table mapping each mini-spec handle → todo.md line):

   | Mini-spec ID | todo.md line | Notes |
   |---|---|---|
   | `P3-H4` | 858 | actionCallAllowlist.ts creation |
   | `P3-H5` | 859 | canonicalAccounts query into service layer |
   | `P3-H6` | 860 | referenceDocumentService llmRouter migration |
   | `P3-H7` + `S-2` | 861, 940 | PrincipalContext propagation across 5 files |
   | `P3-M10` | 879 | skill visibility drift |
   | `P3-M11` | 880 | YAML frontmatter on 5 workflow skills |
   | `P3-M12` | 881 | yaml dep |
   | `P3-M13` | 864 | input-validation warning baseline (overlaps SC-COVERAGE-BASELINE) |
   | `P3-M14` | 865 | permission-scope warning baseline (overlaps SC-COVERAGE-BASELINE) |
   | `P3-M15` | 863 | canonical dictionary entries |
   | `P3-M16` | 883 | docs/capabilities.md editorial violation |
   | `P3-L1` | 882 | package.json deps |
   | `S2-SKILL-MD` (`S2`) | 350 | .md for ask_clarifying_questions + challenge_assumptions |
   | `S3-CONFLICT-TESTS` (`S3`) | 351 | rule-conflict parser tests |
   | `S5-PURE-TEST` (`S-5`) | 947 | saveSkillVersion pure unit test |
   | `SC-COVERAGE-BASELINE` (≈`REQ #35`) | 916 | baseline procedure |
   | `RLS-CONTRACT-IMPORT` (`GATES-2`) | n/a | spec defines the rule |

3. Items NOT closed: any `P3-M*` not in the table above (M1..M9, etc.)
4. Key decisions: none architectural; the only call is the Step 1 finding for `RLS-CONTRACT-IMPORT`
5. Files touched (concrete paths from todo entries):
   - `server/lib/playbook/actionCallAllowlist.ts` (new)
   - `server/jobs/measureInterventionOutcomeJob.ts`
   - `server/services/canonicalDataService.ts` (new helper)
   - `server/services/referenceDocumentService.ts`
   - `server/services/llmRouter.ts` (signature, if exposing token-count)
   - `server/services/actionRegistry.ts`, `server/services/intelligenceSkillExecutor.ts`, `server/services/connectorPollingService.ts`, `server/services/canonicalQueryRegistry.ts`, `server/webhooks/ghlWebhook.ts` (PrincipalContext propagation)
   - 5 workflow skill `.md` files (`workflow_estimate_cost`, `workflow_propose_save`, `workflow_read_existing`, `workflow_simulate`, `workflow_validate`)
   - `server/skills/ask_clarifying_questions.md` (new), `server/skills/challenge_assumptions.md` (new)
   - `scripts/verify-integration-reference.mjs` (yaml dep)
   - `package.json` (express-rate-limit, zod-to-json-schema, docx, mammoth, yaml)
   - `docs/capabilities.md` line 1001 editorial fix
   - `scripts/gates/verify-rls-contract-compliance.sh` (or relevant gate) for `import type` handling
   - `server/services/__tests__/skillStudioServicePure.test.ts` (new — S-5)
   - `server/services/__tests__/ruleConflictDetectorServicePure.test.ts` (S3 strengthening)
   - canonical dictionary registry file (P3-M15 — locate during drafting)
6. Test plan: pure unit tests only (S3 + S5); other items are mechanical and verified by re-running their gate.
7. Done criteria: every gate green; baseline numbers captured in `progress.md`.
8. Rollback notes: per-file revert; baseline capture is additive and unaffected.
9. Deferred items: "None for Chunk 6." (P3-M3..M9 etc. are out-of-scope by the mini-spec.)

- [ ] **Step 3: Run `spec-reviewer`**
- [ ] **Step 4: Annotate `tasks/todo.md`** — every cited line gets ` → owned by pre-launch-gate-hygiene-spec`.
- [ ] **Step 5: Commit + open PR** on branch `spec/pre-launch-gate-hygiene`. Base: `spec/pre-launch-hardening`. `Depends on: none.`

---

## §10b Architect-output conflict check (pre-Task-2/3 gate)

This is a **mandatory gate** between Tasks 2.1 / 3.1 (architect dispatches) and Tasks 2 / 3 (spec drafting). The two architect calls run in parallel and could resolve overlapping decisions in inconsistent ways — for example, schema-decisions naming `agent_runs.handoff_source_run_id` while dead-path-completion's approval-resume payload assumes the legacy `parent_run_id` reuse. The check exists to catch that before the chunk specs are written against contradictory premises.

**Inputs:**
- `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (Task 2.1 output)
- `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md` (Task 3.1 output)

- [ ] **Step 1: Diff the two outputs against the cross-chunk invariants**

Open both architect outputs side-by-side. For each invariant in `docs/pre-launch-hardening-invariants.md` § Naming and schema invariants and § Execution contract invariants, verify both architects' decisions align. Specific overlap points:

- `agent_runs.handoff_source_run_id` vs `parent_run_id` reuse — schema-decisions (WB-1) and dead-path-completion (C4a-REVIEWED-DISP resume payload) must agree.
- Skill error envelope (C4a-6-RETSHAPE in Chunk 5) and any error shape the dead-path approval routes return — must agree on `{code, message, context}` vs flat string.
- Delegation analytics canonical truth (DELEG-CANONICAL) — schema-decisions picks `delegation_outcomes`; dead-path-completion's BriefApprovalCard execution-record-linkage must read from the canonical source.
- New columns introduced by schema-decisions (e.g. `subaccount_agents.portal_default_safety_mode` for F10) — dead-path-completion must not assume legacy column names.

- [ ] **Step 2: If the outputs conflict, apply the resolution rule**

Document every conflict in a new file `tasks/builds/pre-launch-hardening-specs/architect-output/conflict-check.md` with: each conflict point, both architect positions, the resolution path applied (per the rule below), and the resulting decision.

**Conflict resolution rule (binding — apply locally without escalation when possible):**

1. **Data-shape conflicts** (column names, types, FK relationships, validator format, payload schema) → **prefer schema-decisions output**. Schema-decisions is the authoritative architect for data shape; dead-path-completion adapts.
2. **Orchestration / flow conflicts** (route shape, dispatch semantics, idempotency keys, resume vs branch, queued vs inline) → **prefer dead-path-completion output**. Dead-path-completion is the authoritative architect for orchestration; schema-decisions adapts its column shapes if needed.
3. **Cross-domain conflicts** (the disagreement spans both data shape AND orchestration — e.g. the conflict is about whether a new column should exist *and* what payload uses it) → **escalate to user**. No local resolution. Stop Task 2 and Task 3 work until the user adjudicates.

Record the rule applied per conflict so the audit trail is explicit. If a conflict was resolved locally per (1) or (2), the losing architect output is updated in-place with a brief note pointing at the winning decision; this keeps both files internally coherent for downstream readers.

- [ ] **Step 3: If no conflicts, record the all-clear**

Append to `progress.md`:

```markdown
**Architect-output conflict check:** PASSED at <ISO timestamp>. Schema-decisions SHA: <x>. Dead-path-completion SHA: <y>.
```

Commit + push. This unblocks Tasks 2 and 3.

---

## §11 Task 2 — Chunk 2 — Schema Decisions + Renames

**Files:**
- Create: `docs/pre-launch-schema-decisions-spec.md`
- Modify: `tasks/todo.md`

**Inputs:**
- Architect output from Task 2.1: `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (commit SHA from Task 2.1 Step 3 — pinned in spec front-matter)
- Cross-chunk invariants: `docs/pre-launch-hardening-invariants.md` (commit SHA pinned in Task 0.6)
- Pre-Task gate: architect-output conflict check has passed (see §12 Architect-output conflict check)
- Mini-spec § "Chunk 2 — Schema Decisions + Renames"
- Cited todo items: `F6` (line 503), `F10` (504), `F11` (505), `F15` (506), `F21` (507), `F22` (508), `WB-1` (637), `DELEG-CANONICAL` (332), `W1-6` (646), `W1-29` (647), `BUNDLE-DISMISS-RLS` (480), `CACHED-CTX-DOC` (491)

- [ ] **Step 1: Read the architect output end-to-end**

Verify all 11 decisions have a chosen option + rationale. Note any escalations the architect routed to the spec author.

- [ ] **Step 2: Author the spec**

Mandatory sections. The spec embeds the architect's decisions as resolutions; HITL-routed sub-questions go in § Open Decisions for the user to confirm before the implementation branch starts.

1. Goal + non-goals
2. Items closed: full table of mini-spec IDs → todo.md lines (12 items)
3. Items NOT closed: explicit list of W1-* renames not in scope (mini-spec only names W1-6 and W1-29; verify against todo.md)
4. Key decisions: each architect resolution as a subsection (F6 / F10 / F11 / F15 / F21 / F22 / WB-1 / DELEG-CANONICAL / W1-6 / W1-29 / BUNDLE-DISMISS-RLS / CACHED-CTX-DOC). Each subsection cites the architect output and notes whether spec-reviewer or user needs to validate.
5. Files touched: schema files (per architect decisions), 59 W1-6 call sites (enumerate during Step 1 of architect output review), all `*.playbook.ts` files for W1-29, `docs/cached-context-infrastructure-spec.md` (for CACHED-CTX-DOC), `docs/riley-observations-dev-spec.md` and any related migration files for F6/F10/F11/F15/F21/F22.
6. Test plan: pure unit tests for any renamed columns where business logic changes; otherwise grep-clean is the gate (W1-6, W1-29). Migration `0205` unblocked is the highest-impact done-criterion.
7. Done criteria: all ambiguous columns named + typed; migration 0205 unblocked; Drizzle / SQL / code align on W1-6 names; W1-29 grep-clean.
8. Rollback notes: per-migration; rename migrations are reversible via `RENAME COLUMN` inverse.
9. Deferred items: any W1-* not closed; everything in mini-spec § "Out of scope"

- [ ] **Step 3: Run `spec-reviewer`** — iterate to clean or cap.
- [ ] **Step 4: Annotate `tasks/todo.md`** — append ` → owned by pre-launch-schema-decisions-spec` to each cited line.
- [ ] **Step 5: Commit + open PR**

Branch `spec/pre-launch-schema-decisions`. Base `spec/pre-launch-hardening`. `Depends on: spec/pre-launch-rls-hardening` (sequencing per mini-spec; schema landings after RLS).

---

## §12 Task 5 — Chunk 5 — Execution-Path Correctness (inline)

**Files:**
- Create: `docs/pre-launch-execution-correctness-spec.md`
- Modify: `tasks/todo.md`

**Inputs:**
- Mini-spec § "Chunk 5 — Execution-Path Correctness"
- Cross-chunk invariants: `docs/pre-launch-hardening-invariants.md` (commit SHA pinned in Task 0.6)
- Cited todo items: `C4b-INVAL-RACE` (line 667), `W1-43` (line 648), `W1-44` (line 649), `W1-38` (line 651), `HERMES-S1` (lines 92–105), `H3-PARTIAL-COUPLING` (lines 152–171), `C4a-6-RETSHAPE` → todo's `C4a-6` (line 337)
- Schema decisions referenced: any from Chunk 2 that touch `agent_runs` columns or skill error envelope (the C4a-6-RETSHAPE decision overlaps Chunk 2's DELEG-CANONICAL)

- [ ] **Step 1: Cross-check Chunk 2's architect output for overlap**

Specifically: does the schema-decisions architect output answer `C4a-6-RETSHAPE` (grandfather string-error pattern vs migrate to nested envelope)? If yes, cite the resolution. If no, escalate to user as § Open Decisions in this spec.

- [ ] **Step 2: Author the spec**

Mandatory sections.

1. Goal + non-goals
2. Items closed: 7 items (C4b, W1-43, W1-44, W1-38, HERMES-S1, H3, C4a-6-RETSHAPE)
3. Items NOT closed: any related W1-* / HD-* execution items deferred per mini-spec
4. Key decisions:
   - C4b-INVAL-RACE: scope of invalidation re-check wrapper (one helper or per-call-site) — recommend one helper, cite spec
   - C4a-6-RETSHAPE: resolution from Chunk 2 OR Open Decisions (per Step 1)
   - H3-PARTIAL-COUPLING: pick from todo.md lines 162–169 options (separate `hasSummary` flag, side-channel, or monitor-and-revisit)
5. Files touched:
   - `server/services/workflowEngineService.ts`
   - `server/services/invokeAutomationStepService.ts`
   - `server/services/agentExecutionService.ts` (1350–1368 for HERMES-S1)
   - `server/services/agentExecutionServicePure.ts` (`computeRunResultStatus` for H3)
   - `~40 skill handlers` — only if the C4a-6-RETSHAPE decision is "migrate"; enumerate during drafting
   - `shared/types/agentExecution.ts` (if H3 picks the side-channel option)
6. Test plan: pure-function tests for `computeRunResultStatus` (H3), `extractRunInsights` (HERMES-S1), and the invalidation-race scenario (C4b — pure simulation of the read-after-await race). Per `spec-context.md`, no DB-backed runtime tests. Static gate verification for W1-43/W1-44 dispatcher boundaries.
7. Done criteria: as in mini-spec.
8. Rollback notes: per-file; H3 may need a Drizzle column add if the chosen option introduces `hasSummary` — flag in spec.
9. Deferred items: anything execution-path-related the mini-spec listed in § "Out of scope" (e.g. `LAEL-P1-1` etc.).

- [ ] **Step 3: Run `spec-reviewer`**
- [ ] **Step 4: Annotate `tasks/todo.md`** — append ` → owned by pre-launch-execution-correctness-spec` to each cited line.
- [ ] **Step 5: Commit + open PR** — branch `spec/pre-launch-execution-correctness`, base `spec/pre-launch-hardening`, `Depends on: spec/pre-launch-schema-decisions, spec/pre-launch-rls-hardening`.

---

## §13 Task 3 — Chunk 3 — Dead-Path Completion

**Files:**
- Create: `docs/pre-launch-dead-path-completion-spec.md`
- Modify: `tasks/todo.md`

**Inputs:**
- Architect output from Task 3.1: `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md` (commit SHA from Task 3.1 Step 3 — pinned in spec front-matter)
- Cross-chunk invariants: `docs/pre-launch-hardening-invariants.md` (commit SHA pinned in Task 0.6)
- Pre-Task gate: architect-output conflict check has passed (see §12)
- Mini-spec § "Chunk 3 — Dead-Path Completion"
- Cited todo items: `DR3` (line 371), `DR2` (line 370), `DR1` (line 369), `C4a-REVIEWED-DISP` (line 665)

- [ ] **Step 1: Read the architect output**
- [ ] **Step 2: Author the spec**

Mandatory sections. This is the chunk most likely to surface a Contracts subsection (per spec-authoring-checklist § Section 3) — every new route + dispatch payload + execution-record-linkage has a worked example.

1. Goal + non-goals
2. Items closed: 4 items
3. Items NOT closed: cross-link to Chunk 5 for execution-path correctness; cross-link to mini-spec § "Out of scope" for `S4` cheap_answer relabel etc.
4. Key decisions: each architect resolution; HITL routings as § Open Decisions
5. Files touched (per architect output + mini-spec):
   - `server/services/briefApprovalService.ts` (new)
   - `server/services/briefConversationService.ts`
   - `server/services/agentExecutionService.ts`
   - `server/services/invokeAutomationStepService.ts`
   - `server/services/workflowEngineService.ts` (decideApproval boundary)
   - `server/routes/briefs.ts` (or new `server/routes/briefApprovals.ts` — architect decides)
   - `server/routes/rules.ts` (DR1: POST /api/rules/draft-candidates)
   - `server/services/ruleCandidateDrafter.ts` (consumer)
   - `server/services/agentRunHandoffService.ts` (DR2 if architect picks orchestrator-enqueue)
   - any new pg-boss job registration (if architect picks queued/async)
   - client: `client/src/components/BriefDetailPage.tsx`, `BriefApprovalCard.tsx`, `ApprovalSuggestionPanel.tsx`
6. Contracts (mandatory per spec-authoring-checklist Section 3):
   - approval decision payload (DR3)
   - follow-up message → orchestrator-job payload (DR2)
   - draft-candidates request/response (DR1)
   - post-approval resume payload (C4a-REVIEWED-DISP) if architect chose option (a)
7. Test plan: pure tests for the new service layer (proposeAction wrapping, idempotency keys, scope-resolution). No supertest / e2e per `spec-context.md`. Frontend stays untested per posture.
8. Done criteria: all 4 done-criteria from mini-spec.
9. Rollback notes: each new route is additive; client handlers are reversible. New services have no migration impact unless the architect introduces a new audit table — flag in spec if so.
10. Deferred items: any DR* / S* not in scope.

- [ ] **Step 3: Run `spec-reviewer`** — iterate; this chunk is the most likely to attract directional findings (multiple architectural decisions in one spec).
- [ ] **Step 4: Annotate `tasks/todo.md`** — append ` → owned by pre-launch-dead-path-completion-spec` to lines 369, 370, 371, 665.
- [ ] **Step 5: Commit + open PR** — branch `spec/pre-launch-dead-path-completion`, base `spec/pre-launch-hardening`, `Depends on: spec/pre-launch-rls-hardening, spec/pre-launch-schema-decisions, spec/pre-launch-execution-correctness`.

---

## §13b Task 6.5 — Spec freeze gate

**Why this exists.** Without an explicit freeze, implementation branches can start while later specs are still iterating. The result: code is written against an early draft, a later spec amendment lands, and the code now violates the spec without anyone noticing. This task is the hard gate.

**Files:**
- Modify: `tasks/builds/pre-launch-hardening-specs/progress.md` (add a freeze block)

**Preconditions (every checkbox must be true before proceeding to Task 6.6):**

- [ ] All 6 per-chunk specs are merged into `spec/pre-launch-hardening`. Verify via `git log --oneline spec/pre-launch-hardening` and confirm one merge commit per chunk.
- [ ] Every spec's `## Open Decisions` section is empty OR every open item has been resolved by the user, recorded in the spec body, and the spec re-merged with the resolution.
- [ ] Every spec's `## Review Residuals` section either reports `Spec-reviewer iteration count: N (clean exit)` OR explicitly lists directional uncertainties the user has accepted. No "iteration cap reached, unresolved" entries remain unaddressed.
- [ ] No outstanding `pr-reviewer` or `spec-reviewer` blockers in `tasks/review-logs/` for any pre-launch-hardening spec.

- [ ] **Step 1: Run the freeze checklist**

For each spec, open it and grep `## Open Decisions` and `## Review Residuals`. Confirm each precondition above is met. If any spec fails a precondition, do NOT proceed — escalate to the user with a list of unmet preconditions.

- [ ] **Step 2: Stamp the freeze in `progress.md`**

Append to `progress.md`:

```markdown
## Spec Freeze

**Frozen at:** <ISO timestamp>
**Branch SHA at freeze:** <git rev-parse HEAD>
**Specs included:**
- pre-launch-rls-hardening-spec (PR #<n>)
- pre-launch-schema-decisions-spec (PR #<n>)
- pre-launch-dead-path-completion-spec (PR #<n>)
- pre-launch-maintenance-job-rls-spec (PR #<n>)
- pre-launch-execution-correctness-spec (PR #<n>)
- pre-launch-gate-hygiene-spec (PR #<n>)

**Implementation may now begin.** Implementation branches MUST follow the order
1 → {2, 4, 6} → 5 → 3 (see top of this file). Any code branch that starts before this
freeze stamp is unauthorised.

**Amendment rule:** any post-freeze change to a per-chunk spec OR to the cross-chunk
invariants doc requires a new freeze stamp. The amendment PR must reference the prior freeze
SHA and explicitly list which downstream code branches need re-validation.
```

**Post-freeze amendment protocol (binding).** Any spec change after the freeze stamp MUST satisfy all three:

1. **Explicit `## Amendments` section in the spec.** Each amendment entry records: amendment date, prior freeze SHA, the change made, and the user who approved. No silent edits.
2. **Update the invariants doc if the amendment touches an invariant.** Re-pin the SHA in the amended spec's front-matter; downstream specs that share the touched invariant must also be re-reviewed.
3. **Re-run Task 6.6 (cross-spec consistency sweep) before re-stamping Task 6.5.** A new freeze stamp is required even for "trivial" amendments — the protocol exists to catch the cases where "trivial" turns out not to be.

If any of these three steps is skipped, the amendment is **not in effect** for downstream implementation. Code branches following the amendment without a fresh freeze stamp violate the protocol.

- [ ] **Step 3: Commit + push**

```bash
git add tasks/builds/pre-launch-hardening-specs/progress.md
git commit -m "chore(pre-launch-hardening): spec freeze — implementation may begin"
git push
```

Implementation does not start in this branch. Task 6.6 (cross-spec consistency sweep) follows immediately and is the final pre-implementation gate.

---

## §13c Task 6.6 — Cross-spec consistency sweep

**Why this exists.** Each spec is reviewed individually by `spec-reviewer`. The reviewer doesn't see siblings — so naming inconsistencies, contract mismatches, and duplicated primitives can slip through individual reviews. This task is the cross-spec read-through.

**Files:**
- Create: `tasks/builds/pre-launch-hardening-specs/consistency-sweep.md` (findings log)
- Modify (only if findings): per-chunk spec PRs, with consistency fixes

**Inputs:**
- All 6 per-chunk specs at `docs/pre-launch-<chunk-slug>-spec.md`
- `docs/pre-launch-hardening-invariants.md`

- [ ] **Step 0: Re-validate invariants doc against all 6 specs**

For every invariant in `docs/pre-launch-hardening-invariants.md`, grep the 6 per-chunk specs for any decision that contradicts it. The invariants doc is a living contract — early framing can be invalidated by later spec decisions, and individual `spec-reviewer` runs don't catch it.

For each contradiction, classify:

- **Spec is wrong** — the spec drifted from the invariant; fix the spec via a follow-up commit on its PR.
- **Invariant is wrong** — the invariant was authored before the relevant decision was finalised; update the invariants doc with a justification line and re-pin the SHA in every spec that previously cited the old version.
- **Both can stand** — the invariant covers the general case; the spec documents an explicit exception (with prose explaining why). Cross-link both sides so future readers see the relationship.

Record each finding in `consistency-sweep.md § Invariant violations`. Do **not** proceed to Step 1 until every invariant violation is resolved (either spec-side or invariants-side).

- [ ] **Step 1: Naming consistency check**

For each named identifier in any spec — column names, enum values, error codes, file paths — grep across all 6 specs and the invariants doc. Discrepancies to look for:

- Same column referred to with different names (e.g. `safety_mode` vs `safetyMode` vs `run_mode`)
- Same enum value spelled differently (e.g. `automation_engine_unavailable` vs `automation-engine-unavailable`)
- File path drift (e.g. `server/routes/briefs.ts` in one spec, `server/routes/briefApprovals.ts` in another, with no explicit "this is a new file vs that is the existing file" disambiguation)

Record each finding in `consistency-sweep.md`.

- [ ] **Step 2: Shared-contract identity check**

For each Contracts subsection across the 6 specs, verify identical contracts have identical shapes:

- The approval decision payload (DR3) and the post-approval resume payload (C4a-REVIEWED-DISP) — do they share fields where the architect said they should?
- Skill error envelope `{code, message, context}` (Chunk 5 C4a-6-RETSHAPE) — is every spec that returns a skill error consistent on this shape?
- Delegation analytics (DELEG-CANONICAL) — is `delegation_outcomes` cited as canonical wherever the topic comes up, never `agent_runs` telemetry?

Record each finding.

- [ ] **Step 3: Duplicated-primitive check**

Grep all 6 specs for new service / job / route / helper introductions. For each, confirm:

- It does not duplicate a primitive already named in `docs/spec-context.md § accepted_primitives`.
- It does not duplicate a primitive being introduced by another spec in this batch (e.g. both Chunk 1 and Chunk 6 introducing the same canonical-data helper).

Record each finding.

- [ ] **Step 4: Conflicting-assumption check**

Read each spec's Goal + Implementation Guardrails section. Cross-check for:

- One spec's `MUST reuse:` listing a primitive another spec's `MUST NOT introduce:` would block.
- Two specs claiming different sources of truth for the same concept (e.g. Chunk 2 says `delegation_outcomes` is canonical, Chunk 3's BriefApprovalCard reads from `agent_runs` telemetry).
- Test-plan posture inconsistencies (one spec adding supertest while another defers per `spec-context.md`).

Record each finding.

- [ ] **Step 5: Triage and resolve**

For every finding in `consistency-sweep.md`, classify:

- **Mechanical** — naming typo, file-path drift, missing reference. Fix in-place via a small follow-up commit on the chunk's PR (or a dedicated consistency-fix PR if multiple chunks affected).
- **Directional** — genuine cross-chunk disagreement. Escalate to user; resolution updates the invariants doc and at least one spec.
- **False alarm** — looks inconsistent but is intentional (with explicit prose explaining the difference). Document in the sweep log and move on.

- [ ] **Step 6: Stamp the sweep**

Append to `progress.md`:

```markdown
## Cross-Spec Consistency Sweep

**Completed at:** <ISO timestamp>
**Findings:** <N total — M mechanical resolved · K directional escalated · L false alarms>
**Sweep log:** tasks/builds/pre-launch-hardening-specs/consistency-sweep.md
**Implementation cleared.**
```

Commit + push.

- [ ] **Step 7: If any directional finding remains unresolved**

Implementation does NOT begin. The sweep log lists open items; the user resolves them, the relevant spec is amended, and Task 6.5 (spec freeze) is re-stamped at the new SHA before this stamp is applied.

---

## §14 Task 7 — Handoff log

**Files:**
- Modify: `tasks/builds/pre-launch-hardening-specs/progress.md`

- [ ] **Step 1: Final progress update**

Update `progress.md` with: 6 PR URLs, spec-reviewer iteration counts per spec, list of HITL escalations the user owns (§ Open Decisions per spec), and the implementation-time sequencing reminder (1 → {2,4,6} → 5 → 3).

- [ ] **Step 2: Commit + push**

```bash
git add tasks/builds/pre-launch-hardening-specs/progress.md
git commit -m "chore(pre-launch-hardening): handoff log — 6 specs landed, ready for implementation"
git push
```

- [ ] **Step 3: Confirm to user**

Report: 6 PR URLs, list of any spec-reviewer caps reached (so the user knows where review iteration was bounded), and the explicit reminder that **implementation does not start on this branch** — each spec ships from its own follow-on branch once the user merges the spec PR.

---

## §15 Cross-cutting protocols

### Spec-reviewer iteration

- Lifetime cap: 5 iterations per spec, per `.claude/agents/spec-reviewer.md`.
- HITL escalations land in the spec's § Open Decisions section — the user resolves before the spec PR is approved.
- The agent self-writes its log to `tasks/review-logs/spec-reviewer-log-<spec-slug>-<timestamp>.md`.

### Architect dispatch

- Architect runs in the **background** (Task 2.1 and Task 3.1 are dispatched, then Tasks 4 and 6 proceed inline while we wait).
- Architect output is consumed by Tasks 2 and 3 — never edited by the architect after the fact.
- If the architect's output disagrees with the mini-spec, escalate to user before authoring the spec.

### todo.md annotation rule

- Append-only. Format: ` → owned by <spec-slug>` at the **end** of the existing item line.
- Never delete, rewrite, or re-order existing items. Reviewers rely on stable line numbers.
- **Inside each spec**, every closed item is cited with line number **and** a verbatim quoted text snippet of the original todo entry (≥10 words). Snippets are durable across line-number shifts; line numbers alone are not.

### Spec-reviewer cap reached

If a spec hits the 5-iteration cap with directional findings unresolved, do not retry. Classify the unresolved findings into the spec's `## Review Residuals`:

- `HITL decisions:` items the user must answer.
- `Directional uncertainties:` tradeoffs the spec author has explicitly accepted.

Ship the PR with the residuals visible. Silent ambiguity is what `Review Residuals` exists to prevent.

### SHA-locking

- The cross-chunk invariants doc is pinned by SHA in every spec's front-matter.
- Architect outputs (Tasks 2.1, 3.1) are pinned by SHA in the consuming spec's front-matter.
- Any post-freeze amendment to invariants or an architect output requires a re-pin and a re-stamp of Task 6.5.

### Implementation-order discipline

- Implementation order is `1 → {2, 4, 6} → 5 → 3`. PR merge order does not imply dependency order.
- The order is canonical in `tasks/builds/pre-launch-hardening-specs/progress.md` § "Implementation Order (MANDATORY)".
- No code branch starts before Task 6.5 (spec freeze) AND Task 6.6 (consistency sweep) both stamp clear.

### Review cadence (sets user expectation; prevents review-pipeline bottleneck)

The user reviews at five fixed checkpoints, not after every task. This is the contract:

| After... | Review type | Estimated time |
|---|---|---|
| Task 0.6 (invariants doc) | Quick sanity review | 10–15 min |
| Task 1 PR (Chunk 1 — RLS) | Full review — foundation | full pass |
| Tasks 4 + 6 PRs | Batch review (together) | one combined pass |
| Task 2 PR (Chunk 2 — schema) | Full review — high risk | full pass |
| Task 5 PR (Chunk 5 — execution) | Targeted review (execution only) | scoped pass |
| Task 3 PR (Chunk 3 — dead-path) | Full review — final integration | full pass |
| Tasks 6.5 + 6.6 + 7 | Sign-off | quick pass |

Between checkpoints, the session keeps moving. The session **stops** at each checkpoint and waits for the user — even if the next task is mechanically obvious — so review feedback can be folded back in before downstream work commits to the wrong premise.

### Global stop condition (binding — applies across all tasks)

If any of the following occurs during execution, **STOP** and escalate to the user before the next task begins. Do not push through:

- `spec-reviewer` produces the same directional finding twice (i.e. a finding the agent flagged in iteration N is unresolved and re-flagged in iteration N+1, even after a Claude edit).
- An architect output conflicts with `architecture.md`, `docs/spec-context.md`, or the cross-chunk invariants doc.
- A decision requires introducing a new primitive that is not in `docs/spec-context.md § accepted_primitives` and the spec author cannot write a "why not reuse" paragraph defending it.
- Any task hits its retry limit on a verification check (per `CLAUDE.md § Verification Commands`).
- A todo.md item ID can't be reconciled (already covered for the four pre-flight orphans; this rule covers anything new found during drafting).

The stop condition is not a soft guideline. Pushing past it compounds errors into later specs and breaks the pipeline's correctness guarantee.

### When to STOP and escalate

- Architect output is incomplete or contradicts the mini-spec → user.
- Spec-reviewer flags a HITL conflict against `docs/spec-context.md` → user.
- Any cited todo item ID can't be resolved during pre-flight (already done above for the four orphan IDs — anything new during drafting is escalated).
- Any decision that would touch tenant data without an RLS opt-out reason → user, per `architecture.md` §1155.

---

## §16 Self-Review (run after writing — done at plan-write time)

- **Mini-spec coverage:** every chunk has a task. Out-of-scope mini-spec items are explicitly excluded in each spec's § Items NOT closed. ✓
- **Pre-flight findings:** four orphan IDs flagged with resolution paths. ✓
- **Per-task structure consistency:** every chunk task has 5 (or 6 for inline + investigate) steps; architect tasks have 3. ✓
- **Slug consistency:** spec slugs match mini-spec § "Spec authoring notes" naming convention (`docs/pre-launch-<chunk-slug>-spec.md`). ✓
- **Branch + PR-base discipline:** all per-chunk branches base off `spec/pre-launch-hardening`; user merges each into the integration branch then into main. ✓
- **No application code edits in any task.** ✓
- **No skipped review-pipeline gates** — spec-reviewer runs on every spec; HITL escalations are explicit; consistency sweep runs across all 6. ✓
- **Testing posture:** every spec's test plan defaults to `pure_function_only` per `spec-context.md`; any deviation is flagged inline. ✓
- **Cross-chunk invariants doc:** Task 0.6 produces the source-of-truth that prevents architectural drift. Each spec pins its SHA. ✓
- **Architect-output conflict check:** mandatory gate between Tasks 2.1/3.1 and Tasks 2/3 catches contradictions before specs are written against incompatible premises. ✓
- **Spec freeze gate (Task 6.5):** prevents implementation from starting on partial agreement. ✓
- **Cross-spec consistency sweep (Task 6.6):** catches naming, contract, and primitive inconsistencies that individual reviews miss. ✓
- **SHA-locking:** invariants and architect outputs are pinned by SHA in every consuming spec. Amendments force a re-stamp. ✓
- **Implementation Guardrails section in every spec:** MUST reuse / MUST NOT introduce / fragile areas — reduces spec-to-implementation translation drift. ✓
- **Review Residuals section in every spec:** classifies unresolved findings as HITL vs accepted directional tradeoffs — prevents silent ambiguity. ✓
- **todo.md annotation traceability:** every closed item carries both a line number (forward navigation) and a verbatim text snippet (durable backward link). ✓
- **MANDATORY implementation order in progress.md:** PR order ≠ dependency order. Engineers cannot pick a branch up without seeing the order block. ✓

---

## §17 Open questions for the user before Task 0 starts

1. **Branch base.** Plan branches `spec/pre-launch-hardening` off latest `origin/main`. Confirm — or specify a different base if PR #203 (claude/deferred-quality-fixes-ZKgVV, where the mini-spec was authored) should be merged first.
2. **Mini-spec source SHA.** Plan extracts the mini-spec from `1023ff02`. Confirm that's the canonical version, or point at a more recent revision if PR #203 has had subsequent edits.
3. **Per-chunk PR base.** Plan opens each chunk PR against `spec/pre-launch-hardening`. Alternative: each PR opens directly against `main` (loses the integration branch but skips the merge train). Confirm preference.
4. **Architect run mode.** Plan runs the two architect calls in the **background** (Task 2.1 + Task 3.1 dispatched in parallel, then Task 4 + Task 6 proceed inline while we wait). Confirm — or instruct sequential foreground if you want to read each architect output before the next runs.
5. **The four orphan IDs** (`SC-1`, `GATES-2026-04-26-1`, `SC-COVERAGE-BASELINE`, `RLS-CONTRACT-IMPORT`). Plan investigates each inside the owning chunk's drafting step, citing the closest todo line + the mini-spec coined handle. Confirm — or supply canonical IDs / resolution if you have them in another tracker.
