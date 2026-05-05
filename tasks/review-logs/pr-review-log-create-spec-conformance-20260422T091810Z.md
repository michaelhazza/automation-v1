# PR Review Log — create-spec-conformance branch (round 2)

**Files reviewed:**
- `C:\Files\Projects\automation-v1-2nd\.claude\agents\spec-conformance.md` (new, 346 lines)
- `C:\Files\Projects\automation-v1-2nd\.claude\agents\feature-coordinator.md` (+11 lines integrating C1b step)
- `C:\Files\Projects\automation-v1-2nd\.claude\agents\pr-reviewer.md` (model-switch only)
- `C:\Files\Projects\automation-v1-2nd\.claude\agents\chatgpt-pr-review.md` (model-switch only)
- `C:\Files\Projects\automation-v1-2nd\.claude\agents\chatgpt-spec-review.md` (model-switch only)
- `C:\Files\Projects\automation-v1-2nd\.claude\agents\dual-reviewer.md` (model-switch only)
- `C:\Files\Projects\automation-v1-2nd\CLAUDE.md` (+25 lines — spec-conformance fleet-integration)
- `C:\Files\Projects\automation-v1-2nd\KNOWLEDGE.md` (+16 lines — CRM-planner entries, unrelated)
- `C:\Files\Projects\automation-v1-2nd\tasks\todo.md` (+9 lines — unrelated review-backlog entry)

**Timestamp:** 2026-04-22T12:00:00Z

**Scope:** Agent-fleet infrastructure review — verify the spec-conformance agent's classification logic, auto-detection, and integration with feature-coordinator and CLAUDE.md. Cross-check coherence against the earlier round-1 review log and hunt for new gaps.

**Baseline note:** A prior `pr-reviewer` run produced `tasks\review-logs\pr-review-log-create-spec-conformance-2026-04-22T07-08-30Z.md`. The round-1 findings (B1 filename contract, B2 scope fall-through, S1–S5 rule gaps, N1–N7 polish) have all been addressed in the current agent file — I re-verified each against the live source. The items below are genuinely new or previously missed.

---

## Blocking Issues

**No blocking issues found.**

The two round-1 blockers (filename contract, silent full-spec verification of partial work) are resolved in the current file:
- Agent description at `spec-conformance.md:3`, Final Output at `:265-269`, todo routing at `:243`, and CLAUDE.md `:341` now all use `spec-conformance-log-<slug>[-<chunk-slug>]-<timestamp>.md` consistently.
- Step C (`:100-108`) now hard-stops when scope is unclear, with an explicit instruction *"do not fall through to 'verify the entire spec' silently"* and a pointer to the fleet's "when in doubt, stop" posture.

---

## Strong Recommendations

### S1 — Chunk-scope fallback at `spec-conformance.md:104` can silently drop missing-file MECHANICAL gaps (novel finding)

Step C says:
> "When the caller names a plan chunk, read the plan at `tasks/builds/<slug>/plan.md` to identify which spec sections that chunk maps to, and scope Step 1's extraction to those sections. If the plan does not make the mapping explicit, verify only the spec items that correspond to files in the changed-code set."

Failure mode: caller invokes with chunk name, the plan is silent on which spec sections the chunk covers (common — architect-generated plans often use chunk names derived loosely from the spec), so the agent falls back to "verify only the spec items that correspond to files in the changed-code set." A spec-named-but-not-yet-created file (exactly the class of item MECHANICAL_GAP is supposed to catch) is NOT in the changed-code set, so it gets silently excluded from the checklist. The agent reports CONFORMANT for a chunk that is in fact missing a spec-named file.

This directly undermines the agent's primary purpose — catching "development session silently missed a spec item." The agent is strongest precisely at the missing-file case, and the fallback blinds it there.

**Suggested test (Given/When/Then) for the main session to implement before declaring this agent production-ready:**

