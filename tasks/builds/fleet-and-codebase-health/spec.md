# Spec: Fleet & Codebase Health Upgrades

**Slug:** `fleet-and-codebase-health`
**Class:** Major (cross-cutting; touches `.claude/agents/`, CLAUDE.md, gate scripts, archive layout, docs)
**Authored:** 2026-05-12
**Locked:** 2026-05-12 — all 4 pre-plan decisions resolved (see §11)
**Status:** LOCKED — ready for plan-authoring

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

**Rationale:** Current reviewer output mixes blockers, nice-to-haves, and stylistic nits in a flat list, so the implementer either fixes everything (slow) or skims and risks missing the one blocker (unsafe). Severity tiers let the implementer triage in seconds. The mandatory `Why:` line prevents low-signal "this should probably be X" comments that consume review time without adding rationale — every finding has to earn its space.

**Change:** Update `.claude/agents/pr-reviewer.md` so every review comment carries (a) a severity tier and (b) a one-line "Why:" rationale.

**Tiers:**
- 🔴 **Blocking** — must be fixed before merge (bug, security, broken contract, gate violation).
- 🟡 **Should-fix** — non-blocking but expected to be addressed in-PR unless explicitly deferred.
- 💭 **Consider** — taste / future-proofing / nice-to-have. No expectation to act.

**Contract additions in agent definition:**
- Output template requires `[🔴|🟡|💭] <file:line>` prefix and a `Why:` line per finding.
- Final verdict line summarises counts (`Blocking: N / Should-fix: N / Consider: N`) before the overall verdict.
- A short **"Files NOT read"** disclosure section is appended when the diff was large enough to skim parts (lifted from agency-agents `codebase-onboarding-engineer`).
- **Disclosure constraint:** if files are not read, the reviewer must state whether unread files could invalidate the verdict. If yes, the verdict cannot be `APPROVED`. This closes the loophole where a reviewer disclaims its way out of doing the review.

**Non-goals:** changing what `pr-reviewer` *does* — it's still read-only, still independent, still pre-merge gate. Only the *output shape* changes.

### A2. New `reality-checker` agent

**Rationale:** CLAUDE.md §4 demands "verification before done," but no agent in the current pipeline actually enforces it — `pr-reviewer` reads the diff without running anything, `dual-reviewer` is optional, and the implementing session is biased toward "looks good." LLMs are systematically overconfident about completion, and the recent audit showed five merges where reviewers were silently skipped. A default-pessimistic verifier that demands command-execution proof (test output, log excerpt, screenshot path) turns "should work" into "I ran it and here's the evidence." Cheaper to insert one gate than to debug post-merge regressions.

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

**Caller obligation:** the invoking coordinator must pass the implementer's claimed verification evidence into `reality-checker`. If no evidence is supplied, `reality-checker` returns `NEEDS_WORK` rather than attempting to run commands. This prevents future coordinators from drifting into "the verifier will run the tests for me."

**Position in pipeline:** runs *after* `pr-reviewer`, *before* `dual-reviewer` (when Codex available). Updates the review pipeline section in `CLAUDE.md` and `tasks/review-logs/README.md`.

### A3. `adversarial-reviewer` — STRIDE pass + trust-boundary section

**Rationale:** Adversarial-reviewer currently relies on the reviewer's intuition to spot security holes. Intuitive sweeps reliably catch SQL injection and obvious auth bypass, but consistently miss whole categories — repudiation (no audit trail), information disclosure via error messages, DoS via unbounded loops. STRIDE is a structured checklist that forces a pass over every category, including the ones humans forget. The trust-boundary section makes implicit assumptions explicit — when a change quietly removes the RLS guard a route depended on, that regression now surfaces in the report instead of in production.

**Change:** Extend `.claude/agents/adversarial-reviewer.md` so the report includes:

- A **STRIDE** sweep (Spoofing / Tampering / Repudiation / Information disclosure / DoS / Elevation of privilege) for each changed surface in the diff. Each category gets a one-line finding or an explicit "no applicable risk in this diff."
- A **trust-boundary callout** section listing every boundary the diff crosses (e.g. `subaccount -> organisation`, `external webhook -> server`, `LLM provider -> our prompt`). Each boundary names the enforcement mechanism the change relies on.

**Non-goals:** the agent stays read-only and Phase 1 advisory; auto-trigger surface (`docs/dev-pipeline-coordinators-spec.md §5.1.2`) is unchanged.

