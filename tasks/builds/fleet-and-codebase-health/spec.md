# Spec: Fleet & Codebase Health Upgrades

**Slug:** `fleet-and-codebase-health`
**Class:** Major (cross-cutting; touches `.claude/agents/`, CLAUDE.md, gate scripts, archive layout, docs)
**Authored:** 2026-05-12
**Status:** DRAFT — pending review

> **Out of scope (explicitly deferred):** splitting the four obese services (`skillExecutor.ts`, `workflowEngineService.ts`, `skillAnalyzerServicePure.ts`, `agentExecutionService.ts`). That work runs in a separate branch as its own Major spec.

---

## Table of Contents

1. Goal
2. Scope summary
3. WS-A — Agent fleet upgrades
4. WS-B — Gate enforcement & route hygiene
5. WS-C — Debt cleanup
6. WS-D — Process clarification
7. Doc-sync impact
8. Chunk plan
9. Acceptance criteria
10. Risks
11. Open questions for operator

---

## 1. Goal

Two parallel hygiene investments delivered together because they share review pipeline and doc-sync surface:

- **A. Agent fleet upgrades** — adopt five high-ROI patterns from `msitarzewski/agency-agents` to sharpen our existing reviewers and add two new agents (`reality-checker`, `incident-commander`).
- **B. Codebase health** — close gate drift, clear deferred-item debt, codify reviewer-coverage policy, archive working-tree bloat, and resolve the parked PR #277.

Outcome: tighter review pipeline, restored architectural gate, leaner working tree, clear backlog, documented reviewer policy.

## 2. Scope summary

In-scope workstreams:

| ID | Workstream | Items |
|----|------------|-------|
| WS-A | Agent fleet upgrades | 5 |
| WS-B | Gate enforcement & route hygiene | 2 |
| WS-C | Debt cleanup | 4 |
| WS-D | Process clarification | 2 |

Out-of-scope (separate branches):
- Splitting obese services (`skillExecutor`, `workflowEngineService`, `skillAnalyzerServicePure`, `agentExecutionService`).
- Any product/feature work.
- New CI infrastructure beyond fixing the existing `verify-no-db-in-routes.sh` gate.

## 3. WS-A — Agent fleet upgrades

Source: `msitarzewski/agency-agents` (`engineering/` + `testing/` slice). Personality framing is dropped; we keep the technique.

### A1. `pr-reviewer` — severity tiers + mandatory "Why:"

**Change:** Update `.claude/agents/pr-reviewer.md` so every review comment carries (a) a severity tier and (b) a one-line "Why:" rationale.

**Tiers:**
- 🔴 **Blocking** — must be fixed before merge (bug, security, broken contract, gate violation).
- 🟡 **Should-fix** — non-blocking but expected to be addressed in-PR unless explicitly deferred.
- 💭 **Consider** — taste / future-proofing / nice-to-have. No expectation to act.

**Contract additions in agent definition:**
- Output template requires `[🔴|🟡|💭] <file:line>` prefix and a `Why:` line per finding.
- Final verdict line summarises counts (`Blocking: N / Should-fix: N / Consider: N`) before the overall verdict.
- A short **"Files NOT read"** disclosure section is appended when the diff was large enough to skim parts (lifted from agency-agents `codebase-onboarding-engineer`).

**Non-goals:** changing what `pr-reviewer` *does* — it's still read-only, still independent, still pre-merge gate. Only the *output shape* changes.

### A2. New `reality-checker` agent

**Role:** post-`pr-reviewer` completion verifier. Defaults verdict to `NEEDS_WORK`; the implementer must surface command-execution proof to upgrade to `READY`.

**When invoked:**
- Auto from `feature-coordinator`'s branch-level review pass on **Significant / Major** tasks, after `pr-reviewer` returns `APPROVED`.
- Manual invocation also supported (`reality-checker: verify the changes I just made`).
- Skipped for **Trivial / Standard** tasks unless explicitly requested.

**Contract:**
- Reads the branch diff and the implementer's stated success criteria (from `progress.md` or the chat summary the caller passes in).
- For each criterion, demands one of: passing test output, log excerpt, deterministic check, or a manual-verification screenshot path. No proof → criterion fails.
- Outputs a checklist with `verified by <evidence>` or `unverified — <reason>`.
- Final verdict: `READY` (all criteria verified) or `NEEDS_WORK` (one or more unverified).
- Lists "Files NOT read" if the diff exceeded its read window.