- **Given** a plan chunk "Chunk 2 — DB schema" where the plan names only one spec section ("Phase 1 §3 Schema") but the spec's Phase 1 §3 also requires a new service file `server/services/fooQueryPlanner.ts`, and the developer only created the migration (not the service file)
- **When** `spec-conformance` runs scoped to Chunk 2, falls back to "items corresponding to files in the changed-code set" because the plan-to-spec mapping is not explicit on the service file
- **Then** the agent MUST still flag the missing service file as a MECHANICAL_GAP and either auto-scaffold it (spec names the path + export) or route it to `tasks/todo.md`. It MUST NOT silently classify the chunk as CONFORMANT because the missing file wasn't in the changed-code set.

Proposed fix in `spec-conformance.md:100-108`: split the fallback into two rules. First: *"For spec sections the plan maps to this chunk, extract all concrete requirements (including new-file requirements whose files aren't in the changed-code set yet)."* Second: *"If the plan-to-spec mapping is ambiguous, stop and ask the caller which spec sections this chunk covers — do not silently narrow scope to only touched files."* The first rule is the correct posture; the current fallback is a shortcut that defeats the point.

### S2 — No processing guidance for spec-conformance DIRECTIONAL_GAP items once they land in `tasks/todo.md`

`CLAUDE.md:340` spells out a three-step processing order for `pr-reviewer` blocking findings (non-architectural implement in-session, architectural route to backlog, Strong Recommendations implement-if-in-scope). There's no parallel paragraph for `spec-conformance` output. The main session picks up a NON_CONFORMANT verdict from `spec-conformance`, sees a new section in `tasks/todo.md`, and has no documented policy on "implement now vs defer." In the `feature-coordinator` C1b flow, the coordinator asks the main session to resolve directional gaps before re-running — but for the manual / standalone flow (no coordinator), the user is on their own.

**Proposed fix:** Add one sentence under `CLAUDE.md:341` (the spec-conformance self-writes bullet): *"If the Next-step verdict is `NON_CONFORMANT`, process the deferred items the same way you would process `pr-reviewer` blocking findings — non-architectural in-session, architectural to the `## PR Review deferred items` backlog section — before re-invoking `spec-conformance`."*

### S3 — Chunk-slug derivation is defined for pr-review-log but not for spec-conformance-log

`feature-coordinator.md:113` explicitly defines `<chunk-slug>` as "a kebab-case version of the chunk name" for the `pr-review-log-<slug>-<chunk-slug>-<timestamp>.md` filename. The same coordinator at `:103` references `spec-conformance-log-<slug>-<chunk-slug>-<timestamp>.md` without that definition, and `spec-conformance.md:269` refers to the caller passing a chunk-slug without specifying its shape. A reasonable reader will assume the same kebab-case convention, but if an implementer uses raw chunk names ("Chunk 2 — DB schema") without normalisation, two concurrent coordinator runs will generate colliding filenames on case/spacing, and the log path recorded in `progress.md` will not match the file on disk.

**Proposed fix:** Add one sentence to `feature-coordinator.md:103`: *"where `<chunk-slug>` is a kebab-case version of the chunk name (same convention as C2's pr-review-log)."* No change needed to `spec-conformance.md` — it's the caller's responsibility per the agent spec.

### S4 — Stale cross-reference at `spec-conformance.md:108`

Line 108 says:
> "Matches the fleet's 'when in doubt, stop' posture (see `spec-reviewer.md` Step A item 5 for the spec-detection precedent)."

But `spec-reviewer.md`'s `### Step A` is titled "Load the spec-context file" (`spec-reviewer.md:68`) — it's about spec-context, not spec-detection. The "stop and ask" precedent the author intended to cite is the numbered list in the Setup section item 3 or similar. The cross-reference will send future readers to the wrong section.

**Proposed fix:** Either drop the parenthetical cite ("matches the fleet's 'when in doubt, stop' posture" stands on its own) or cite `CLAUDE.md:341` or `pr-reviewer.md`'s explicit-scope rule instead. Non-blocking but the cite is misleading and will cause confusion during a future edit pass.

---

## Non-Blocking Improvements

### N1 — Summary paragraph at `CLAUDE.md:321` understates the re-run requirement