### A4. Minimal-change rules into CLAUDE.md §6 and `builder.md`

**Rationale:** Two recurring failure modes in builder output: (1) premature abstraction — a helper extracted at the second occurrence locks in the wrong shape and has to be refactored when the third call site doesn't fit; (2) scope creep — a chunk that should touch 3 files ends up touching 11 because the builder "noticed" a smell. CLAUDE.md §6 already says "surgical changes," but as a sentence in prose it gets skimmed. Promoting it to enforced checks in `builder.md` (Three-Similar-Lines, line-by-line justification, "Surface, don't smuggle") makes the principle operational instead of aspirational.

**Change:** Promote three principles from agency-agents `minimal-change-engineer` into our own discipline:

- **Three-Similar-Lines rule** — resist abstraction until the *fourth* occurrence. Three near-identical lines is acceptable; do not extract a helper until a fourth lands.
- **Line-by-line justification** — every changed line should trace to the user's request. (Already in CLAUDE.md §6 as a sentence; promote to an enforced check in `builder.md`.)
- **"Surface, don't smuggle"** — if `builder` notices an out-of-scope improvement (dead code, smell, doc drift) while implementing a chunk, it surfaces it in the chunk verdict's `notes` field and routes to `tasks/todo.md`. It does not silently fix it.

**Files touched:** `CLAUDE.md` §6, `.claude/agents/builder.md` (G1 checklist + verdict template).

### A5. New `incident-commander` agent

**Rationale:** Pre-launch we have `hotfix` for the fast-path fix, but no playbook for the broader "something is on fire" scenario — prod outage, data integrity issue, security incident. In a real incident the first hour is wasted on questions that should be pre-answered: who is coordinating, what severity is this, who's writing the timeline, what's the post-mortem template. Building this now costs an hour while no incidents are live; building it during the first real incident costs the incident's first hour. SEV matrix + scribe role + 48-hour post-mortem template are the standard pattern for a reason.

**Role:** coordinator for *actual production incidents* (broken main, prod outage, data integrity issue, security incident). Distinct from `hotfix` — `hotfix` is the fast-path fix; `incident-commander` is the playbook for "something is on fire and we need to coordinate the response, communicate, and write a post-mortem."

**Contract:**

- Reads `docs/incident-response.md` (new, see §7 doc-sync) for the SEV matrix and on-call expectations.
- Step 1: classify SEV (SEV-1 critical / SEV-2 high / SEV-3 medium / SEV-4 low) and confirm with operator.
- Step 2: assign **scribe** role (the agent itself if no other coordinator present) — appends timestamped log entries to `tasks/incidents/<YYYY-MM-DD-slug>/timeline.md`.
- Step 3: instruct the main session to switch to the `hotfix` playbook for the fix work. `incident-commander` does **not** directly dispatch another coordinator — per CLAUDE.md, coordinators cannot dispatch coordinators. The main session adopts `hotfix` inline.
- Step 4: post-incident — drives a 48-hour post-mortem template into `tasks/incidents/<YYYY-MM-DD-slug>/postmortem.md`. Template fields: summary, impact, timeline, root cause (5-whys), contributing factors, what went well, what didn't, action items (owners + due dates).

**Inline vs dispatched:** runs inline in the main session (like other coordinators), so the operator sees the timeline build in real time. Per CLAUDE.md, coordinators cannot dispatch coordinators; main session must adopt the playbook.

**Non-goals:** does not run tests, does not write the fix itself (delegates to `hotfix`), does not communicate externally (operator does that — agent drafts the message).

## 4. WS-B — Gate enforcement & route hygiene

### B1. Restore `verify-no-db-in-routes.sh` to blocking

**Rationale:** This is one of the load-bearing tenant-isolation rules. Routes that hit `db` directly bypass the service-layer enforcement of `eq(organisationId, ...)` filters; a single missed scope filter becomes a cross-tenant data leak. The CI gate exists precisely so this can't happen by accident — but the gate is currently letting 9 violations through silently, which means we have the *appearance* of safety without the substance. A drifting gate is worse than no gate: developers trust it, so violations stop being caught in review either. Restoring the gate is the single highest-leverage tenant-safety win in the spec.

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
   - **Move to service** — extract DB access into an existing or new service. Default path. Must satisfy the service-layer migration invariant below.
   - **Document exception** — only if there is a genuine reason the route legitimately reaches DB directly (mirror `workspaceInboundWebhook.ts` precedent). Each exception requires a `guard-ignore` comment in the exact format below.
