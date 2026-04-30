# Brief — Doc Sync Process Update + 10-Day Drift Audit

**Status:** Ready to pick up in a new session.
**Authored:** 2026-05-01
**Owner of next session:** Claude main session (Opus for design + audit synthesis; switch to Sonnet for the mechanical doc edits once the gaps are listed).

---

## Table of contents

- [Goal](#goal)
- [Why now](#why-now)
- [Phase 1 — Process update](#phase-1--process-update)
  - [Files to edit](#files-to-edit)
  - [Files to NOT edit](#files-to-not-edit)
  - [The new "Doc Sync" finalisation step](#the-new-doc-sync-finalisation-step)
  - [Final Summary template — new fields](#final-summary-template--new-fields)
  - [Rules section — additions](#rules-section--additions)
  - [feature-coordinator change](#feature-coordinator-change)
  - [Verification](#verification)
  - [PR title and commit](#pr-title-and-commit)
- [Phase 2 — Drift audit (10-day window)](#phase-2--drift-audit-10-day-window)
  - [Window](#window)
  - [Source-of-truth artefacts to walk](#source-of-truth-artefacts-to-walk)
  - [Target docs to diff against](#target-docs-to-diff-against)
  - [Workflow](#workflow)
  - [Scale and time-boxing](#scale-and-time-boxing)
  - [Out of scope for the audit](#out-of-scope-for-the-audit)
  - [PR title and commit (audit)](#pr-title-and-commit-audit)
- [Pre-flight reading](#pre-flight-reading)
- [Classification and pipeline](#classification-and-pipeline)
- [Done criteria](#done-criteria)
- [Notes for the picking-up session](#notes-for-the-picking-up-session)

---

## Goal

Two outcomes, in order:

1. **Process update.** Make every "finalisation" workflow in this repo (`chatgpt-pr-review`, `chatgpt-spec-review`, `feature-coordinator`, and any review pipeline that produces a finalised log) explicitly verify and update the project's reference docs as part of finalisation — not as an after-thought "check whether structural changes should update X." Today only `KNOWLEDGE.md` and (weakly) `architecture.md` are touched. The drift in `capabilities.md`, `integration-reference.md`, and the rule docs is real and accumulating.
2. **Drift audit.** For all work shipped in the last 10 days, diff what landed against the reference docs and produce a single sweep PR fixing the misses.

The two phases ship as **two separate PRs** — process update first, drift sweep second, so the new template is what's in force when the sweep is reviewed.

---

## Why now

Audit of the chatgpt-pr-review and chatgpt-spec-review agent definitions on 2026-05-01 found:

- `KNOWLEDGE.md` — covered.
- `architecture.md` — passive check ("update if yes, skip if no") in PR agent; only triggers on `[missing-doc] > 2` in spec agent.
- `docs/capabilities.md` — soft-check in PR agent; **not mentioned at all** in spec agent.
- `docs/integration-reference.md` — **not mentioned in either agent**, despite its own header saying *"Any PR that changes integration behaviour … updates the matching integration block in the same commit."*
- `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` — only via the `[missing-doc]` escalation path.
- `docs/spec-context.md` — read-only input to spec agent; never written.
- `docs/frontend-design-principles.md` — never referenced.

This violates `CLAUDE.md § 11` (*"Docs Stay In Sync With Code — same session, same commit"*).

---

## Phase 1 — Process update

### Files to edit

1. `.claude/agents/chatgpt-pr-review.md` — add explicit Doc Sync sweep to Finalization, update Final Summary template, update Rules.
2. `.claude/agents/chatgpt-spec-review.md` — same shape, scoped to spec changes.
3. `.claude/agents/feature-coordinator.md` — add a Doc Sync gate before declaring the feature complete (it currently routes to `pr-reviewer` then claims done).
4. `tasks/review-logs/README.md` — document the new Final Summary fields so future log readers know what to look for.

### Files to NOT edit

- `pr-reviewer.md`, `dual-reviewer.md`, `adversarial-reviewer.md` — read-only / advisory; they don't write logs that gate merging.
- `spec-conformance.md` — its job is conformance to a single spec, not cross-doc sync. Leave alone.
- `spec-reviewer.md` — same. Spec agent variant is the right place to enforce sync of the spec to architecture/capabilities.
- `architect.md` — could optionally surface "this plan should update doc X" as planning output. Out of scope for this brief — log as a follow-up if you spot the pattern.

### The new "Doc Sync" finalisation step

Insert into chatgpt-pr-review.md Finalization section (currently between steps 6 and 7) and chatgpt-spec-review.md Finalization section (currently between steps 4 and 5). Concrete shape:

```
N. Doc sync sweep — for each reference doc below, diff against the change-set
   shipped this session and update IN THE SAME finalisation commit if its
   scope is touched. Failure to update a relevant doc is a blocker — escalate
   to the user, do not auto-defer.

   Reference docs:
   a. architecture.md — service boundaries, route conventions, three-tier
      agent model, orchestrator routing, task system, RLS / schema invariants,
      run-continuity, agent fleet, key-files-per-domain, audit framework.
   b. docs/capabilities.md — any add/remove/rename of a product capability,
      agency capability, skill, or integration. Editorial Rules apply
      (vendor-neutral, marketing-ready, model-agnostic — see § Editorial Rules
      in that doc). External-ready prose; no engineer-facing primitives.
   c. docs/integration-reference.md — any change to integration behaviour:
      new scope, new skill, changed status, new write capability, new OAuth
      provider, new MCP preset, new capability slug, new alias. Update
      last_verified.
   d. CLAUDE.md / DEVELOPMENT_GUIDELINES.md — any change touching build
      discipline, conventions, agent fleet, review pipeline, locked rules
      (RLS, service-tier, gates, migrations, §8 development discipline).
      Triggered also by [missing-doc] > 2 (existing rule).
   e. docs/spec-context.md — spec-review agent only; any framing-assumption
      change.
   f. docs/frontend-design-principles.md — any new UI pattern, hard rule, or
      worked example introduced this session.
   g. KNOWLEDGE.md — patterns and corrections (already covered by step 3 in
      PR agent / step 4 in spec agent — keep that step, this is a
      cross-reference for completeness).

   For each, log one of: yes (sections X, Y) | no (scope touched but already
   accurate) | n/a (scope not touched). "no" requires the rationale line.
```

### Final Summary template — new fields

Append to the Final Summary block in both agents (and update `tasks/review-logs/README.md`):

```
- KNOWLEDGE.md updated: yes (N entries) | no
- architecture.md updated: yes (sections X, Y) | no | n/a
- capabilities.md updated: yes (sections X) | no | n/a
- integration-reference.md updated: yes (slug X) | no | n/a
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes | no | n/a
- spec-context.md updated: yes | no | n/a              # spec-review only
- frontend-design-principles.md updated: yes | no | n/a
```

`n/a` = scope of the doc was not touched.
`no` = scope was touched but the doc is already accurate. Include a one-line rationale.
`yes` = doc was edited; cite the section.

### Rules section — additions

Append a new bullet to both agents' Rules section:

> - **Doc sync is mandatory at finalisation.** Every reference doc listed in the
>   Doc sync sweep step must have a yes / no / n/a verdict in the Final Summary.
>   A missing field blocks finalisation; a `no` verdict requires a one-line
>   rationale. Stale docs are a blocking issue per `CLAUDE.md § 11`.

### feature-coordinator change

Add a final "Doc Sync gate" at the end of the pipeline — invoke the same Doc Sync sweep against the cumulative change-set across all chunks before declaring the feature complete. Reference the chatgpt-pr-review template by file path so the logic isn't duplicated.

### Verification

- `npm run lint` and `npx tsc --noEmit` (per `CLAUDE.md` test gates rule — never run gate suites).
- Manual: re-read each edited agent definition end-to-end — the new step must slot in cleanly with existing numbering, no orphan references, no dangling "step 7" pointers when steps shifted.

### PR title and commit

```
docs(review-agents): add doc-sync sweep to chatgpt review + feature-coordinator finalisation
```

Body: cite the gap (capabilities.md / integration-reference.md not in either agent's Final Summary), the new sweep step, and the new Final Summary fields.

---

## Phase 2 — Drift audit (10-day window)

### Window

`2026-04-21` through `2026-05-01` inclusive. Use `git log --since="2026-04-21" main` to enumerate.

### Source-of-truth artefacts to walk

For each, identify what shipped and what doc-impact it should have had. Sources:

1. **Specs** — every file matching `docs/**/*-spec.md`, `docs/**/*-dev-spec.md`, `docs/**/*-brief.md` with mtime in window OR referenced by a build slug in `tasks/builds/*/plan.md` updated in window. Specs describe intended behaviour; their delivery should land in `architecture.md` (technical) and `capabilities.md` (product surface).
2. **Build plans** — every `tasks/builds/<slug>/plan.md` and `tasks/builds/<slug>/progress.md` with mtime in window. Build plans are the canonical record of what each chunk delivered. Cross-reference progress.md "completed" entries against `architecture.md` patterns.
3. **Spec-conformance logs** — `tasks/review-logs/spec-conformance-log-*.md` in window. The "Implementation diff vs spec" sections list files that were touched; use those file lists as the change-set per build.
4. **PR-reviewer logs** — `tasks/review-logs/pr-review-log-*.md` and `pr-reviewer-log-*.md` in window. Surface notes on what shipped per PR.
5. **Dual-reviewer logs** — `tasks/review-logs/dual-review-log-*.md` in window. Same purpose.
6. **ChatGPT PR review logs** — `tasks/review-logs/chatgpt-pr-review-*.md` in window. The Final Summary blocks already record `architecture.md updated: yes/no` — start here for the easiest wins (`no` entries are confessions of un-synced docs).
7. **ChatGPT spec review logs** — `tasks/review-logs/chatgpt-spec-review-*.md` in window. Spec-side counterpart.

### Target docs to diff against

For every change-set surfaced from the artefacts above, diff against:

- `architecture.md`
- `docs/capabilities.md`
- `docs/integration-reference.md`
- `CLAUDE.md`
- `DEVELOPMENT_GUIDELINES.md`
- `KNOWLEDGE.md`
- `docs/spec-context.md` (only when the change-set source is a spec review)
- `docs/frontend-design-principles.md` (only when the change-set introduced a UI pattern)

### Workflow

1. **Inventory pass.** Walk the seven artefact sources above. Produce a table:

   | Build / PR | Window date | Spec(s) | Files touched (top 5) | Doc sections this should have updated |
   |---|---|---|---|---|

   Save the table to `tasks/builds/doc-sync-audit/inventory.md` (create the build slug directory).

2. **Diff pass.** For each row, open each target doc and confirm whether the section is current. Mark each cell as `current` | `drifted` | `missing`.

3. **Triage pass.** For every `drifted` or `missing` cell:
   - Decide `fix-now` (mechanical, scope-clear) or `escalate` (directional / needs user call).
   - Auto-apply `fix-now`. Route `escalate` items to `tasks/todo.md` under `## Doc drift backlog (audit 2026-05-01)`.

4. **Drift report.** Save to `tasks/builds/doc-sync-audit/drift-report.md` with three sections:
   - **Fixed in this PR** — list of doc sections updated, with the source change-set that drove each.
   - **Escalated to user** — items that need a directional call, with the rationale.
   - **Verified current** — short list of areas walked but already in-sync (so the next audit knows they were checked).

5. **Edits.** Apply the `fix-now` updates across the target docs. One commit per target doc keeps the diff readable.

### Scale and time-boxing

Expected scale: **20–40 build/PR rows**, **~10–25 actual doc-section updates**. Most rows will be `current` for `architecture.md` and `n/a` for `integration-reference.md`. The bulk of drift is likely in `capabilities.md` (product surface evolved faster than the registry) and small `architecture.md` corners (new patterns introduced without being added to the index).

If the audit balloons past 60 rows or 50 doc sections: stop, write what's been found to `tasks/builds/doc-sync-audit/progress.md`, escalate scope to the user.

### Out of scope for the audit

- Refactoring docs (formatting, voice, structure). Surface drift only.
- Backfilling work that pre-dates the 10-day window.
- Editing finalised review logs.
- Generating new docs that don't yet exist (e.g. a new "agent fleet runbook"). If something obviously missing surfaces, file as `[user]` defer in `tasks/todo.md` under "Doc drift backlog".
- Touching `references/project-map.md` and `references/import-graph/*.json` — these are auto-generated by the watcher.

### PR title and commit (audit)

```
docs: drift audit 2026-04-21..2026-05-01 — sync architecture, capabilities, integration-reference
```

Body: link to `drift-report.md`, list each updated doc with the source change-set that drove the update, link to `tasks/todo.md` § *Doc drift backlog* for escalated items.

---

## Pre-flight reading

Before starting, read in this order:

1. `CLAUDE.md` — § 11 (docs stay in sync with code), § 13 (doc style), Local Dev Agent Fleet table, Review pipeline mandatory order.
2. `architecture.md` — full doc, but only the heading list is required to know what's in scope. Use it as the "shape" of what to diff against.
3. `docs/capabilities.md` — § Editorial Rules and Table of Contents. The Editorial Rules are non-negotiable for any update to that doc.
4. `docs/integration-reference.md` — header / maintenance rules. Schema is YAML inside fenced blocks; respect the existing structure.
5. `tasks/review-logs/README.md` — caller contracts; relevant to the Final Summary template change.
6. `.claude/agents/chatgpt-pr-review.md` and `.claude/agents/chatgpt-spec-review.md` — current finalisation flows. The Phase 1 edits slot into these.

---

## Classification and pipeline

- Phase 1 (process update): **Standard**. 4 files, mechanical, no new patterns. Run `pr-reviewer` after.
- Phase 2 (drift audit): **Significant**. Multi-doc, judgement calls on `current` vs `drifted`, scope is broad. Run `pr-reviewer` after; `dual-reviewer` is optional and only if the user explicitly asks. `adversarial-reviewer` is not relevant — pure docs.

No spec exists for either phase, so `spec-conformance` is `n/a` (the agent will report "no spec detected" and return).

Auto-commit/push: not allowed for the main session. The user reviews and commits.

---

## Done criteria

Phase 1:
- Both ChatGPT review agent files have the new Doc Sync sweep step at the right position in their Finalization section.
- Both Final Summary templates list the seven (PR) / six (spec) reference doc fields.
- Both Rules sections have the new bullet.
- `feature-coordinator.md` references the sweep before declaring the pipeline complete.
- `tasks/review-logs/README.md` documents the new fields.
- `pr-reviewer` clean.
- PR open.

Phase 2:
- `tasks/builds/doc-sync-audit/inventory.md` exists and lists every in-window build/PR.
- `tasks/builds/doc-sync-audit/drift-report.md` exists with all three sections populated.
- `tasks/todo.md` has the `## Doc drift backlog (audit 2026-05-01)` section with any escalations.
- All `fix-now` edits applied across target docs, one commit per doc.
- `pr-reviewer` clean.
- PR open.

---

## Notes for the picking-up session

- This brief is the brainstorm output. **Do not re-brainstorm.** Proceed to execution.
- Phase 1 is mostly mechanical — Sonnet handles it. Phase 2 inventory + diff requires Opus-tier judgement; switch back to Sonnet for the actual edits.
- If the user is in the session: confirm scope (10-day window, two PRs, target doc set) once before starting Phase 2. The window and target list are the easy levers to expand or contract.
- Editorial Rules in `docs/capabilities.md` are the only place where rejecting a "fix-now" mechanical edit is the right call — if a fix would violate Editorial Rules, escalate it instead.
- If `git log --since` returns no in-window commits, the audit is a no-op — write a one-line drift-report saying so and close the PR.