`CLAUDE.md:317` correctly says "If `spec-conformance` applied any mechanical fixes, re-run `pr-reviewer` on the expanded changed-code set." Good. But the summary bullet at `:321` ("For spec-driven work, that means: `spec-conformance` → `pr-reviewer` → (optionally `dual-reviewer`) → PR") reads as if pr-reviewer always runs exactly once after spec-conformance — the fact that it may need to re-run on the expanded changed-code set is suppressed. Suggest expanding `:321` to: *"...`spec-conformance` → `pr-reviewer` (re-run after any mechanical fixes) → (optionally `dual-reviewer`) → PR."*

### N2 — KNOWLEDGE.md has no entry capturing why the spec-conformance agent was added

The branch introduces a fundamentally new fleet member with a novel "mixed mode" (auto-fix mechanical, route directional) and a specific fail-closed classification posture. Neither the rationale nor the pattern ("review agents that both fix and route") is in `KNOWLEDGE.md`. Future sessions writing similar agents will re-derive the same design. Suggest an append entry under "Decision" or "Pattern" summarising: agent was added because the main dev session silently misses spec items; mixed-mode (auto-fix + route) chosen to close mechanical gaps without extending scope; fail-closed classification ("100% sure it's mechanical?") prevents scope creep into design choices. This is a one-paragraph entry, append-only per the KNOWLEDGE.md convention.

### N3 — No concurrency safeguard when parallel sessions append to `tasks/todo.md`

`CLAUDE.md §12` documents a "session isolation for concurrent work" convention (parallel sessions write to their own `tasks/builds/<slug>/progress.md`). But `tasks/todo.md` is a single shared file, and every review agent (pr-reviewer, spec-conformance, spec-reviewer, chatgpt-pr-review, chatgpt-spec-review) appends to it. Two agents firing simultaneously will race on the write. Unlikely in practice given the human-in-the-loop invocation model, but worth one sentence somewhere acknowledging "don't run two review agents concurrently against the same repo." Non-blocking because the practical risk is low.

### N4 — `AMBIGUOUS` reporting is distinct from `DIRECTIONAL_GAP` in the log summary but routed identically

Log summary at `spec-conformance.md:289-291` counts `DIRECTIONAL_GAP → deferred` and `AMBIGUOUS → deferred` as two separate lines, but both route to the same `tasks/todo.md` section and are treated identically for verdict purposes. The two-line count is informational only (reader can see how many "I wasn't sure" items vs how many "I'm sure this needs human judgement" items existed). Minor — consistent presentation, but some readers will wonder why two buckets exist for the same routing. Consider a one-line clarifier under Summary: *"AMBIGUOUS is reported separately for diagnostic visibility; it is routed and counted toward blocking the same way as DIRECTIONAL_GAP."*

### N5 — Scratch-file orphan on mid-run failure

`spec-conformance.md:331` says to clean up the scratch file after the final log is written. If the agent errors mid-Step-4 (e.g. a mechanical-fix Edit fails and the agent aborts), the scratch file is left on disk. Minor housekeeping; add a rule to Rules (`:333+`): *"If the run aborts before Final output, do not clean up the scratch file — it's the only record of progress for a post-mortem."*

### N6 — Model-switch-only edits to the four other agent files are clean

Verified `chatgpt-pr-review.md`, `chatgpt-spec-review.md`, `dual-reviewer.md`, and `pr-reviewer.md` — all four front-matters now show `model: opus`. Other frontmatter fields (name, description, tools) are unchanged and match the prior content. No drive-by edits. Clean.

### N7 — `CLAUDE.md:275` and `:276` Task Classification table lists spec-conformance for Standard/Significant/Major but not Trivial — correct

Verified: Trivial tasks skip spec-conformance by design (`CLAUDE.md:319` "Not applicable to Trivial fixes or ad-hoc changes without a spec"). The Task Classification table is consistent with this. Non-blocking sanity check.

---

## Verdict

**Approve with Strong Recommendations.** No blocking issues. The round-1 blockers are resolved, and the agent design now has fail-closed classification, mandatory scoping, explicit filename convention, and correct precedent pointers. S1 (chunk-scope fallback blinds the agent to missing-file gaps) is the only substantive remaining risk — it's routed as a Strong Recommendation because the agent still works correctly when the plan-to-spec mapping IS explicit, and `feature-coordinator` is the primary caller path where this mapping should be present. S2–S4 are doc-level precision improvements. Non-blocking items are polish.