4. Per-route work is independent; can be parallelised across builder chunks.

**Allowed exception format (T1):**

```
// guard-ignore verify-no-db-in-routes: <ADR-id> <one-line rationale>
```

The script must **reject** any bare `guard-ignore` without both an ADR reference and a rationale. Inconsistent comment shapes will not parse and break the gate again.

**Service-layer migration invariant (T2):** A migration is only "done" when all four hold:

- Route handler performs auth / input parsing / response shaping only.
- DB access moves behind a service method.
- The service method accepts organisation / subaccount scope explicitly, or derives it through the existing scoped-context pattern.
- The route must not import `db`, schema tables, or Drizzle query helpers.

This prevents a superficial migration where the route re-exports the same query semantics through a thin wrapper. The intent is real separation, not file relocation.

**Out-of-scope inside this spec:** redesigning the gate framework itself, or auditing other `verify-*.sh` scripts for drift (separate audit if requested).

### B2. `replit.md` typecheck drift

**Rationale:** `replit.md` is the first file a new Replit session reads — its job is to bootstrap the agent's mental model. A doc that incorrectly says "no typecheck script" trains every new session to skip typecheck, which propagates into every PR that session opens. Cost to fix: two lines. Cost of leaving it: every new session re-learns the same false constraint and ships TS-broken code more often than it should.

**Problem:** `replit.md` line 22 claims "there is no `npm run typecheck` script," but `package.json` defines one.

**Fix:** Single-edit doc correction. Update to reference the actual `typecheck` script and the dual-tsconfig one-liner referenced from CLAUDE.md.

## 5. WS-C — Debt cleanup

### C1. `tasks/todo.md` triage sprint

**Rationale:** A backlog with 281 deferred items is no longer a backlog — it's a graveyard. Real-priority items get buried in noise so planning can't surface them, and the file's frictionless-append design means it only grows. Either we promote items to the work they actually represent (specs, ADRs, accepted stances) or we acknowledge the items aren't getting done and archive them. Pre-launch is the cheapest moment to clear it; once paying customers are on, the backlog grows faster than triage can keep up.

**Problem:** 4,408 lines; 281 items marked "deferred." Unbounded growth.

**Approach (architecture-level, not item-level):**

- Define three end-states for every deferred item: **SHIP** (file as a real spec/task), **ARCHIVE** (move to `tasks/todo-archive/<YYYY-Q>.md` with one-line reason), **ACCEPT** (promote to a documented permanent stance in `architecture.md`, `KNOWLEDGE.md`, or an ADR).
- Group items by domain before triaging — saves re-loading mental context per item.
- Output: `tasks/todo.md` reduced to in-flight items only; new `tasks/todo-archive/2026-Q2.md` holding the archived set; ADR references for the ACCEPT pile.
- Time-box: target ≤500 lines for `tasks/todo.md` post-sprint.

**Inventory-first workflow (mandatory):**

Before any mutation of `tasks/todo.md`, the builder produces `tasks/todo-triage-inventory.md` with one row per deferred item:

- item id / heading
- domain
- proposed end-state: SHIP / ARCHIVE / ACCEPT
- one-line rationale
- destination file (target spec / archive section / ADR id)

The triage applies **only after operator or spec-coordinator approval of the inventory**. This converts a giant unreviewable diff into a flat list the operator can scan in one pass.

**Not in scope here:** implementing any SHIP item — that becomes its own spec.

### C2. `KNOWLEDGE.md` sweep

**Rationale:** `KNOWLEDGE.md` is loaded into context routinely — every session pays its token cost. At 3,785 lines it has already crossed the size threshold the file itself declares as "noise," and signal density falls as length grows: a session looking for one pattern wades through many. Patterns cited 3+ times are stable enough to be ADRs (durable, dated, findable); the rest are one-off observations that don't deserve a seat in every session's context window. Sweep restores the file as a focused reference.

**Problem:** 3,785 lines; file's own policy declares ≥3,000 lines "noise."

**Approach:**

- Group existing entries by domain.
- Promote any pattern cited ≥3 times into a new ADR under `docs/decisions/`.
- Compress redundant entries (keep oldest if equivalent).
- Target: ≤2,500 lines post-sweep, in line with the file's own stated bound.