**Non-goals:** running tests itself, fixing anything, adjudicating subjective UX. It's a verifier, not a builder.

**Position in pipeline:** runs *after* `pr-reviewer`, *before* `dual-reviewer` (when Codex available). Updates the review pipeline section in `CLAUDE.md` and `tasks/review-logs/README.md`.

### A3. `adversarial-reviewer` — STRIDE pass + trust-boundary section

**Change:** Extend `.claude/agents/adversarial-reviewer.md` so the report includes:

- A **STRIDE** sweep (Spoofing / Tampering / Repudiation / Information disclosure / DoS / Elevation of privilege) for each changed surface in the diff. Each category gets a one-line finding or an explicit "no applicable risk in this diff."
- A **trust-boundary callout** section listing every boundary the diff crosses (e.g. `subaccount -> organisation`, `external webhook -> server`, `LLM provider -> our prompt`). Each boundary names the enforcement mechanism the change relies on.

**Non-goals:** the agent stays read-only and Phase 1 advisory; auto-trigger surface (`docs/dev-pipeline-coordinators-spec.md §5.1.2`) is unchanged.

### A4. Minimal-change rules into CLAUDE.md §6 and `builder.md`

**Change:** Promote three principles from agency-agents `minimal-change-engineer` into our own discipline:

- **Three-Similar-Lines rule** — resist abstraction until the *fourth* occurrence. Three near-identical lines is acceptable; do not extract a helper until a fourth lands.
- **Line-by-line justification** — every changed line should trace to the user's request. (Already in CLAUDE.md §6 as a sentence; promote to an enforced check in `builder.md`.)
- **"Surface, don't smuggle"** — if `builder` notices an out-of-scope improvement (dead code, smell, doc drift) while implementing a chunk, it surfaces it in the chunk verdict's `notes` field and routes to `tasks/todo.md`. It does not silently fix it.

**Files touched:** `CLAUDE.md` §6, `.claude/agents/builder.md` (G1 checklist + verdict template).

### A5. New `incident-commander` agent

**Role:** coordinator for *actual production incidents* (broken main, prod outage, data integrity issue, security incident). Distinct from `hotfix` — `hotfix` is the fast-path fix; `incident-commander` is the playbook for "something is on fire and we need to coordinate the response, communicate, and write a post-mortem."

**Contract:**

- Reads `docs/incident-response.md` (new, see §7 doc-sync) for the SEV matrix and on-call expectations.
- Step 1: classify SEV (SEV-1 critical / SEV-2 high / SEV-3 medium / SEV-4 low) and confirm with operator.
- Step 2: assign **scribe** role (the agent itself if no other coordinator present) — appends timestamped log entries to `tasks/incidents/<YYYY-MM-DD-slug>/timeline.md`.
- Step 3: invoke `hotfix` for the actual fix (delegation, not duplication).
- Step 4: post-incident — drives a 48-hour post-mortem template into `tasks/incidents/<YYYY-MM-DD-slug>/postmortem.md`. Template fields: summary, impact, timeline, root cause (5-whys), contributing factors, what went well, what didn't, action items (owners + due dates).

**Inline vs dispatched:** runs inline in the main session (like other coordinators), so the operator sees the timeline build in real time. Per CLAUDE.md, coordinators cannot dispatch coordinators; main session must adopt the playbook.

**Non-goals:** does not run tests, does not write the fix itself (delegates to `hotfix`), does not communicate externally (operator does that — agent drafts the message).

## 4. WS-B — Gate enforcement & route hygiene

### B1. Restore `verify-no-db-in-routes.sh` to blocking

**Problem:** 10 route files import `db` directly in violation of `DEVELOPMENT_GUIDELINES.md §2` and the route-pattern section of `architecture.md`. Only `workspaceInboundWebhook.ts` carries a documented `guard-ignore` exception. The other 9 are silent drift.

**Violators (audit-confirmed):**

- `server/routes/agentPromptRevisions.ts`
- `server/routes/mcp.ts`
- `server/routes/projects.ts`
- `server/routes/agentTriggers.ts`
- `server/routes/permissionSets.ts`
- `server/routes/integrationConnections.ts`
- `server/routes/portal.ts`
- `server/routes/systemEngines.ts`
- `server/routes/webhookAdapter.ts`

(`workspaceInboundWebhook.ts` already exempted — leave alone.)