**Inventory-first workflow (mandatory):**

Before any mutation of `KNOWLEDGE.md`, the builder produces `docs/knowledge-sweep-inventory.md`:

- grouped entries (by domain)
- proposed ADR promotions (with target ADR ids)
- duplicate / compression candidates (with rationale)
- entries retained unchanged

**ADR-creation cap (T1):** prefer one ADR per domain-level pattern, not one per repeated sentence. If the inventory proposes more than **5** new ADRs, group lower-priority candidates under a "defer ADR" bucket rather than generating them all in this sweep. Sprawl is the failure mode this guard prevents.

**Inventory lifecycle (applies to both C1 and C2):**

- Inventories must be committed at least until the sweep PR is reviewed and merged.
- If an inventory is removed before final merge, the operator's approval decision and an inventory summary (counts per end-state, ADR ids generated, archive destinations) must be preserved either in the archive file or in a dated header at the top of the swept file (`KNOWLEDGE.md` / `tasks/todo.md`).
- Default: keep them committed. They are valuable provenance for future quarterly sweeps.

**Non-deletion rule:** No entry may be deleted outright. Removed or compressed content must either (a) be represented in a new ADR, (b) survive as a canonical compressed entry, or (c) remain recoverable through the sweep inventory. The full pre-sweep file remains in git history regardless.

**Constraint:** CLAUDE.md §3 — "never edit or remove existing entries — only append." This sweep is the explicit exception, called out as a "quarterly grouping pass." Document the sweep in a single dated header so future readers know the trim happened.

### C3. PR #277 (`support-desk-canonical`) — DECIDED: close

**Rationale:** A parked PR is a quiet liability. Every week that passes, `main` evolves and the merge cost grows — eventually crossing the value the PR offers. Holding it open also clutters `tasks/current-focus.md` and tempts future sessions to half-resume it.

**Decision (2026-05-12):** **Close.** Phase 2 was "previously recorded complete" but never finished review; resuming costs more than restarting clean if support-desk redesign is needed later. PR closed with a comment explaining context; `tasks/current-focus.md` paused-build line removed.

**No chunk in this spec.** If support-desk capability matters later, draft a fresh spec.

### C4. Working-tree bloat — archive `prototypes/` and `attached_assets/`

**Rationale:** 5.5 MB of stale artifacts at repo root visually drowns the active directories. Both human contributors and Claude sessions treat repo-root entries as "current and load-bearing"; an `_archive/` convention is a visual contract that says "look elsewhere for active work." Git history is preserved via `git mv`, so nothing is lost — just relocated to where it belongs.

**Problem:** `prototypes/` (4.6 MB) + `attached_assets/` (928 KB) live in repo root. Likely stale.

**Approach:**

- Move both to `_archive/` at repo root (kept in-repo for history but visually separated). **DECIDED 2026-05-12** — in-repo archive preserves history trivially via `git mv` and keeps mockup-log references valid.
- Audit any in-code references to either path; update any that exist.
- Add a one-line `_archive/README.md` explaining the convention.

**Constraint:** preserve git history (use `git mv`, not delete+add).

**Chunk acceptance (T7):**

- `rg "prototypes/|attached_assets/"` reviewed after the move. Every remaining reference either intentionally points to `_archive/...` or is documented as historical.
- `.gitignore` reviewed for obsolete root-path assumptions about `prototypes/` or `attached_assets/`.
- Doc references (README, mockup-log, build artefacts) updated where the new path matters.

## 6. WS-D — Process clarification

### D1. Reviewer-coverage policy