**Approach (architecture decision):**

1. **First**, investigate `scripts/verify-no-db-in-routes.sh` — determine *why* the gate is letting these through. Either:
   - (a) the matcher is too narrow (e.g. only catches `from "../db"` and misses `from "../../db"`), or
   - (b) the file list is filtered (e.g. legacy allowlist).
2. **Fix the gate first**, so it would fail in CI as it stands today.
3. **Then** triage each violator into one of:
   - **Move to service** — extract DB access into an existing or new service. Default path.
   - **Document exception** — only if there is a genuine reason the route legitimately reaches DB directly (mirror `workspaceInboundWebhook.ts` precedent). Each exception requires a `guard-ignore` comment with rationale + ADR reference.
4. Per-route work is independent; can be parallelised across builder chunks.

**Out-of-scope inside this spec:** redesigning the gate framework itself, or auditing other `verify-*.sh` scripts for drift (separate audit if requested).

### B2. `replit.md` typecheck drift

**Problem:** `replit.md` line 22 claims "there is no `npm run typecheck` script," but `package.json` defines one.

**Fix:** Single-edit doc correction. Update to reference the actual `typecheck` script and the dual-tsconfig one-liner referenced from CLAUDE.md.

## 5. WS-C — Debt cleanup

### C1. `tasks/todo.md` triage sprint

**Problem:** 4,408 lines; 281 items marked "deferred." Unbounded growth.

**Approach (architecture-level, not item-level):**

- Define three end-states for every deferred item: **SHIP** (file as a real spec/task), **ARCHIVE** (move to `tasks/todo-archive/<YYYY-Q>.md` with one-line reason), **ACCEPT** (promote to a documented permanent stance in `architecture.md`, `KNOWLEDGE.md`, or an ADR).
- Group items by domain before triaging — saves re-loading mental context per item.
- Output: `tasks/todo.md` reduced to in-flight items only; new `tasks/todo-archive/2026-Q2.md` holding the archived set; ADR references for the ACCEPT pile.
- Time-box: target ≤500 lines for `tasks/todo.md` post-sprint.

**Not in scope here:** implementing any SHIP item — that becomes its own spec.

### C2. `KNOWLEDGE.md` sweep

**Problem:** 3,785 lines; file's own policy declares ≥3,000 lines "noise."

**Approach:**

- Group existing entries by domain.
- Promote any pattern cited ≥3 times into a new ADR under `docs/decisions/`.
- Compress redundant entries (keep oldest if equivalent).
- Target: ≤2,500 lines post-sweep, in line with the file's own stated bound.

**Constraint:** CLAUDE.md §3 — "never edit or remove existing entries — only append." This sweep is the explicit exception, called out as a "quarterly grouping pass." Document the sweep in a single dated header so future readers know the trim happened.

### C3. PR #277 (`support-desk-canonical`) — close or finish

**Problem:** parked indefinitely on `claude/support-ticket-structure-xMcy8`. Open PRs decay via merge conflicts and stale doc references.

**Decision required from operator before chunk runs:** finish (resume via `tasks/builds/support-desk-canonical/handoff.md`) or close.

**This spec does not pick one** — it surfaces the decision as a gate. Spec sign-off requires the operator's choice.

### C4. Working-tree bloat — archive `prototypes/` and `attached_assets/`

**Problem:** `prototypes/` (4.6 MB) + `attached_assets/` (928 KB) live in repo root. Likely stale.

**Approach:**

- Move both to `_archive/` at repo root (kept in-repo for history but visually separated).
- Audit any in-code references to either path; update any that exist.
- Add a one-line `_archive/README.md` explaining the convention.

**Constraint:** preserve git history (use `git mv`, not delete+add).

## 6. WS-D — Process clarification

### D1. Reviewer-coverage policy

**Problem:** 5 recent merges shipped with `dual-reviewer SKIPPED` or `chatgpt-pr-review SKIPPED`. Either the policy needs to change to match reality, or the tooling needs to be reliable enough to enforce.

**Approach (architecture decision):**

- Audit the SKIPPED reasons across the last 10 merges. Categorise: (a) Codex CLI unavailable in environment, (b) ChatGPT-web manual round skipped for speed, (c) other.
- Pick one of three policy postures and document it in `CLAUDE.md` § Review pipeline:
  - **STRICT** — no merge without all reviewers; failures block.
  - **GRADED** — `pr-reviewer` mandatory; `dual-reviewer`/`adversarial-reviewer`/`chatgpt-pr-review` mandatory by task class (Significant/Major) but skippable for documented reasons.
  - **ADVISORY** — only `pr-reviewer` mandatory; others always optional.