**Rationale:** A policy that gets silently skipped is worse than a weaker policy that's actually followed — it provides false confidence that reviews happened when they didn't. The audit shows five merges in the last month where required reviewers were marked SKIPPED with no remediation. Either the bar is wrong (tooling can't meet it) or the bar is being ignored (cultural drift). Picking a posture (STRICT/GRADED/ADVISORY) and wiring it into the coordinators so they fail loudly when a required reviewer is unavailable closes the gap between declared and actual policy.

**Problem:** 5 recent merges shipped with `dual-reviewer SKIPPED` or `chatgpt-pr-review SKIPPED`. Either the policy needs to change to match reality, or the tooling needs to be reliable enough to enforce.

**Approach (architecture decision):**

- Audit the SKIPPED reasons across the last 10 merges. Categorise: (a) Codex CLI unavailable in environment, (b) ChatGPT-web manual round skipped for speed, (c) other.
- Pick one of three policy postures and document it in `CLAUDE.md` § Review pipeline:
  - **STRICT** — no merge without all reviewers; failures block.
  - **GRADED** — `pr-reviewer` mandatory; `dual-reviewer`/`adversarial-reviewer`/`chatgpt-pr-review` mandatory by task class (Significant/Major) but skippable for documented reasons.
  - **ADVISORY** — only `pr-reviewer` mandatory; others always optional.
- Update `feature-coordinator` and `finalisation-coordinator` to enforce whichever posture is chosen, and to **fail loudly** (not silently skip) when a required reviewer is unavailable.

**REVIEW_GAP artifact (T5):** When a required reviewer is skipped under any posture, finalisation must write a `REVIEW_GAP` entry to `tasks/current-focus.md` (aligned with the existing pattern). Required fields:

- reviewer name
- task class (Trivial / Standard / Significant / Major)
- reason unavailable or skipped
- operator override, if any (with timestamp)
- remediation: TODO entry or explicit acceptance

A silent skip with no `REVIEW_GAP` entry is itself a policy violation.

**Decision (2026-05-12):** **GRADED.** `pr-reviewer` always mandatory; `dual-reviewer` / `adversarial-reviewer` / `chatgpt-pr-review` mandatory by task class (Significant / Major) but skippable with a documented `REVIEW_GAP` entry. This is the posture the coordinators must enforce.

### D2. Testing-posture flip date

**Rationale:** Gates-only is the right posture pre-launch — it saves the test-maintenance overhead while the product shape is still moving. But once paying customers are on, a regression the gates can't catch becomes a customer-visible bug, and the cost of "no integration tests for RLS-protected flows" stops being theoretical. The transition itself is L-effort (integration tests for the four critical service paths alone), so waiting until "first live client" is on the doorstep means scrambling under deadline. A transition plan written now buys lead time and lets the operator pick a trigger date with full cost visibility.

**Problem:** `DEVELOPMENT_GUIDELINES.md §7` ties the gates-only → full-suite transition to "first live agency client onboarding," but the trigger is approaching and the prep work hasn't started.

**Approach:**

- This spec does **not** flip the posture. It produces a **transition plan** at `docs/testing-transition-plan.md`:
  - Inventory: which suites need to exist before flip-day (integration tests for RLS-protected flows, workflow engine smoke tests, the four obese services' critical paths).
  - Sequencing: which gates flip first, which stay gates-only longest.
  - Estimated effort: rough S/M/L per suite.

**Trigger (DECIDED 2026-05-12):** **T-minus-14 calendar days before first live agency client onboarding.** Self-correcting trigger — lands when it needs to, regardless of slippage. A concrete date would have to be guessed today.

This avoids the deferred-debt antipattern (adding a vague "operator to decide trigger" TODO) that the C1 sweep is trying to eliminate.

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
| C1 | `tasks/todo-triage-inventory.md` (new, committed), `tasks/todo.md`, `tasks/todo-archive/2026-Q2.md` (new), zero-to-N ADRs |
| C2 | `docs/knowledge-sweep-inventory.md` (new, committed), `KNOWLEDGE.md`, zero-to-N ADRs |
| C3 | `tasks/current-focus.md` only (paused-build line updated to reflect operator decision). No chunk in this spec. |
| C4 | `_archive/README.md` (new), any in-code reference paths, `.gitignore` if affected |
| D1 | `CLAUDE.md` § Review pipeline, `.claude/agents/feature-coordinator.md`, `.claude/agents/finalisation-coordinator.md` (REVIEW_GAP artifact emission) |
| D2 | `docs/testing-transition-plan.md` (new, with default T-minus-14 trigger embedded) |

`docs/capabilities.md` is **not** touched — this spec adds no customer-visible product capabilities.

## 8. Chunk plan

Ordered. Each chunk is independent at the file-level so a single `builder` invocation can land it cleanly. PR #277 is **not** in this list — it is a pre-plan operator decision (see §5.C3 and §11).

| # | Chunk | WS | Effort |
|---|-------|----|--------|
| 1 | Fix `verify-no-db-in-routes.sh` (gate-only; no route edits yet) | B1 | S |
| 2 | `replit.md` typecheck correction | B2 | S |
| 3 | Move `prototypes/` + `attached_assets/` to `_archive/` (`git mv`); add `_archive/README.md`; sweep in-code refs | C4 | S |
| 4 | `pr-reviewer` severity tiers + "Why:" + "Files NOT read" disclosure | A1 | S |
| 5 | `adversarial-reviewer` STRIDE + trust-boundary section | A3 | S |
| 6 | Minimal-change rules into `CLAUDE.md` §6 + `builder.md` (G1 checklist + verdict notes) | A4 | S |
| 7 | New `reality-checker` agent + wire into `feature-coordinator` pipeline + update `CLAUDE.md` fleet table + `tasks/review-logs/README.md`. **Chunk acceptance:** agent file passes existing frontmatter/schema validation; CLAUDE.md fleet table references the exact filename; `.claude/CHANGELOG.md` records the addition; `validate-setup` passes. | A2 | M |
| 8 | New `incident-commander` agent + `docs/incident-response.md` SEV matrix + post-mortem template + `CLAUDE.md` fleet table. **Chunk acceptance:** agent file passes existing frontmatter/schema validation; CLAUDE.md fleet table references the exact filename; `.claude/CHANGELOG.md` records the addition; `validate-setup` passes. | A5 | M |
| 9 | Reviewer-coverage policy: audit SKIPPED reasons, document chosen posture in `CLAUDE.md`, update `feature-coordinator`/`finalisation-coordinator` enforcement | D1 | M |
| 10 | `docs/testing-transition-plan.md` (with default T-minus-14 trigger embedded) | D2 | M |
| 11 | Route violator triage — each violator migrated to service or documented exception (one builder chunk per violator, or grouped 3-3-3). **Grouping guard (T2):** do not group migrations when any route requires a new service, an auth-model clarification, or an exception ADR — those must be isolated sub-chunks. | B1 | M-L (≈9 sub-chunks) |
| 12 | `KNOWLEDGE.md` sweep — produce inventory, get operator approval, then apply | C2 | M |
| 13 | `tasks/todo.md` triage sprint — produce inventory, get operator approval, then apply | C1 | L |

**Chunk-1 acceptance (F1):**

Chunk 1 is gate-only and must **not** migrate any route. Its acceptance is the *opposite* of final acceptance:

- `scripts/verify-no-db-in-routes.sh` **fails** on current branch state and reports the 9 known violators.
- `workspaceInboundWebhook.ts` remains exempted via the documented `guard-ignore` token in the T1 format.
- No route migrations are performed in Chunk 1.

**Allowed edits in Chunk 1 (narrow carve-out):** `scripts/verify-no-db-in-routes.sh` **and** the existing exemption comment in `server/routes/workspaceInboundWebhook.ts` if its current form does not match the T1 token shape. No other route file may be edited. This preserves the "no route migration in Chunk 1" invariant while preventing a false failure on the one legitimate exception.

A green gate at Chunk 1 against the 9 violators means the gate was weakened or routes were edited prematurely. Both are failures.

**Sequencing notes:**

- Chunks 1-6 are pure file edits, no architectural decisions left open → can land in one session each.
- Chunk 11 (route violators) waits on chunk 1 (gate fix) so each migration can be verified by the now-strict gate.
- **Branch state between Chunk 1 and Chunk 11:** the branch is intentionally CI-red until all 9 routes migrate. Plan-authoring should tightly sequence Chunk 1 with the start of Chunk 11 to minimise this window, or gate the strict matcher behind an env var until Chunk 11 completes. Either approach is acceptable; the plan must pick one.
- Chunks 12 and 13 (`KNOWLEDGE.md` and `todo.md` sweeps) are end-of-build because the WS-A/B work will itself emit follow-ups that should land in the inventory, not the live file.
- Each of Chunks 12 and 13 is **two steps**: produce inventory → operator approval → apply triage.

**Planning posture — branch split (default):**

**Default posture:** split into two branches unless the plan explicitly justifies a single PR.

- **Branch 1 — fleet + process:** chunks 2, 4, 5, 6, 7, 8, 9, 10 (mostly agent files + CLAUDE.md edits; low blast radius).
- **Branch 2 — codebase health:** chunks 1, 3, 11, 12, 13 (gate fix + route migrations + sweeps; higher blast radius, deserves its own review surface).

The spec stays unified; the plan picks the branch shape and records the choice. A single combined PR would mix agent policy, route migrations, todo cleanup, KNOWLEDGE trimming, and archive moves — too broad to review well.

## 9. Acceptance criteria

Acceptance is split into **chunk-level** (per chunk; see §8 chunk-1 acceptance) and **final** (spec-level). Final acceptance:

- **Gate restored:** `scripts/verify-no-db-in-routes.sh` is GREEN on the branch tip with all 9 violators migrated or documented; `workspaceInboundWebhook.ts` exemption preserved; every exception carries the T1 `guard-ignore` token shape.
- **Service-layer invariant satisfied (T2):** for every migrated route, the four-bullet invariant holds (route owns auth/parsing/shaping only; DB access behind a service; explicit scope handling; no `db`/schema/Drizzle imports in the route).
- **Two new agents live:** `.claude/agents/reality-checker.md` and `.claude/agents/incident-commander.md` exist, are referenced in CLAUDE.md fleet table, and `validate-setup` passes.
- **Three existing agents upgraded:** `pr-reviewer`, `adversarial-reviewer`, `builder` carry the new contracts; `feature-coordinator` pipeline updated.
- **CLAUDE.md updates:** §6 carries the three minimal-change rules; § Review pipeline carries the chosen reviewer-coverage posture and the REVIEW_GAP artifact format; fleet table lists the two new agents.
- **Doc cleanup:** `replit.md` corrected; `_archive/` exists with README; `prototypes/` + `attached_assets/` moved (with git history preserved); T7 path-reference grep clean.
- **Debt visible:** `tasks/todo.md` ≤500 lines; `tasks/todo-archive/2026-Q2.md` exists; `KNOWLEDGE.md` ≤2,500 lines; both sweeps applied only after operator approval of their inventory.
- **Transition plan written:** `docs/testing-transition-plan.md` exists with the inventory and the default T-minus-14-days trigger embedded.
- **CI green (F4):** the canonical gate-suite command documented in `CLAUDE.md` / `scripts/run-all-gates.sh` passes on the branch tip. The plan must not hard-code a gate count — it asserts the suite passes, with `verify-no-db-in-routes.sh` specifically asserted post-Chunk 11.

PR #277 is **not** a final-acceptance item — it is resolved as a pre-plan operator decision (see §11).

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Route violator migrations break runtime behaviour | Each migration is its own sub-chunk; G1 (lint+typecheck+build) per sub-chunk; `pr-reviewer` mandatory per CLAUDE.md. |
| `KNOWLEDGE.md` sweep loses context | Sweep adds a dated header `## 2026-05 quarterly trim` recording compressed/promoted entries; full pre-sweep file remains in git history. |
| `tasks/todo.md` triage misclassifies a real item as ARCHIVE | Archive is in-repo (not deleted); reversal is a `git mv` away. |
| Reviewer-policy posture pick is wrong | `CLAUDE.md` change is one section; reversible in a single edit. |
| `reality-checker` adds friction without value on borderline tasks | Skipped on Trivial/Standard; manual override always available; revisit after 5 runs. |
| `incident-commander` never gets used because real incidents are rare pre-launch | Acceptable — agent is cheap to maintain and present-when-needed beats absent-when-needed. |
| Future support-desk redesign loses context from closed PR #277 | Closing comment, `tasks/current-focus.md` closed-build record, and branch retention preserve the decision trail. Any future work starts from a fresh spec, not a resume. |

## 11. Decisions (LOCKED 2026-05-12)

All four pre-plan decisions resolved. Plan-authoring may proceed.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | PR #277 fate (§5 C3) | **Close** | Decay liability; restart fresh if support-desk redesign is needed later. PR closed with explanatory comment; paused-build line removed from `tasks/current-focus.md`. |
| 2 | Reviewer posture (§6 D1) | **GRADED** | Matches reality — `pr-reviewer` always mandatory; heavier reviewers mandatory by class but skippable with a `REVIEW_GAP` entry. STRICT would block on tooling availability; ADVISORY abandons signal. |
| 3 | Archive convention (§5 C4) | **In-repo `_archive/`** | `git mv` preserves history; existing mockup-log references stay valid; 5.5 MB cost negligible. |
| 4 | Testing-transition trigger (§6 D2) | **T-minus-14 days** before first live agency client onboarding | Self-correcting trigger; a concrete date would be a guess today. |