- Update `feature-coordinator` and `finalisation-coordinator` to enforce whichever posture is chosen, and to **fail loudly** (not silently skip) when a required reviewer is unavailable.

**Recommendation embedded in spec:** GRADED, since it matches current intent. Spec-reviewer / operator can override.

### D2. Testing-posture flip date

**Problem:** `DEVELOPMENT_GUIDELINES.md §7` ties the gates-only → full-suite transition to "first live agency client onboarding," but the trigger is approaching and the prep work hasn't started.

**Approach:**

- This spec does **not** flip the posture. It produces a **transition plan** at `docs/testing-transition-plan.md`:
  - Inventory: which suites need to exist before flip-day (integration tests for RLS-protected flows, workflow engine smoke tests, the four obese services' critical paths).
  - Sequencing: which gates flip first, which stay gates-only longest.
  - Estimated effort: rough S/M/L per suite.
  - Trigger restatement: clearer than "first live client" — e.g. "T-minus-14-days from first live client onboarding."
- Add a TODO in `tasks/todo.md` for the operator to decide the actual trigger date.

## 7. Doc-sync impact

Following `docs/doc-sync.md`. Every WS item below names the docs it touches.

| WS | Doc(s) touched |
|----|----------------|
| A1 | `.claude/agents/pr-reviewer.md`, `tasks/review-logs/README.md` (output format) |
| A2 | `.claude/agents/reality-checker.md` (new), `CLAUDE.md` § Local Dev Agent Fleet + Review pipeline, `tasks/review-logs/README.md`, `.claude/agents/feature-coordinator.md` (insertion in pipeline), `.claude/CHANGELOG.md` |
| A3 | `.claude/agents/adversarial-reviewer.md` |
| A4 | `CLAUDE.md` §6, `.claude/agents/builder.md` |
| A5 | `.claude/agents/incident-commander.md` (new), `docs/incident-response.md` (new), `CLAUDE.md` § Local Dev Agent Fleet, `.claude/CHANGELOG.md` |
| B1 | `scripts/verify-no-db-in-routes.sh`, 9 route files (or services they migrate into), possibly one new ADR under `docs/decisions/` if a documented exception is added |
| B2 | `replit.md` |
| C1 | `tasks/todo.md`, `tasks/todo-archive/2026-Q2.md` (new), zero-to-N ADRs |
| C2 | `KNOWLEDGE.md`, zero-to-N ADRs |
| C3 | `tasks/current-focus.md` (paused-build line removed once decided), possibly PR #277 itself |
| C4 | `_archive/README.md` (new), any in-code reference paths |
| D1 | `CLAUDE.md` § Review pipeline, `.claude/agents/feature-coordinator.md`, `.claude/agents/finalisation-coordinator.md` |
| D2 | `docs/testing-transition-plan.md` (new), `tasks/todo.md` |

`docs/capabilities.md` is **not** touched — this spec adds no customer-visible product capabilities.

## 8. Chunk plan

Ordered. Each chunk is independent at the file-level so a single `builder` invocation can land it cleanly.

| # | Chunk | WS | Effort |
|---|-------|----|--------|
| 1 | Fix `verify-no-db-in-routes.sh` (gate-only; no route edits yet) | B1 | S |
| 2 | `replit.md` typecheck correction | B2 | S |
| 3 | Move `prototypes/` + `attached_assets/` to `_archive/` (`git mv`); add `_archive/README.md`; sweep in-code refs | C4 | S |
| 4 | `pr-reviewer` severity tiers + "Why:" + "Files NOT read" disclosure | A1 | S |
| 5 | `adversarial-reviewer` STRIDE + trust-boundary section | A3 | S |
| 6 | Minimal-change rules into `CLAUDE.md` §6 + `builder.md` (G1 checklist + verdict notes) | A4 | S |
| 7 | New `reality-checker` agent + wire into `feature-coordinator` pipeline + update `CLAUDE.md` fleet table + `tasks/review-logs/README.md` | A2 | M |
| 8 | New `incident-commander` agent + `docs/incident-response.md` SEV matrix + post-mortem template + `CLAUDE.md` fleet table | A5 | M |
| 9 | Reviewer-coverage policy: audit SKIPPED reasons, document chosen posture in `CLAUDE.md`, update `feature-coordinator`/`finalisation-coordinator` enforcement | D1 | M |
| 10 | `docs/testing-transition-plan.md` + `tasks/todo.md` decision-needed entry | D2 | M |
| 11 | Route violator triage — each violator migrated to service or documented exception (one builder chunk per violator, or grouped 3-3-3) | B1 | M-L (≈9 sub-chunks) |
| 12 | `KNOWLEDGE.md` sweep — group, promote to ADRs, compress | C2 | M |
| 13 | `tasks/todo.md` triage sprint — categorise 281 deferred items into SHIP/ARCHIVE/ACCEPT; produce `tasks/todo-archive/2026-Q2.md` | C1 | L |
| 14 | PR #277 decision and execution — finish or close (gated on operator choice from §5.C3) | C3 | varies |

**Sequencing notes:**

- Chunks 1-6 are pure file edits, no architectural decisions left open → can land in one session each.
- Chunk 11 (route violators) waits on chunk 1 (gate fix) so each migration can be verified by the now-strict gate.
- Chunks 12 and 13 (`KNOWLEDGE.md` and `todo.md` sweeps) are end-of-build because the WS-A/B work will itself emit follow-ups that should land in the archive sweep, not the live file.
- Chunk 14 (PR #277) blocks on operator decision; spec-coordinator gates on it before plan finalisation.

## 9. Acceptance criteria

Spec passes when:

- **Gate restored:** `npm run lint && scripts/verify-no-db-in-routes.sh` is GREEN on the branch with all 9 violators migrated or documented; `workspaceInboundWebhook.ts` exemption preserved.
- **Two new agents live:** `.claude/agents/reality-checker.md` and `.claude/agents/incident-commander.md` exist, are referenced in CLAUDE.md fleet table, and `validate-setup` passes.
- **Three existing agents upgraded:** `pr-reviewer`, `adversarial-reviewer`, `builder` carry the new contracts; `feature-coordinator` pipeline updated.
- **CLAUDE.md updates:** §6 carries the three minimal-change rules; § Review pipeline carries the chosen reviewer-coverage posture; fleet table lists the two new agents.
- **Doc cleanup:** `replit.md` corrected; `_archive/` exists with README; `prototypes/` + `attached_assets/` moved (with git history preserved).
- **Debt visible:** `tasks/todo.md` ≤500 lines; `tasks/todo-archive/2026-Q2.md` exists; `KNOWLEDGE.md` ≤2,500 lines.
- **Transition plan written:** `docs/testing-transition-plan.md` exists with the inventory and trigger-date TODO.
- **PR #277:** decision logged and executed (merged or closed).
- **CI green:** all 66 `verify-*.sh` gates pass on the branch tip.

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Route violator migrations break runtime behaviour | Each migration is its own sub-chunk; G1 (lint+typecheck+build) per sub-chunk; `pr-reviewer` mandatory per CLAUDE.md. |
| `KNOWLEDGE.md` sweep loses context | Sweep adds a dated header `## 2026-05 quarterly trim` recording compressed/promoted entries; full pre-sweep file remains in git history. |
| `tasks/todo.md` triage misclassifies a real item as ARCHIVE | Archive is in-repo (not deleted); reversal is a `git mv` away. |
| Reviewer-policy posture pick is wrong | `CLAUDE.md` change is one section; reversible in a single edit. |
| `reality-checker` adds friction without value on borderline tasks | Skipped on Trivial/Standard; manual override always available; revisit after 5 runs. |
| `incident-commander` never gets used because real incidents are rare pre-launch | Acceptable — agent is cheap to maintain and present-when-needed beats absent-when-needed. |
| Operator hasn't yet decided on PR #277 | Chunk 14 is gated; the rest of the spec ships independently. |

## 11. Open questions for operator

1. **Reviewer posture (§6 D1):** STRICT / GRADED / ADVISORY — recommendation is GRADED. Confirm or pick.
2. **PR #277 fate (§5 C3):** finish or close.
3. **Archive convention (§5 C4):** `_archive/` at repo root vs. moving the contents out of repo entirely. Recommendation is in-repo for history; confirm.
4. **Testing-transition trigger (§6 D2):** keep "first live client" or pick a concrete date.

Spec-coordinator surfaces these as a single decision block before plan-authoring begins.
