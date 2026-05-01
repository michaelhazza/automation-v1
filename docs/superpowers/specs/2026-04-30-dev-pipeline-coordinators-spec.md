# Dev Pipeline Coordinators — Three-Phase Automated Development Flow

**Status:** DRAFT
**Date:** 2026-04-30
**Author:** michael (with Claude Opus 4.7)
**Scope class:** Major — restructures the local dev agent fleet, adds three new sub-agents, rewrites two existing coordinator/reviewer agents, and changes the canonical end-to-end developer workflow.
**Source branch:** `claude/audit-dev-agents-Op4XW`

---

## Table of contents

- [Goals](#goals)
- [Non-goals](#non-goals)
- [Framing assumptions](#framing-assumptions)
- [Glossary](#glossary)
- [Pipeline at a glance](#pipeline-at-a-glance)
- [§1 spec-coordinator (Phase 1: SPEC)](#1-spec-coordinator-phase-1-spec)
- [§2 feature-coordinator — rewritten (Phase 2: BUILD)](#2-feature-coordinator--rewritten-phase-2-build)
- [§3 finalisation-coordinator (Phase 3: FINALISATION)](#3-finalisation-coordinator-phase-3-finalisation)
- [§4 New sub-agents](#4-new-sub-agents)
- [§5 Existing-agent updates](#5-existing-agent-updates)
- [§6 Cross-cutting concerns](#6-cross-cutting-concerns)
- [§7 Static-check gate policy (G1–G5)](#7-static-check-gate-policy-g1g5)
- [§8 Branch-sync policy (S0–S2)](#8-branch-sync-policy-s0s2)
- [§9 Housekeeping — mockups vs prototypes consolidation](#9-housekeeping--mockups-vs-prototypes-consolidation)
- [§10 File inventory, acceptance criteria, rollout](#10-file-inventory-acceptance-criteria-rollout)
- [Deferred items](#deferred-items)
- [Open questions](#open-questions)

---

## Goals

1. **Automate the end-to-end developer flow** to three manual launches: `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`. Everything between launches runs without operator input except for ChatGPT-web review rounds (where the operator pastes responses) and explicit gates (mockup approval, plan-gate, conflict resolution).
2. **Eliminate manual model switching.** The operator stays on Opus across all three coordinators; chunk implementation runs on Sonnet via a new `builder` sub-agent whose frontmatter pins the model.
3. **Make every checkpoint the operator already runs explicit and auditable** — `spec-reviewer`, `chatgpt-spec-review`, `architect`, `chatgpt-plan-review` (new), `spec-conformance`, `adversarial-reviewer`, `pr-reviewer`, `dual-reviewer`, `chatgpt-pr-review`, doc-sync gate. No silent pipeline steps.
4. **Move `pr-reviewer`, `adversarial-reviewer`, and `spec-conformance` from per-chunk to branch-level review.** Per-chunk review wastes work when later chunks invalidate earlier ones; branch-level review sees the integrated state.
5. **Place static-check (lint/typecheck) and branch-sync gates at deterministic points** — five static-check gates (G1–G5), three branch-sync gates (S0–S2). Each is named, placed, and capped.
6. **Guarantee autonomous runs never wedge on merge conflicts.** All branch-sync gates sit at coordinator entries (operator-present moments) — never mid-run.
7. **Produce hi-fi clickable prototypes for any UI-touching brief**, gated on operator approval, before the spec is authored. The mockup loop is open-ended and operator-driven.
8. **Keep the existing `feature-coordinator.md` usable until the rewrite ships.** Rollout is sequenced so no in-flight feature gets stranded.

## Non-goals

- **Not building a CI replacement.** CI continues to run the full lint / typecheck / test-gate suite as the pre-merge backstop (G5). Local gates G1–G4 are about catching issues earlier, not about making CI redundant. The existing CLAUDE.md rule "test gates are CI-only — never run locally" stands; this spec does not override it.
- **Not fully eliminating ChatGPT-web rounds.** The operator has stated explicit preference for ChatGPT-web over the OpenAI API for richer feedback. `chatgpt-spec-review`, `chatgpt-plan-review`, and `chatgpt-pr-review` therefore auto-fire in MANUAL mode — the operator must be present for each round.
- **Not auto-launching one coordinator from another.** The operator opens a fresh Claude Code session for each phase. The previous phase writes a handoff to disk; the next phase reads it.
- **Not changing the existing `architect`, `spec-reviewer`, `spec-conformance`, `pr-reviewer` agent contracts.** They remain as-is; only their invocation point changes.
- **Not introducing feature-flagged rollout.** Per `docs/spec-context.md` (`feature_flags: only_for_behaviour_modes`), this is a commit-and-revert pipeline change. The lint/typecheck baseline dependency (§7.6, §10.3) was satisfied by PR #246 — there are no remaining hard sequencing constraints.
- **Not introducing automated mid-build branch sync.** Operator-triggered manual sync remains an escape hatch (§8) but is never default.
- **Not adding a `plan-reviewer` (Codex-on-plan) agent.** Specs already get Codex review via `spec-reviewer`; running Codex on the derived plan is high overlap. Deferred (see Deferred items).

## Framing assumptions

This spec inherits all framing statements from `docs/spec-context.md` as of 2026-04-16 (`pre_production: yes`, `live_users: no`, `stage: rapid_evolution`, `testing_posture: static_gates_primary`, `rollout_model: commit_and_revert`, `feature_flags: only_for_behaviour_modes`). Specifically:

- **No feature flags** for the coordinator rewrite. The new agents land, the old `feature-coordinator.md` content is replaced in one commit. If the rewrite is bad, revert the commit.
- **No staged rollout** of the pipeline. It works for everyone or it gets rolled back.
- **Static gates over runtime tests.** Acceptance criteria are deterministic checks (file existence, frontmatter fields, command outputs), not runtime test suites.
- **Prefer existing primitives.** This spec extends `feature-coordinator`, `adversarial-reviewer`, `dual-reviewer`, `spec-conformance`, and reuses `architect`, `spec-reviewer`, `pr-reviewer`, `chatgpt-spec-review`, `chatgpt-pr-review`, `triage-agent`, `audit-runner` unchanged. New agents (`builder`, `mockup-designer`, `chatgpt-plan-review`, `spec-coordinator`, `finalisation-coordinator`) are introduced only where no existing primitive fits.
- **Doc-sync is non-negotiable.** Every coordinator that finalises work runs the doc-sync sweep against `docs/doc-sync.md`. A missing verdict blocks finalisation per `CLAUDE.md § 11`.

## Glossary

| Term | Definition |
|---|---|
| **Coordinator** | An orchestrator agent invoked manually by the operator at a phase boundary. Three exist: `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`. Each runs in its own Claude Code session. |
| **Sub-agent** | An agent invoked by a coordinator (or by another sub-agent) via the `Agent` tool. Inherits the `model:` frontmatter of its own definition, not the parent's. |
| **Phase** | The block of work owned by a single coordinator. Phase 1 = SPEC, Phase 2 = BUILD, Phase 3 = FINALISATION. Status enum in `tasks/current-focus.md` tracks which phase is active. |
| **Gate (G1–G5)** | A static-check (lint + typecheck) pass. Five gates positioned across the pipeline. See §7. |
| **Sync (S0–S2)** | A branch-sync attempt (`git fetch && git merge origin/main`). Three sync points, each at a coordinator entry. See §8. |
| **Chunk** | A single implementation unit produced by `architect` and consumed by `builder`. A feature decomposes into N chunks, each builder-session-sized. |
| **Branch-level review pass** | The block inside `feature-coordinator` that runs `spec-conformance` → `adversarial-reviewer` (conditional) → `pr-reviewer` → fix-loop → `dual-reviewer` against the integrated branch state, AFTER all chunks are built. Replaces the per-chunk reviewer block in the previous `feature-coordinator.md`. |
| **Handoff** | A file written by the closing coordinator and read by the opening coordinator of the next phase. Two files: `tasks/current-focus.md` (global pointer with status enum) and `tasks/builds/{slug}/handoff.md` (per-build context). See §6.1. |
| **Build slug** | A kebab-case identifier for the feature. Set by `spec-coordinator`, used by all subsequent coordinators as the directory under `tasks/builds/{slug}/`. |
| **Status enum** | The `status:` field in `tasks/current-focus.md`. Values: `PLANNING | BUILDING | REVIEWING | MERGE_READY | MERGED | NONE`. Each coordinator transitions the enum at entry and exit. |

## Pipeline at a glance

```
Phase 1: SPEC                                                       ← spec-coordinator (opus)
  brief → [UI-detect → mockup-designer loop] → spec authoring
        → spec-reviewer → chatgpt-spec-review (manual) → handoff
                                                                    [operator opens new session]
Phase 2: BUILD                                                      ← feature-coordinator (opus, rewritten)
  context-restore → architect → chatgpt-plan-review (manual)
        → plan-gate → per-chunk: builder (sonnet) + G1
        → G2 → branch-level review pass:
            spec-conformance → adversarial-reviewer (conditional)
            → pr-reviewer → fix-loop (G3) → dual-reviewer (G3)
        → doc-sync gate → handoff
                                                                    [operator opens new session]
Phase 3: FINALISATION                                               ← finalisation-coordinator (opus)
  context-restore → S2 sync + G4 → chatgpt-pr-review (manual, G3)
        → full doc-sync sweep → KNOWLEDGE.md → todo.md cleanup
        → current-focus.md → MERGE_READY → ready-to-merge label
                                                                    CI runs G5 → merge
```

Three operator launches. Three branch-sync gates at the launch boundaries. Five static-check gates threaded through. Every other step runs without operator input except for the ChatGPT-web rounds and explicit approval gates (mockup approval, plan-gate, conflict resolution when sync fails).

---

## §1 spec-coordinator (Phase 1: SPEC)

### §1.1 Invocation

```
spec-coordinator: <brief or rough spec topic>
```

Operator launches this agent when starting a new feature. The agent runs in the operator's current Claude Code session (typically VS Code on Opus). Phase 1 ends when the spec is reviewed and the operator opens a new session for Phase 2.

### §1.2 Frontmatter

```yaml
name: spec-coordinator
description: Phase 1 orchestrator. Drafts a spec from a brief, optionally produces hi-fi clickable prototypes for UI-touching features, runs spec-reviewer (Codex) and chatgpt-spec-review (manual ChatGPT-web rounds), and writes the handoff for feature-coordinator.
tools: Read, Glob, Grep, Bash, Edit, Write, Agent, TodoWrite
model: opus
```

### §1.3 Context loading (Step 0)

Before any work, read in order:

1. `CLAUDE.md` — task management workflow, agent fleet rules, doc-sync rule
2. `architecture.md` — patterns and conventions the spec must align with
3. `docs/spec-context.md` — framing ground truth (pre-production, rapid evolution, etc.)
4. `docs/spec-authoring-checklist.md` — pre-authoring rubric the spec must satisfy
5. `docs/frontend-design-principles.md` — read IF the brief mentions UI / page / screen / surface (for the UI-detect step)
6. `tasks/current-focus.md` — check status:
   - If `NONE` or `MERGED`: write an initial mission-control block with `status: PLANNING` and `build_slug: none` (placeholder; actual slug is derived in §1.7 and written back then). This acquires the concurrency lock before any other work begins.
   - If `PLANNING`:
     - Read `build_slug` from the existing mission-control block.
     - If `build_slug` is set and `tasks/builds/{build_slug}/handoff.md` exists with `phase_status: PHASE_1_PAUSED`: enter **resume mode** — skip Brief intake (§1.6) and jump to the paused step. The PLANNING status and build_slug are already set; do not overwrite.
     - Otherwise (PLANNING with no matching paused handoff, or build_slug: none from a crashed run, or a different slug already in PLANNING): refuse with a message naming the current PLANNING slug (if any) and instruct the operator to either: (a) abort the stuck session manually (`git stash` + reset `tasks/current-focus.md` to `NONE`) and restart, or (b) re-launch the other feature's coordinator to close it first.
   - If `BUILDING`, `REVIEWING`, or `MERGE_READY`: refuse and tell the operator the current status. Do not proceed.

After §1.7 derives the actual slug, write it back to current-focus.md: update `build_slug: none` → `build_slug: {slug}` so the concurrency lock is complete.

7. `tasks/todo.md` — scan for deferred items the brief may close
8. `tasks/lessons.md` — past lessons applicable to this domain

The PLANNING status write (item 6) must happen before the TodoWrite list is emitted — it is the concurrency gate. Resume mode skips the overwrite since PLANNING + slug are already set.

### §1.4 Step 1 — Top-level TodoWrite list

Emit a TodoWrite list with one item per phase step. Update items in real time. The list is the operator's visible progress indicator and must include:

1. Context loading + set current-focus.md → PLANNING (this step, done in §1.3)
2. Branch-sync **S0** + freshness check (see §8)
3. Brief intake + UI-touch detection
4. Build slug derivation + `tasks/builds/{slug}/` directory creation
5. Mockup loop (conditional on UI-detect)
6. Spec authoring
7. `spec-reviewer` invocation
8. `chatgpt-spec-review` (MANUAL mode) invocation
9. Handoff write (`tasks/builds/{slug}/handoff.md`)
10. `tasks/current-focus.md` update → status `BUILDING`
11. End-of-phase prompt to operator

Sub-steps may be added once context loaded (e.g. one item per mockup round). Item 5 (mockup loop) may expand into many sub-items.

### §1.5 Step 2 — Branch-sync S0 + freshness check

Per §8. Run before any other work so the brief is read against current `main`. Pause-and-prompt on conflicts; freshness check is informational unless 30+ commits behind, in which case refuse to start without `force=true` override.

**Early-exit rule:** if the 30+ commits-behind check triggers and the operator does NOT provide `force=true`, reset `tasks/current-focus.md` to `NONE` (release the PLANNING lock) before exiting. Print: `PLANNING lock released — tasks/current-focus.md reset to NONE.` so the operator knows the state is clean.

**Post-merge typecheck:** if the §8.2 sync produced a merge commit (i.e. the branch was not already up to date), run `npm run typecheck` before continuing. If it fails, surface the full diagnostic and pause — the operator must decide whether to fix type errors introduced by main before proceeding, or abort. Typecheck failure here means main is broken, not the spec branch.

**Post-merge diff summary:** after a successful merge, print `git log HEAD..origin/main --oneline` so the operator can see what landed. Then check whether any file in that range overlaps with the feature's committed change-set (`git diff origin/main...HEAD --name-only`) and flag any overlap explicitly: "These files from main overlap with your feature branch: {list}." Informational only — operator decides whether to investigate before proceeding.

### §1.6 Step 3 — Brief intake and UI-touch detection

Read the brief (provided in the invocation, or read from a file the operator names). Classify the brief along two axes:

- **Scope class.** `Trivial | Standard | Significant | Major` per `CLAUDE.md` Task Classification. `spec-coordinator` runs the full Phase 1 only for Significant or Major. Standard briefs may skip mockups and skip `chatgpt-spec-review` if the operator confirms. Trivial briefs do NOT need a spec — coordinator resets `tasks/current-focus.md` to `NONE` (releasing the PLANNING lock), tells the operator to implement directly, and stops.
- **UI-touch.** Does the brief mention any of: a new page, a new screen, a new dialog, a new flow, a redesign, a layout change, a new control, visible copy, a new dashboard, or a new admin surface? If yes, set `ui_touch = true`.

If `ui_touch == true`, prompt the operator:

> This brief looks UI-touching. Generate hi-fi clickable prototypes first? Mockups become the design source of truth for the spec.
> Reply: **yes** or **no**.

Proceed based on the reply. If `no`, skip §1.8 entirely and jump to §1.9. If `yes`, run §1.8 in full before authoring the spec.

### §1.7 Step 4 — Build slug derivation + directory creation

Derive a kebab-case slug from the brief title (e.g. brief "Add live agent execution log" → slug `live-agent-execution-log`). If the proposed slug clashes with an existing `tasks/builds/<slug>/` directory, append a date suffix (`-2026-04-30`) and warn the operator.

Create `tasks/builds/{slug}/` if it doesn't exist. Create `tasks/builds/{slug}/progress.md` with an initial header and the phase-1 status table.

**Why before mockup loop:** the slug and directory must exist before invoking `mockup-designer`, which writes to `prototypes/{slug}/` and `tasks/builds/{slug}/mockup-log.md`.

### §1.8 Step 5 — Mockup loop (conditional)

Invoke `mockup-designer` (see §4.2) as a sub-agent. The sub-agent:

1. Reads `docs/frontend-design-principles.md` and the brief
2. Decides on format — single-file (`prototypes/{slug}.html`) vs multi-screen directory (`prototypes/{slug}/index.html` + numbered pages + `_shared.css`) — per §9 convention
3. Produces an initial draft and returns a summary plus the file path(s)

The coordinator then enters an **open-ended manual loop**:

- Print the mockup path(s). On a local environment, the operator can open the file in a browser to click through.
- Prompt: *"Mockups ready at `<path>`. Reply with feedback for the next round, or **complete** when you're done iterating."*
- If reply is `complete` (or "done", "ship the mockup", "approved"), exit the loop.
- Otherwise, pass the operator's feedback back to `mockup-designer` for the next round.

The loop has **no iteration cap**. Operator decides when it's done. Each round's input/output is appended to `tasks/builds/{slug}/mockup-log.md` so the audit trail survives.

When the loop exits, the final mockup paths are recorded in `tasks/builds/{slug}/handoff.md` under a `mockups:` field and become the design source of truth for the spec authoring step.

### §1.9 Step 6 — Spec authoring

Author the spec using `docs/spec-authoring-checklist.md` as the rubric. The spec file is named `docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md` matching the operator's existing convention.

Required sections (the checklist's appendix is the canonical list — this is the local summary):

- Status, date, author, scope class, source branch
- Goals, non-goals, framing assumptions
- Phase plan (if multi-phase)
- File inventory lock (every file/column/migration touched)
- Contracts (data shapes crossing service boundaries, with examples)
- Permissions / RLS checklist (if tenant-scoped tables touched)
- Execution model (sync/async, inline/queued, cached/dynamic)
- Phase sequencing (dependency graph, no backward references)
- Deferred items (mandatory, even if "None.")
- Self-consistency pass result
- Testing posture statement (defer-until-trigger, per `docs/spec-context.md`)
- Execution-safety contracts (idempotency, retry, concurrency, terminal events) for any new write paths
- Open questions

If the brief was UI-touching and mockups were produced, the spec MUST reference the prototype paths in its UI section and treat the mockups as the design source of truth.

### §1.10 Step 7 — spec-reviewer

Invoke `spec-reviewer` as a sub-agent with the spec path. The sub-agent:

- Reads `docs/spec-context.md` for framing ground truth
- Runs Codex against the spec, classifies findings as mechanical/directional/ambiguous
- Auto-applies mechanical fixes
- Routes ambiguous items to `tasks/todo.md` under the spec's deferred-items section
- Returns the verdict

Cap is `MAX_ITERATIONS = 5` per spec lifetime — the existing spec-reviewer enforces this; spec-coordinator does not override. If the spec hits the cap, spec-coordinator continues to §1.11 — the operator owns directional review from there.

### §1.11 Step 8 — chatgpt-spec-review (MANUAL mode auto-fire)

Invoke `chatgpt-spec-review` as a sub-agent. The MODE is **manual** — operator pastes ChatGPT-web responses into the session. This sub-agent:

- Detects the spec file (just-written by §1.9)
- Runs round-by-round with the operator
- Triages findings into technical (auto-applied) vs user-facing (operator-approved)
- Logs every decision

The coordinator pauses inside this sub-agent for as long as the operator's ChatGPT loop takes. There is no time cap — the operator drives the cadence.

When the sub-agent returns with a finalised spec, spec-coordinator proceeds.

### §1.12 Step 9 — Handoff write

Write `tasks/builds/{slug}/handoff.md` with the following fields:

```markdown
# Handoff — {slug}

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md
**Branch:** <current branch name>
**Build slug:** {slug}
**UI-touching:** yes | no
**Mockup paths:** [list, or "n/a"]
**Spec-reviewer iterations used:** N / 5
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-{slug}-{timestamp}.md
**Open questions for Phase 2:** [list, or "none"]
**Decisions made in Phase 1:** [bullet list — every directional choice the operator made]
```

`feature-coordinator` reads this file at its entry and uses every field.

### §1.13 Step 10 — current-focus.md update

Update the HTML mission-control block at the top of `tasks/current-focus.md`:

```html
<!-- mission-control
active_spec: docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md
active_plan: tasks/builds/{slug}/plan.md
build_slug: {slug}
branch: <branch>
status: BUILDING
last_updated: {YYYY-MM-DD}
-->
```

Then update the prose body to match — keep the prose-canonical rule from the existing file. The status enum transitions from whatever it was to `BUILDING`; if it was already `BUILDING` or `REVIEWING` for a different slug, refuse and prompt the operator (concurrent-feature collision).

### §1.14 Step 11 — End-of-phase prompt

Print to the operator:

> **Phase 1 (SPEC) complete.**
>
> Spec finalised at `docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md`.
> Handoff written to `tasks/builds/{slug}/handoff.md`.
> `tasks/current-focus.md` → status `BUILDING`.
>
> **Next:** open a new Claude Code session and type:
>
> ```
> launch feature coordinator
> ```
>
> This session ends here. Do not continue in this session — the new session starts cleanly with the handoff context.

Then mark the final TodoWrite item complete and stop.

### §1.15 Failure / escalation paths

- **Spec-reviewer hits MAX_ITERATIONS = 5.** Continue to §1.11 with a note in the handoff that directional review is operator-owned. Do not block.
- **Operator says "stop" mid-mockup loop.** Save the current mockup state, write a partial handoff with `phase_status: PHASE_1_PAUSED`, and exit. Operator can resume by re-launching `spec-coordinator` against the same slug — coordinator detects the partial handoff and resumes the mockup loop.
- **chatgpt-spec-review hits a finding that requires a re-spec.** The sub-agent's existing rules apply — it loops or exits. If the operator decides the spec is wrong enough to abandon, they re-launch `spec-coordinator` from scratch with a new brief and mark the old one Closed in `tasks/builds/{slug}/progress.md`.
- **Branch sync conflict at S0.** Pause and prompt per §8.

---

## §2 feature-coordinator — rewritten (Phase 2: BUILD)

### §2.1 Invocation

```
launch feature coordinator
```

Operator launches in a **fresh Claude Code session**, not the spec session. The coordinator restores all context from `tasks/current-focus.md` + `tasks/builds/{slug}/handoff.md`. If those files are missing or status is wrong, refuse to start.

### §2.2 Frontmatter

```yaml
name: feature-coordinator
description: Phase 2 orchestrator. Restores Phase 1 handoff, invokes architect for the implementation plan, runs chatgpt-plan-review (manual ChatGPT-web rounds), gates the plan with the operator, then loops chunk-by-chunk through builder (sonnet) with per-chunk static checks. After all chunks built, runs the branch-level review pass (spec-conformance, adversarial-reviewer, pr-reviewer, fix-loop, dual-reviewer), runs the doc-sync gate, and writes the handoff for finalisation-coordinator.
tools: Read, Glob, Grep, Bash, Edit, Write, Agent, TodoWrite
model: opus
```

### §2.3 Context loading (Step 0)

Before any work, read in order:

1. `CLAUDE.md`
2. `architecture.md`
3. `DEVELOPMENT_GUIDELINES.md` — locked build-discipline rules (RLS, service-tier, gates, migrations, §8 development discipline)
4. `tasks/current-focus.md` — verify `status: BUILDING` and the `build_slug` field is set
5. `tasks/builds/{slug}/handoff.md` — restore Phase 1 context
6. The spec at the path named in the handoff
7. `tasks/lessons.md`
8. `tasks/builds/{slug}/progress.md` — detect completed chunks; if any chunks are recorded as `done`, the coordinator was interrupted mid-build and resumes from the first incomplete chunk (see §2.9 per-chunk loop)

If `tasks/current-focus.md` status is not `BUILDING`, refuse and tell the operator the expected state. Do not proceed past this step with mismatched state.

### §2.4 Step 1 — Top-level TodoWrite list

Emit the full Phase 2 task list:

1. Context loading (this step)
2. Branch-sync **S1** + freshness check (§8)
3. `architect` invocation
4. `chatgpt-plan-review` (MANUAL mode)
5. plan-gate
6. Per-chunk loop (one TodoWrite item per chunk, expanded after architect returns)
7. **G2** integrated-state static-check gate (§7)
8. Branch-level review pass (one TodoWrite sub-item per reviewer)
9. Doc-sync gate
10. Handoff write (`tasks/builds/{slug}/handoff.md` updated for Phase 3)
11. `tasks/current-focus.md` → status `REVIEWING`
12. End-of-phase prompt

Items 6 and 8 expand once architect returns the chunk count and once the review pass starts.

### §2.5 Step 2 — Branch-sync S1 + freshness check

Per §8. Operator just typed "launch feature coordinator" and is at the keyboard — pause-and-prompt on conflicts is safe here.

Migration-number collision detection runs as part of S1: list `migrations/*.sql` files on `origin/main` vs the current branch, flag any number that appears on both sides with different content.

**Post-merge typecheck:** if the §8.2 sync produced a merge commit, run `npm run typecheck` before invoking architect. Type errors from main must be resolved before the build starts — architect plans against the post-merge state, and broken types will cascade into every chunk.

**Post-merge diff summary:** print `git log HEAD..origin/main --oneline`. Then compute file overlap: `git diff origin/main...HEAD --name-only` intersected with the files changed on main. If overlapping files are found → **require explicit operator confirmation** before proceeding: "Overlapping files detected between main and your feature branch: {list}. Type **continue** to proceed or **inspect** to pause and review." Do not proceed until operator types "continue". If no overlap → print the log and continue silently.

### §2.6 Step 3 — architect

Invoke `architect` as a sub-agent with the spec path. The sub-agent:

- Reads `CLAUDE.md`, `architecture.md`, `docs/spec-authoring-checklist.md`, `DEVELOPMENT_GUIDELINES.md`, `KNOWLEDGE.md`, the spec
- Runs the model-collapse pre-check
- Runs the primitives-reuse search
- Decomposes the spec into builder-session-sized chunks with forward-only dependencies
- Writes the plan to `tasks/builds/{slug}/plan.md`
- Returns a summary including the chunk count, chunk names, and any risks

The coordinator reviews the plan for:

- Chunks too large for one focused builder session — ask architect to split
- Awkward dependency order — ask architect to re-order
- Missing contracts or error-handling strategy — ask architect to fill in
- Chunks missing spec-section references — each chunk must cite the spec section(s) it implements (e.g. `spec_sections: [§4.1, §4.2]`); ask architect to add them

Plan-revision rounds capped at **3**. On the fourth, escalate to the operator.

**Chunk sizing guideline:** a well-sized chunk modifies ≤5 files OR represents ≤1 logical responsibility (one service layer, one data shape, one UI component). Chunks exceeding both limits must be split. Coordinator enforces this in the plan-review step above; architect should apply it proactively.

### §2.7 Step 4 — chatgpt-plan-review (MANUAL mode auto-fire)

Invoke `chatgpt-plan-review` as a sub-agent (see §4.3). MODE = **manual**. The sub-agent:

- Detects the plan file at `tasks/builds/{slug}/plan.md`
- Runs round-by-round with the operator
- Triages findings into technical (auto-applied to plan) vs user-facing (operator-approved)
- Logs every decision

Coordinator pauses inside this sub-agent for the operator's full ChatGPT loop. Same posture as §1.11 — no time cap, operator drives cadence.

When the sub-agent returns with a finalised plan, coordinator proceeds.

### §2.8 Step 5 — plan-gate

Present the finalised plan to the operator (chunk list, dependencies, risks). Print:

> **Plan finalised at `tasks/builds/{slug}/plan.md`.**
> Chunks: [list]
> Dependencies: [graph or list]
> Risks: [from architect's risks-and-mitigations section]
>
> Reply **proceed** to start the chunk loop, or **revise** with feedback to send back to architect.

This is **content review only** — the model-switch friction from the previous design is gone, because builder is its own sub-agent on Sonnet.

Operator reply handling:

- `proceed` / `execute` / `go` → continue to §2.9
- `revise` + feedback → send back to architect for one revision round (counts against the cap from §2.6), then re-run §2.7 and §2.8
- Anything else → ask the operator to clarify; do not infer

### §2.9 Step 6 — Per-chunk loop

Process chunks **one at a time** in plan order. For each chunk:

**Resume detection:** before invoking `builder` for each chunk, check `tasks/builds/{slug}/progress.md`. If ANY chunk is recorded as `done` (i.e. this is a resume run, not a fresh start):

**Pre-resume typecheck:** run `npm run typecheck` ONCE before processing any chunks. If it fails: surface the diagnostics, pause, and require the operator to fix the failures before resume proceeds — do NOT skip any completed chunks while the integrated state is type-broken. Completed-chunk skipping is only safe when the branch typechecks cleanly.

Then, for each chunk recorded as `done`:
1. Run `git log --oneline origin/main...HEAD -- <files listed for that chunk>` to verify a commit for those files exists on the branch.
2. If a commit exists → skip builder invocation, mark the TodoWrite item complete, and move to the next chunk.
3. If NO commit exists (progress.md was updated but the commit was interrupted) → treat the chunk as incomplete and re-run builder. Do NOT skip.

This makes feature-coordinator re-entrant while preventing false-skips caused by type drift from incomplete later chunks or progress.md updates that preceded a failed commit.

#### §2.9.1 Builder invocation

Invoke `builder` as a sub-agent (§4.1) with the prompt:

> Read `tasks/builds/{slug}/plan.md`. Implement chunk **`{chunk-name}`** ONLY. Do not implement later chunks. Follow the contracts and conventions in `architecture.md`. Enforce gate **G1** (lint + typecheck + build:server/client + targeted unit tests authored in this chunk) before reporting done. Return: list of files changed, summary of what was implemented, and any gap discovered in the plan.

The builder runs on Sonnet (per its frontmatter). It produces the implementation, runs G1, and either reports success or reports a plan gap.

#### §2.9.2 Plan-gap handling

If builder reports a plan gap:

1. Send back to `architect` with the gap description: "Builder found a gap in chunk `{chunk-name}`: {gap}. Revise the plan."
2. Re-invoke builder with the revised plan.
3. Cap at **2 plan-gap rounds per chunk**. On the third, escalate to the operator.

#### §2.9.3 Chunk completion

Once builder reports success and G1 passes:

**Commit-integrity invariant:** the coordinator commits immediately after builder returns SUCCESS, before any other coordinator-level work. Sequence:
1. Builder returns SUCCESS + G1 passes, providing its "Files changed" list.
2. Run `git diff --name-only HEAD` and compare against the declared file list. If unexpected files appear (tooling side-effects, formatter runs, etc.) → **hard fail**: print "Unexpected files in working tree: {list}. Commit blocked — investigate and revert unexpected changes before continuing." Do NOT commit; do NOT offer to stage only declared files. The operator must manually revert the unexpected changes (or escalate to architect if they represent a plan gap) before the coordinator resumes.
3. Once only declared files remain in the working tree: `git add <declared files only>` (never `git add .` or `git add -A`) then `git commit`.
4. Update `progress.md`, mark TodoWrite item complete, move to next chunk.

No file edits may occur between builder returning and step 3.

- Update `tasks/builds/{slug}/progress.md` — chunk status `done`, files changed list, builder log path if any
- Mark the chunk's TodoWrite item complete
- Move to next chunk

**No reviewers run in the per-chunk loop.** Reviewers run on the integrated branch state in §2.11.

### §2.10 Step 7 — G2 integrated-state gate

After all chunks are built, run the **G2** static-check gate per §7 against the integrated branch state:

```bash
npm run lint
npm run typecheck
```

If either fails: route the diagnostics back to a fresh `builder` invocation with the prompt:

> Cross-chunk static-check failure on integrated branch state. Diagnostics:
> ```
> {full diagnostics output}
> ```
> Fix the failures. Do not refactor unrelated code. Re-run G2 before reporting done.

Capped at **3 fix attempts**. On the fourth, escalate.

**Post-G2 spec-validity checkpoint:** after G2 passes and before starting the branch-level review pass, print:

> **G2 complete — all chunks built.**
>
> Before proceeding to branch-level review: has anything discovered during this build invalidated the spec? (E.g. a constraint that changes described behavior, a plan gap requiring a different implementation, an external API change.)
>
> Reply **continue** to proceed to the review pass. Or describe the issue — coordinator writes `phase_status: PHASE_2_SPEC_DRIFT_DETECTED` to handoff.md and pauses; the operator decides whether to re-run `spec-coordinator` for a targeted re-spec, or proceed with a documented deviation recorded in handoff.md under `spec_deviations:`.

This gate is a one-line confirmation in the common case (no drift) and a recoverable pause in the rare case.

### §2.11 Step 8 — Branch-level review pass

Run reviewers against the integrated state, in this fixed order:

#### §2.11.1 spec-conformance

Invoke `spec-conformance` per its existing playbook (executed in the parent session, not as a sub-agent — preserves user-visible TodoWrite per the existing playbook rule). Auto-detects the spec from `tasks/current-focus.md`. Auto-detects the changed-file set across the full branch.

Verdict handling:

- `CONFORMANT` → proceed to §2.11.2
- `CONFORMANT_AFTER_FIXES` → re-run G3 (§7) on the expanded change-set, then proceed
- `NON_CONFORMANT` → triage the appended deferred-items section in `tasks/todo.md`. Non-architectural gaps go back to a fresh `builder` invocation; architectural gaps stop the pipeline and escalate to the operator. Re-invoke `spec-conformance` after fixes. Cap at **2 spec-conformance rounds**.

#### §2.11.2 adversarial-reviewer (conditional)

Auto-trigger check per §5.1: glob the full branch diff against the auto-trigger surface. If any path matches, invoke `adversarial-reviewer` as a sub-agent against the full diff.

Findings are non-blocking advisory. Log written to `tasks/review-logs/adversarial-review-log-{slug}-{timestamp}.md`. Verdict goes into the branch-level review summary; the operator decides whether to escalate any finding.

If the auto-trigger does not match (pure-frontend or pure-docs branch), skip this step entirely with a note in progress.md.

#### §2.11.3 pr-reviewer

Invoke `pr-reviewer` as a sub-agent with the full branch diff. Existing contract — emits findings in three tiers (Blocking / Strong / Non-Blocking) inside a `pr-review-log` block. Coordinator extracts the block verbatim to `tasks/review-logs/pr-review-log-{slug}-{timestamp}.md`.

Verdict handling:

- `APPROVED` → proceed to §2.11.5
- `CHANGES_REQUESTED` → enter the fix-loop (§2.11.4)
- `NEEDS_DISCUSSION` → escalate to the operator; do not enter fix-loop without operator direction

#### §2.11.4 Fix-loop with G3

For each Blocking finding:

1. Send to a fresh `builder` invocation with the finding text and the file paths
2. Builder fixes, runs G3 (§7), returns
3. Re-invoke `pr-reviewer` against the updated diff

Capped at **3 fix-loop rounds**. On the fourth, escalate to the operator with all unresolved findings.

#### §2.11.5 dual-reviewer

Invoke `dual-reviewer` as a sub-agent. The existing dual-reviewer is local-only (depends on Codex CLI) — `feature-coordinator` checks for the Codex binary at this step and:

- If Codex is available locally → invoke as normal. Existing 3-iteration cap and Codex adjudication logic apply. After the loop, dual-reviewer auto-commits-and-pushes its log per its existing contract.
- If Codex is not available (e.g. running on Claude Code on the web) → skip this step with a note in progress.md, and a warning to the operator that the Codex pass was skipped.

After fixes from dual-reviewer, run G3 once more.

### §2.12 Step 9 — Doc-sync gate

Run the doc-sync sweep across the cumulative change-set, per `docs/doc-sync.md`. For each registered doc, log one of:

- `yes (sections X, Y)`
- `no — <one-line rationale>`
- `n/a`

Record verdicts in `tasks/builds/{slug}/progress.md` under a `## Doc Sync gate` heading. A missing verdict is a blocker — do not proceed.

A `no` verdict requires a rationale; a bare `no` is treated as missing.

**Enforcement invariant:** before recording the gate as complete, the coordinator reads `docs/doc-sync.md` and counts the registered docs. The verdict table must have exactly that many rows. Any shortfall is a gate failure — not a review comment.

### §2.13 Step 10 — Handoff write

**Phase 2 completion invariant** — verify ALL of the following before writing the handoff. If any item is not met, do NOT proceed; surface the gap and escalate per §6.4:

- [ ] All chunks have status `done` in `tasks/builds/{slug}/progress.md`
- [ ] G2 passed (lint + typecheck on integrated branch state)
- [ ] `spec-conformance` verdict is `CONFORMANT` or `CONFORMANT_AFTER_FIXES`
- [ ] `pr-reviewer` verdict is `APPROVED`
- [ ] Doc-sync gate verdicts recorded for all registered docs (§2.12 enforcement invariant met)

Update `tasks/builds/{slug}/handoff.md` (it was created by spec-coordinator; this is an append/update, not a replacement). Add a Phase 2 section:

```markdown
## Phase 2 (BUILD) — complete

**Plan path:** tasks/builds/{slug}/plan.md
**Chunks built:** N
**Branch HEAD at handoff:** <commit sha>
**G1 attempts (per chunk):** [chunk-name: attempts]
**G2 attempts:** N
**spec-conformance verdict:** {verdict} ({log path})
**adversarial-reviewer verdict:** {verdict or "skipped (no auto-trigger surface match)"} ({log path or n/a})
**pr-reviewer verdict:** {verdict} ({log path})
**Fix-loop iterations:** N
**dual-reviewer verdict:** {verdict} | `REVIEW_GAP: Codex CLI unavailable` ({log path or n/a})
**Doc-sync gate:** [verdict per doc]
**Open issues for finalisation:** [list of non-blocking findings deferred to ChatGPT review]
```

### §2.14 Step 11 — current-focus.md update

Update the mission-control block:

```html
status: REVIEWING
last_updated: {YYYY-MM-DD}
```

Keep `active_spec`, `active_plan`, `build_slug`, `branch` unchanged — finalisation needs them.

### §2.15 Step 12 — End-of-phase prompt

**Dual-reviewer skip warning:** if `handoff.md` contains `REVIEW_GAP: Codex CLI unavailable` in the `dual-reviewer verdict:` field, prepend the following to the Phase 2 complete message:

> ⚠ **Dual-reviewer was skipped — reduced review coverage for this build.** The Codex pass was unavailable. `chatgpt-pr-review` in Phase 3 will be the primary second-opinion pass; consider running `dual-reviewer` manually if Codex becomes available before merge.

Print:

> **Phase 2 (BUILD) complete.**
>
> All chunks built. Branch-level review pass complete. Doc-sync gate complete.
> Handoff updated at `tasks/builds/{slug}/handoff.md`.
> `tasks/current-focus.md` → status `REVIEWING`.
>
> **Next:** open a new Claude Code session and type:
>
> ```
> launch finalisation
> ```
>
> This session ends here.

Mark final TodoWrite item complete and stop.

### §2.16 Failure / escalation paths

- **architect plan-revision rounds exceed 3** → escalate, write `phase_status: PHASE_2_PAUSED_PLAN` to handoff.md, exit.
- **chatgpt-plan-review hits an unresolved finding** → its existing rules apply; the sub-agent decides loop vs exit.
- **plan-gate operator says "abort"** → write `phase_status: PHASE_2_ABORTED` to handoff.md, set current-focus to `NONE`, exit. Operator restarts from spec-coordinator if needed.
- **Per-chunk plan-gap rounds exceed 2** → freeze all remaining chunks; write `phase_status: PHASE_2_PAUSED_PLANGAP` and `paused_at_chunk: {chunk-name}` to handoff.md; hard-escalate per §6.4.2. Recovery message to operator: "Re-launch feature-coordinator — it will re-invoke architect from §2.6 with the full spec + current branch diff to produce a revised plan for the remaining chunks. **Architect MUST produce a complete revised plan for ALL remaining chunks — incremental patching of the existing plan is forbidden.** The full branch state is the input, not just the gap description."
- **Per-chunk rollback:** if a chunk is found to have corrupted earlier work, the recovery path is: `git revert <chunk-commit-sha>`, mark the chunk as `FAILED` in `progress.md`, require a plan revision (re-run from §2.6) before continuing. The per-chunk git commits (§6.5) are what make this safe.
- **G1 / G2 / G3 attempts exceed 3** → escalate with full diagnostics.
- **spec-conformance NON_CONFORMANT after 2 rounds** → escalate; do not proceed to pr-reviewer.
- **pr-reviewer fix-loop exceeds 3** → escalate; mark unresolved findings in handoff.
- **dual-reviewer Codex unavailable** → skip with note; do not block.
- **Doc-sync gate has missing verdict** → block; cannot exit Phase 2 with stale doc-sync state.

---

## §3 finalisation-coordinator (Phase 3: FINALISATION)

### §3.1 Invocation

```
launch finalisation
```

Operator launches in a **fresh Claude Code session**. Coordinator restores context from `tasks/current-focus.md` + `tasks/builds/{slug}/handoff.md`. If `status` is not `REVIEWING`, refuse and tell the operator the expected state.

### §3.2 Frontmatter

```yaml
name: finalisation-coordinator
description: Phase 3 orchestrator. Restores Phase 2 handoff, runs branch-sync S2 + G4 regression guard, runs chatgpt-pr-review (manual ChatGPT-web rounds), runs the full doc-sync sweep, updates KNOWLEDGE.md and tasks/todo.md, transitions current-focus to MERGE_READY, applies the ready-to-merge label so CI runs, and stops.
tools: Read, Glob, Grep, Bash, Edit, Write, Agent, TodoWrite
model: opus
```

### §3.3 Context loading (Step 0)

Read in order:

1. `CLAUDE.md`
2. `architecture.md`
3. `DEVELOPMENT_GUIDELINES.md`
4. `docs/doc-sync.md` — canonical reference doc list
5. `tasks/current-focus.md` — verify `status: REVIEWING`
6. `tasks/builds/{slug}/handoff.md` — restore Phase 2 context
7. `tasks/builds/{slug}/progress.md`
8. The spec at the path named in the handoff

**REVIEW_GAP check:** after reading the handoff, check `dual-reviewer verdict:` for `REVIEW_GAP: Codex CLI unavailable`. If present, print immediately before any other output:

> ⚠ **Dual-reviewer was skipped in Phase 2 — reduced review coverage.** `chatgpt-pr-review` in step 5 will be the primary second-opinion pass. Consider running `dual-reviewer` manually if Codex becomes available before merge.

**Spec-deviations check:** check `spec_deviations:` in the handoff. If present, note them — they will be included in the chatgpt-pr-review kickoff context in step 5.

### §3.4 Step 1 — Top-level TodoWrite list

1. Context loading (this step)
2. Branch-sync **S2** + freshness check (§8)
3. **G4** regression guard (§7)
4. PR existence check (`gh pr view`); create if missing
5. `chatgpt-pr-review` (MANUAL mode) — including its own per-round triage and any G3 fix-loop iterations
6. Full doc-sync sweep
7. KNOWLEDGE.md pattern extraction
8. `tasks/todo.md` cleanup (remove items this build closed)
9. `tasks/current-focus.md` → status `MERGE_READY` + clear active fields
10. Apply `ready-to-merge` label to PR (triggers CI / G5)
11. End-of-phase prompt

### §3.5 Step 2 — Branch-sync S2

Per §8. Operator just typed "launch finalisation" and is at the keyboard. Pause-and-prompt on conflicts is safe. Migration-number-collision detection runs as part of S2 (same logic as S1).

**Post-merge diff summary:** print `git log HEAD..origin/main --oneline`. If overlapping files are found between main and the feature branch → **require explicit operator confirmation** before G4 runs: "Overlapping files detected: {list}. Type **continue** to proceed to G4 or **inspect** to pause." Do not proceed until operator types "continue". If no overlap → continue to G4 silently.

### §3.6 Step 3 — G4 regression guard

Run G4 per §7 against the post-sync branch state:

```bash
npm run lint
npm run typecheck
```

If either fails, route diagnostics to a fresh `builder` invocation for fix-up. Capped at **3 attempts**. On the fourth, escalate.

This is the regression guard — it catches drift introduced by the S2 merge, or anything that slipped past Phase 2.

### §3.7 Step 4 — PR existence check

```bash
gh pr view --json number,url,title 2>/dev/null
```

- If a PR exists for the current branch → record the URL
- If no PR exists → run `gh pr create --fill` to create one

Print the PR URL prominently as a standalone first line, before any other output:

```
PR: https://github.com/.../<number>
```

This is the same persistence-and-print convention `chatgpt-pr-review` already uses.

### §3.8 Step 5 — chatgpt-pr-review (MANUAL mode auto-fire)

Invoke `chatgpt-pr-review` as a sub-agent. MODE = **manual**. Before invoking, check handoff.md for `spec_deviations:` — if present, include them in the sub-agent's kickoff context: "Note: the following spec deviations were recorded during Phase 2. Please review whether the implementation handles these correctly: {list}."

The sub-agent uses its existing contract:

- Prepares code-only diff (excluding spec / plan / review-log files already reviewed by other agents)
- Captures operator's pasted ChatGPT responses
- Round-by-round triage, technical findings auto-applied, user-facing findings operator-approved
- After fixes, runs G3 (§7)
- Logs every decision

Coordinator pauses inside this sub-agent for the operator's full ChatGPT loop. No time cap; operator drives cadence.

When the sub-agent returns, it has done its own KNOWLEDGE.md updates and doc-sync work as part of its existing finalisation. The coordinator's §3.9 doc-sync sweep is the cross-check that confirms `chatgpt-pr-review` covered everything.

### §3.9 Step 6 — Full doc-sync sweep

Run the doc-sync sweep across the full feature change-set per `docs/doc-sync.md`. This is the **cross-check** of the work `chatgpt-pr-review` did — both should agree, but `finalisation-coordinator` is the system of record.

For each registered doc:

| Doc | Update when… |
|---|---|
| `architecture.md` | Service boundaries, route conventions, agent fleet, RLS, etc. |
| `docs/capabilities.md` | Add / remove / rename capability, skill, integration. Editorial Rules apply. |
| `docs/integration-reference.md` | Integration behaviour change. Update `last_verified`. |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | Build discipline, conventions, agent fleet, locked rules. |
| `docs/frontend-design-principles.md` | New UI pattern, hard rule, worked example. |
| `KNOWLEDGE.md` | Patterns and corrections — always check. |
| `docs/spec-context.md` | Spec-review sessions only — n/a here. |

Record verdicts in the chatgpt-pr-review session log under `## Final Summary` (per the existing format in `docs/doc-sync.md`).

A missing verdict blocks finalisation. A bare `no` is treated as missing — must include rationale.

**Enforcement invariant:** coordinator reads `docs/doc-sync.md` and counts the registered docs. The verdict table must have exactly that many rows. Any shortfall is a gate failure.

### §3.10 Step 7 — KNOWLEDGE.md pattern extraction

Cross-check that `chatgpt-pr-review` extracted the durable patterns from this build into `KNOWLEDGE.md`. If any pattern is missing — particularly anything in the `[ACCEPT]` decision log of dual-reviewer or pr-reviewer — append it now.

Patterns appended in this step are clearly marked with provenance:

```markdown
## [Pattern title]
**Date:** {YYYY-MM-DD}
**Source:** finalisation-coordinator finalisation pass on PR #{N} (slug: {slug})
**Pattern:** [the pattern]
**Why it matters:** [the failure mode it prevents]
```

### §3.11 Step 8 — tasks/todo.md cleanup

Read `tasks/todo.md`. Find items closed by this build:

1. Items that match the spec's File inventory or implemented chunks
2. Items in deferred-from-spec-conformance / deferred-from-pr-reviewer sections that the build resolved
3. Bug or idea entries from `tasks/bugs.md` / `tasks/ideas.md` that this build addressed (cross-reference the handoff's "Open issues for finalisation" list and the spec's Goals)

For each closed item: remove from `tasks/todo.md` (or move to a `## Closed by {slug}` archive section, operator's preference — default is remove).

Items in `tasks/todo.md` that are NOT closed by this build remain untouched.

### §3.12 Step 9 — current-focus.md → MERGE_READY

Update the mission-control block:

```html
<!-- mission-control
active_spec: none
active_plan: none
build_slug: none
branch: none
status: MERGE_READY
last_updated: {YYYY-MM-DD}
last_merge_ready_pr: #{N}
last_merge_ready_slug: {slug}
last_merge_ready_branch: {branch}
-->
```

Note the explicit clearing of `active_spec`, `active_plan`, `build_slug`, `branch` — this is what prevents another concurrent session from thinking the build is still in flight (operator's stated requirement: "the In Progress document should be updated as well to remove that this current development is in progress, so it doesn't confuse other instances").

The `last_merge_ready_*` fields are added so the audit trail survives — they record what just shipped, in case Phase 4 (CI) or merge fails and the operator needs to recover context.

Update the prose body to match. Status enum transitions `REVIEWING → MERGE_READY`.

### §3.13 Step 10 — Apply ready-to-merge label

```bash
gh pr edit <pr-number> --add-label "ready-to-merge"
```

This label is the operator's existing convention — labelling triggers CI, which runs G5 (full lint + typecheck + test gates) as the pre-merge backstop.

If the label add fails (label doesn't exist, permissions, network), surface the exact error and pause. Do not attempt force-merge or any other workaround.

### §3.14 Step 11 — End-of-phase prompt

Print:

> **Phase 3 (FINALISATION) complete.**
>
> PR #{N}: <url>
> `ready-to-merge` label applied. CI is running G5.
> `tasks/current-focus.md` → status `MERGE_READY`. Active fields cleared.
> Doc-sync sweep complete. KNOWLEDGE.md updated. `tasks/todo.md` cleaned.
>
> **Next:** wait for CI. If CI green → merge the PR via the GitHub UI. After merge, set `tasks/current-focus.md` status to `MERGED` (or `NONE` if you want to clear the trail) — finalisation-coordinator does NOT auto-merge.
>
> This session ends here.

Mark final TodoWrite item complete and stop.

### §3.15 Failure / escalation paths

- **S2 conflict** → pause-and-prompt. Operator resolves manually. Coordinator continues after operator says "continue".
- **G4 attempts exceed 3** → escalate with full diagnostics; do not proceed.
- **chatgpt-pr-review hits an unresolvable finding** → its existing rules apply.
- **Doc-sync sweep has missing verdict** → block; cannot exit Phase 3 with stale state.
- **`gh pr edit` fails** → surface exact error, pause; operator resolves (likely a label permissions issue or rate limit).
- **CI fails after label applied** → out of scope for `finalisation-coordinator`; operator handles via the standard CI-failure response (read CI log, fix in a follow-up commit, re-run CI).

---

## §4 New sub-agents

### §4.1 builder

#### §4.1.1 Frontmatter

```yaml
name: builder
description: Implements a single chunk from a plan file. Runs on Sonnet. Enforces gate G1 (lint + typecheck + build:server/client + targeted unit tests authored in this chunk) before reporting done. Reports plan gaps if the plan is missing context the implementation needs.
tools: Read, Glob, Grep, Bash, Edit, Write, TodoWrite
model: sonnet
```

The `model: sonnet` line is load-bearing — this is what eliminates the manual model switch from the previous design. When `feature-coordinator` (running on Opus) invokes `builder` via the `Agent` tool, the sub-agent runs at the model named in its own frontmatter, regardless of the parent's model.

#### §4.1.2 Invocation contract

The caller (feature-coordinator) provides:

- The plan path (`tasks/builds/{slug}/plan.md`)
- The chunk name (must match a chunk header in the plan)
- The list of files the plan associates with this chunk (informational; builder reads the plan)

#### §4.1.3 Context loading (Step 0)

1. `CLAUDE.md`
2. `architecture.md`
3. `DEVELOPMENT_GUIDELINES.md` — read when the chunk touches `migrations/`, `server/db/schema/`, `server/services/`, `server/routes/`, `server/lib/`, RLS policies, or LLM-routing code; skip for pure-frontend / pure-docs chunks
4. The plan at the path provided
5. The specific chunk's section in the plan
6. Any files the chunk references that already exist in the repo (Read them before Editing)

#### §4.1.4 Step 1 — TodoWrite list

Emit a TodoWrite list with:

1. Context loading
2. Plan-gap pre-check — confirm the chunk is implementable from the plan + repo state alone
3. Implementation (one item per file or per logical unit, expanded after pre-check)
4. G1 gate — lint
5. G1 gate — typecheck
6. G1 gate — build:server (if server files touched)
7. G1 gate — build:client (if client files touched)
8. G1 gate — targeted unit tests (one item per new test file; required ONLY for new pure functions with no DB/network/filesystem side effects in new service or transformation logic — skip for route additions, schema migrations, and UI-only components)
9. Return summary

Items 4–8 are per-touched-area, not all five. Skip the ones that don't apply (e.g. pure-server change skips build:client).

#### §4.1.5 Step 2 — Plan-gap pre-check

Before writing any code, scan the plan section against the repo state:

- Does every file the chunk references actually exist (or is it explicitly listed as "create new")?
- Does every contract the chunk depends on exist (interface, schema, type)?
- Does every prerequisite chunk's output exist on disk?

If any prerequisite is missing → return early with a `plan-gap` verdict naming the gap. Do NOT attempt to fill the gap. The caller (feature-coordinator) routes this back to architect.

If all prerequisites are present → proceed.

#### §4.1.6 Step 3 — Implementation

Implement the chunk. Rules:

- **Surgical changes only.** Every changed line traces to the chunk's specification.
- **No refactoring of unrelated code.** Even if you see something suboptimal, mention it in the return summary; do not edit it.
- **Match existing style.** No drive-by reformatting.
- **No backwards-compatibility hacks.** Per `CLAUDE.md`, delete unused code outright; no "// removed" comments.
- **No comments by default.** Only add a comment for non-obvious WHY (a hidden constraint, a workaround for a specific bug). Don't explain WHAT.
- **No error handling for impossible scenarios.** Trust internal contracts; only validate at system boundaries.

#### §4.1.7 Step 4 — G1 enforcement

After implementation, run G1 per §7. Caching enabled (incremental, --cache).

Loop on failure:

- Read the diagnostic
- Fix the specific issue
- Re-run the failing check
- Cap at **3 attempts per check**

On the fourth attempt of any check → return with verdict `G1_FAILED` and the full diagnostic. Do NOT report success.

Successful G1 = all relevant checks pass. Builder reports success only when every applicable gate from §4.1.4 items 4–8 passes.

#### §4.1.8 Step 5 — Return summary

Return to caller:

```
Verdict: SUCCESS | PLAN_GAP | G1_FAILED
Files changed: [list]
Spec sections: [list of §section numbers from the spec this chunk implements, e.g. §4.1, §4.2]
What was implemented: [one paragraph summary]
Plan gap (if any): [description]
G1 attempts (per check): {lint: N, typecheck: N, build:server: N, build:client: N, targeted tests: N}
Notes for caller: [anything the caller should know — e.g. "noticed a related issue in file X but did not fix per surgical-changes rule"]
```

#### §4.1.9 Rules

- Never invoke other agents. Builder is a leaf sub-agent.
- Never run full test gates (`npm run test:gates`, `scripts/gates/*.sh`, etc.) — CI-only per `CLAUDE.md § Test gates are CI-only — never run locally`.
- Never `--no-verify`, never skip a check, never amend a commit (builder doesn't commit anyway — it edits files; the caller commits at the chunk boundary).
- Never write to `tasks/current-focus.md` or `tasks/builds/{slug}/handoff.md` — those are coordinator-owned.
- Never implement a forward dependency — if the implementation requires a symbol, type, or file from a later chunk that does not yet exist on disk, return `PLAN_GAP` immediately. Do not create stubs or placeholders to work around the missing dependency.

---

### §4.2 mockup-designer

#### §4.2.1 Frontmatter

```yaml
name: mockup-designer
description: Produces hi-fi clickable HTML prototypes for UI-touching briefs. Runs on Sonnet. Reads frontend-design-principles.md and applies the five hard rules. Iterates with the operator round-by-round until the operator says "complete". Output is either a single-file static screen (prototypes/{slug}.html) or a multi-screen clickable directory (prototypes/{slug}/index.html + numbered pages + _shared.css).
tools: Read, Glob, Grep, Bash, Edit, Write, TodoWrite
model: sonnet
```

#### §4.2.2 Context loading (Step 0)

1. `docs/frontend-design-principles.md` — **mandatory every round**, not just round 1, since this doc is always evolving (per the operator's stated requirement). Re-read at the start of every round to inherit any changes.
2. `CLAUDE.md` § *Frontend Design Principles* (the brief operator-facing summary)
3. `architecture.md` § *Frontend conventions* (route patterns, lazy-loading rules, permissions UI conventions)
4. The brief
5. Any existing prototypes referenced in the brief (Read them before Editing)

#### §4.2.3 Format decision

At the start of round 1, decide format per §9:

- **Single-file** (`prototypes/{slug}.html`) — when the brief mentions one screen, no flow, no navigation
- **Multi-screen directory** (`prototypes/{slug}/index.html` + numbered pages + `_shared.css`) — when the brief mentions a workflow, multiple screens, or navigation between states

Record the decision in the round-1 return summary so the operator can override if they disagree.

#### §4.2.4 Per-round contract

Each round:

1. Re-read `docs/frontend-design-principles.md` (it may have changed since last round)
2. Read the operator's feedback from the previous round (if not round 1)
3. Apply the five hard rules from `frontend-design-principles.md`:
   - Start with the user's primary task, not the data model
   - Default to hidden — defer dashboards, KPI tiles, diagnostic panels until a workflow demands them
   - One primary action per screen
   - Inline state beats dashboards
   - The re-check — would a non-technical operator complete the primary task without feeling overwhelmed?
4. Edit the prototype file(s)
5. Append the round summary to `tasks/builds/{slug}/mockup-log.md`:

```markdown
## Round {N} — {YYYY-MM-DD HH:MM}
**Operator feedback:** [the operator's input for this round, or "initial draft" for round 1]
**Changes made:** [bullet list]
**Frontend-design-principles checks:** [yes/no for each of the five rules, with brief explanation]
**Files modified:** [list]
```

6. Return to the caller (spec-coordinator) with the file path(s) and the changes summary. Caller surfaces this to the operator and waits for the next instruction.

#### §4.2.5 Loop termination

Caller (spec-coordinator) controls the loop. Mockup-designer does NOT decide when to stop. Caller invokes mockup-designer for each round; on the operator's `complete` signal, caller exits the loop without invoking mockup-designer again.

#### §4.2.6 Tailwind / styling convention

Match the existing prototypes' styling convention. Inspect `prototypes/agent-as-employee/_shared.css` and `prototypes/pulse/*.html` for the current pattern. If a `_shared.css` exists for the slug's directory, link it from every page. If a single-file mockup, embed styles in `<style>` tags inline (matches the existing `prototypes/system-costs-page.html` style).

Do not introduce new design systems or import external CSS frameworks the rest of the prototypes don't use.

#### §4.2.7 Rules

- Never invoke other agents.
- Never modify the brief or the spec — this sub-agent only writes to `prototypes/` and `tasks/builds/{slug}/mockup-log.md`.
- Never declare the mockup "complete" — only the operator decides that.
- If a brief asks for behaviour that violates the five hard rules (e.g. "build a dashboard with five KPI tiles"), implement it AND flag the violation in the round summary. Do not silently sanitise the brief.

---

### §4.3 chatgpt-plan-review

#### §4.3.1 Frontmatter

```yaml
name: chatgpt-plan-review
description: ChatGPT plan review coordinator — mirrors chatgpt-spec-review but points at the implementation plan (tasks/builds/{slug}/plan.md). Auto-fires in MANUAL mode from feature-coordinator. Runs round-by-round with the operator pasting ChatGPT-web responses. Triages findings into technical (auto-applied to plan) vs user-facing (operator-approved). Logs every decision.
tools: Read, Glob, Grep, Bash, Edit, Write
model: opus
```

#### §4.3.2 Why not reuse `chatgpt-spec-review`?

The operator already runs ChatGPT review on plans manually. The mechanics are identical to `chatgpt-spec-review` (round-by-round, manual paste, triage, log) but the **target file** differs (plan vs spec). Reusing `chatgpt-spec-review` with a target-file parameter would force a flag through dozens of paste-and-detect heuristics in that file, including the spec-detect step which assumes `docs/**/*.md` — wrong for plans which live at `tasks/builds/{slug}/plan.md`.

A sibling agent with copy-and-modify is cleaner. The two sub-agents diverge in:

- Target file path (spec vs plan)
- The questions sent to ChatGPT (plan-review prompts focus on phase sequencing, contracts, primitives reuse, builder-session-sized chunks; spec-review prompts focus on framing, goals, deferred items, contracts)
- Auto-apply scope (plan edits are mechanical reorderings + contract additions; spec edits are framing changes)

#### §4.3.3 Invocation contract

Caller (feature-coordinator) invokes:

```
chatgpt-plan-review (mode: manual) target=tasks/builds/{slug}/plan.md
```

#### §4.3.4 On-start sequence

1. Detect plan path from invocation. If not provided, derive from `tasks/current-focus.md` `active_plan` field.
2. Read the plan in full.
3. Check for an existing session log scoped to this slug: `ls tasks/review-logs/chatgpt-plan-review-{slug}-*.md 2>/dev/null | sort | tail -1`. If one exists for this slug, resume from the last completed round. (The glob MUST be scoped to the current slug — do not use the unscoped `chatgpt-plan-review-*.md` pattern, which would pick up logs from different features.)
4. If no log exists: write the Session Info header, create `.chatgpt-diffs/` if needed, prepare round 1 (the plan content as a `.md` file the operator uploads to ChatGPT-web).
5. Print the kickoff message:

   > **Round 1 of chatgpt-plan-review (manual mode).**
   >
   > Plan: `tasks/builds/{slug}/plan.md`
   > Upload this file to ChatGPT-web and ask for: phase sequencing review, contracts review, primitives-reuse review, chunk-sizing review.
   >
   > When ChatGPT responds, paste the response back into this session.

#### §4.3.5 Per-round contract

Same as `chatgpt-spec-review`:

1. Operator pastes ChatGPT response
2. Sub-agent extracts findings, triages each as `technical` (auto-apply) or `user-facing` (operator-approved)
3. Auto-applies technical findings, prints the user-facing ones for operator approval
4. Logs every decision in `tasks/review-logs/chatgpt-plan-review-{slug}-{timestamp}.md`
5. Asks operator: "Run another round, or say `done`?"

#### §4.3.6 Termination

Operator says `done` → finalise the log, return to caller (feature-coordinator) with the verdict.

Verdict format (mirrors chatgpt-spec-review):

```
Verdict: APPROVED | NEEDS_REVISION
Rounds: N
Findings: [counts by triage bucket]
Auto-applied: [count]
Operator-approved: [count]
Deferred to tasks/todo.md: [count, with links]
Log path: tasks/review-logs/chatgpt-plan-review-{slug}-{timestamp}.md
```

#### §4.3.7 Rules

- Never call the OpenAI API. This sub-agent is MANUAL mode only — the operator stated explicit preference for ChatGPT-web feedback richness.
- Never modify the spec — only the plan. The plan lives at `tasks/builds/{slug}/plan.md`.
- Never auto-commit during the loop — auto-apply edits to the plan, but commit happens at the caller (feature-coordinator) boundary.

---

## §5 Existing-agent updates

### §5.1 adversarial-reviewer — auto-trigger surface

#### §5.1.1 Current state (2026-04-30)

`.claude/agents/adversarial-reviewer.md` says (paraphrasing):

> Manually invoked only — the user must explicitly ask, matching the dual-reviewer posture. Auto-invocation from feature-coordinator is deferred. The intended auto-trigger surface, once auto-invocation lands, is any change under `server/db/schema/`, `server/routes/`, `server/services/auth*`, `server/middleware/`, or RLS-related migrations.

This spec lands the deferred auto-invocation. The agent's existing finding labels (`confirmed-hole`, `likely-hole`, `worth-confirming`) and Phase 1 advisory posture (non-blocking unless operator escalates) are unchanged.

#### §5.1.2 Auto-trigger surface — full path-glob list

The `feature-coordinator` runs the adversarial-reviewer step IF and ONLY IF the branch's committed diff against `origin/main` matches **any** of the following globs. (By the time this check runs — after G2 and all chunk commits — pipeline-authored changes are committed; staged/unstaged/untracked changes from manual operator edits are outside the pipeline's scope and are not checked here.)

```
server/db/schema/**
server/db/migrations/**
migrations/**
server/routes/**
server/services/auth*/**
server/services/permission*/**
server/services/orgScoping*/**
server/services/tenantContext*/**
server/middleware/**
server/lib/orgScoping*
server/lib/scopeAssertion*
server/lib/canonicalActor*
server/instrumentation.ts
server/services/*Webhook*/**
server/routes/*webhook*/**
shared/**/permission*
shared/**/auth*
shared/**/runtimePolicy*
server/config/rlsProtectedTables.ts
```

Plus, regardless of path: any file whose **diff content** contains any of `db.transaction`, `withOrgTx`, `getOrgScopedDb`, `withAdminConnection`, `setSession`, `assertScope`, `tenantId`, `organisationId`, `subaccountId` AND was either added or had >5 lines changed in this branch. (Content-based fallback for security-sensitive logic that may live outside the path globs.)

Detection algorithm:

```bash
# Path-based check
git diff origin/main...HEAD --name-only | \
  grep -E '^(server/db/(schema|migrations)|migrations|server/(routes|middleware|instrumentation\.ts)|server/services/(auth|permission|orgScoping|tenantContext)|server/lib/(orgScoping|scopeAssertion|canonicalActor)|shared/.*?(permission|auth|runtimePolicy)|server/config/rlsProtectedTables\.ts|server/services/.*Webhook|server/routes/.*webhook)'

# Content-based check (only run if path-based check is empty and operator wants to be thorough)
git diff origin/main...HEAD | \
  grep -E '\b(db\.transaction|withOrgTx|getOrgScopedDb|withAdminConnection|setSession|assertScope|tenantId|organisationId|subaccountId)\b'
```

If either check returns a non-empty result → auto-trigger. If both empty → skip with note in `progress.md`: `adversarial-reviewer: skipped — no auto-trigger surface match`.

#### §5.1.3 Frontmatter update

Change the existing description and trigger sections in `.claude/agents/adversarial-reviewer.md`:

**Before:**

```yaml
description: Adversarial / threat-model review — read-only. Hunts tenant-isolation, auth, race-condition, injection, resource-abuse, and cross-tenant data-leakage holes after `pr-reviewer` runs. Manually invoked only — the user must explicitly ask. Phase 1 advisory; non-blocking.
```

**After:**

```yaml
description: Adversarial / threat-model review — read-only. Hunts tenant-isolation, auth, race-condition, injection, resource-abuse, and cross-tenant data-leakage holes. Auto-invoked from feature-coordinator's branch-level review pass when the branch diff matches the auto-trigger surface (server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, webhook handlers — full list in 2026-04-30-dev-pipeline-coordinators-spec.md §5.1.2). Manual invocation also supported. Phase 1 advisory; non-blocking unless escalated.
```

The `## Trigger` and `## Failure-mode posture` sections inside the agent file are updated to match — replacing "Manually invoked only" with the auto-trigger surface and the conditional rule.

#### §5.1.4 Backwards compatibility

Manual invocation continues to work exactly as before. The auto-invocation is purely additive — it does not change what happens when the operator explicitly asks for adversarial-reviewer.

---

### §5.2 dual-reviewer — auto-invocation from feature-coordinator

#### §5.2.1 Current state

`.claude/agents/dual-reviewer.md` is **manual-only, local-only**. Per `CLAUDE.md`:

> `dual-reviewer` Codex review loop with Claude adjudication — second-phase code review. Local-dev only — requires the local Codex CLI; unavailable in Claude Code on the web. After `pr-reviewer` on Significant and Major tasks — only when the user explicitly asks, never auto-invoked.

The operator's stated workflow has them at a local VS Code session for development. The dual-reviewer's local-only requirement is therefore not a blocker for auto-invocation — it's a blocker only when the operator runs the pipeline on Claude Code on the web.

#### §5.2.2 New invocation rules

Update `dual-reviewer.md` to allow auto-invocation **only from feature-coordinator's branch-level review pass**, with the following guardrail:

**Before invoking, feature-coordinator MUST check that the local Codex CLI is available**:

```bash
CODEX_BIN=$(command -v codex 2>/dev/null || echo "/c/Users/Michael/AppData/Roaming/npm/codex")
if [ ! -x "$CODEX_BIN" ] && [ ! -f "$CODEX_BIN" ]; then
  # Codex CLI not available — skip dual-reviewer with note in progress.md
  exit 0
fi
$CODEX_BIN login status > /dev/null 2>&1 || exit 0  # not authenticated → skip
```

If Codex is available and authenticated → invoke dual-reviewer normally.
If unavailable → skip with the note `dual-reviewer: skipped — Codex CLI unavailable or unauthenticated` in `progress.md`. Do NOT block the pipeline.

#### §5.2.3 Standalone manual invocation unchanged

When the operator manually invokes `dual-reviewer` outside the coordinator pipeline, the existing rules apply (Codex must be available; if not, agent stops and reports). Manual standalone invocation is unchanged — operator still must explicitly ask.

The `auto-invocation from feature-coordinator only` rule means:

- **Allowed:** feature-coordinator step §2.11.5 invokes dual-reviewer
- **Allowed:** operator manually invokes "run dual-reviewer"
- **Not allowed:** any other agent (e.g. spec-coordinator, finalisation-coordinator) auto-invoking dual-reviewer

#### §5.2.4 Frontmatter update

Update `.claude/agents/dual-reviewer.md` description:

**Before:**

```yaml
description: Second-phase Codex code-review loop with Claude adjudication. Run AFTER pr-reviewer. Evaluates Codex recommendations, implements accepted fixes, loops until satisfied or 3 iterations. Use for Significant and Major tasks. Caller provides a brief description of what was implemented.
```

**After:**

```yaml
description: Second-phase Codex code-review loop with Claude adjudication. Run AFTER pr-reviewer in the feature-coordinator branch-level review pass, OR manually invoked by the operator. Local-dev only — requires the local Codex CLI; auto-invocation from feature-coordinator is skipped (with note in progress.md) when Codex is unavailable. Evaluates Codex recommendations, implements accepted fixes, loops until satisfied or 3 iterations. Caller provides a brief description of what was implemented.
```

Update the **Local-development-only** paragraph in the body of the agent file:

**Before:**

> Local-development-only. This agent depends on the local Codex CLI; it does not run in Claude Code on the web, in CI, or in any remote sandbox. **Never auto-invoke** — only run when the user explicitly asks (e.g. "run dual-reviewer", "do the Codex pass"). The PR-ready bar without dual-reviewer is: pr-reviewer has passed and any blocking findings are addressed.

**After:**

> Local-development-only. This agent depends on the local Codex CLI; it does not run in Claude Code on the web, in CI, or in any remote sandbox.
>
> **Auto-invocation rule:** auto-invoked from `feature-coordinator`'s branch-level review pass (§2.11.5 of `2026-04-30-dev-pipeline-coordinators-spec.md`) when Codex is available; skipped with a note in `progress.md` when Codex is not available. Do NOT auto-invoke from any other agent. Manual invocation by the operator is always allowed and unchanged.
>
> The PR-ready bar without dual-reviewer is: pr-reviewer has passed and any blocking findings are addressed.

#### §5.2.5 Backwards compatibility

Manual invocation continues unchanged. The auto-invocation is purely additive in environments where Codex is available, and silently skipped where it isn't — so a Claude Code on the web session running feature-coordinator simply does not run dual-reviewer.

#### §5.2.6 Update CLAUDE.md

The CLAUDE.md task-classification table currently says:

> `dual-reviewer` optionally — only if the user explicitly asks and the session is running locally

Update to:

> `dual-reviewer` automatically when feature-coordinator runs its branch-level review pass and Codex is available. Manual standalone invocation also allowed. Skipped silently when Codex is unavailable (e.g. Claude Code on the web).

---

## §6 Cross-cutting concerns

### §6.1 Handoff contract — current-focus.md + handoff.md

Two files carry state across coordinator boundaries. Both are pre-existing in this codebase; this spec formalises their contract for the three-coordinator pipeline.

#### §6.1.1 tasks/current-focus.md — global pointer

The mission-control HTML block at the top is the machine-readable contract. The prose body is canonical when the two disagree (per the existing rule).

**Required fields in the mission-control block:**

```yaml
active_spec: <spec path or "none">
active_plan: <plan path or "none">
build_slug: <slug or "none">
branch: <branch name or "none">
status: PLANNING | BUILDING | REVIEWING | MERGE_READY | MERGED | NONE
last_updated: YYYY-MM-DD
```

**Optional fields (set by finalisation-coordinator at MERGE_READY transition):**

```yaml
last_merge_ready_pr: #N
last_merge_ready_slug: <slug>
last_merge_ready_branch: <branch>
```

**Status enum transitions (the only valid transitions):**

| From | To | Trigger |
|---|---|---|
| `NONE` | `PLANNING` | spec-coordinator entry, before any work |
| `PLANNING` | `BUILDING` | spec-coordinator §1.13 (handoff write complete) |
| `PLANNING` | `NONE` | operator aborts mid-spec; spec-coordinator §1.15 |
| `BUILDING` | `REVIEWING` | feature-coordinator §2.14 (build + branch-level review complete) |
| `BUILDING` | `NONE` | operator aborts; feature-coordinator §2.16 |
| `REVIEWING` | `MERGE_READY` | finalisation-coordinator §3.12 |
| `MERGE_READY` | `MERGED` | operator updates after `gh pr merge` succeeds (manual; no coordinator owns this transition) |
| `MERGE_READY` | `NONE` | operator clears the trail after merge (manual; equivalent to MERGED for pipeline purposes) |
| `MERGED` | `NONE` | manual; operator's choice when starting fresh |

**Forbidden transitions** (coordinator refuses on entry if state mismatches):

- `PLANNING` → `REVIEWING` (skipped Phase 2)
- `BUILDING` → `MERGE_READY` (skipped Phase 3)
- `REVIEWING` → `BUILDING` (no rollback path; if Phase 2 needs re-doing, operator manually resets state and re-runs feature-coordinator)
- Any transition into `PLANNING` while another slug is `BUILDING` or `REVIEWING` (concurrent-feature collision; coordinator refuses)

**Concurrency:** only one slug may be in flight (`PLANNING | BUILDING | REVIEWING`) at a time. The system supports parallel branches, but the global pointer tracks one feature; if the operator works on two features in parallel, they accept that mission-control reflects only one.

**Single-threaded by design.** This is an intentional architectural choice, not a limitation — the pipeline is optimized for focused sequential feature delivery. This constraint is explicit and permanent at this stage; parallel-slug support is deferred (see Deferred items).

#### §6.1.2 tasks/builds/{slug}/handoff.md — per-build context

Created by spec-coordinator (§1.12), updated by feature-coordinator (§2.13), read by finalisation-coordinator (§3.3).

**Phase 1 fields (spec-coordinator-owned):**

- `Phase complete:` (PHASE 1 / PHASE 1 PAUSED / PHASE 1 ABORTED)
- `Spec path:`
- `Branch:`
- `Build slug:`
- `UI-touching:`
- `Mockup paths:`
- `Spec-reviewer iterations used:`
- `ChatGPT spec review log:`
- `Open questions for Phase 2:`
- `Decisions made in Phase 1:`

**Phase 2 fields (feature-coordinator-owned, appended under `## Phase 2 (BUILD) — complete`):**

- `Plan path:`
- `Chunks built:`
- `Branch HEAD at handoff:`
- `G1 attempts (per chunk):`
- `G2 attempts:`
- `spec-conformance verdict:`
- `adversarial-reviewer verdict:`
- `pr-reviewer verdict:`
- `Fix-loop iterations:`
- `dual-reviewer verdict:` (format: `{verdict}` OR `REVIEW_GAP: Codex CLI unavailable`)
- `Doc-sync gate:` verdicts
- `Open issues for finalisation:`
- `phase_status:` (optional — written only on abort/pause; values: `PHASE_2_PAUSED_PLAN | PHASE_2_PAUSED_PLANGAP | PHASE_2_ABORTED | PHASE_2_SPEC_DRIFT_DETECTED`)
- `paused_at_chunk:` (optional — written with `PHASE_2_PAUSED_PLANGAP`)
- `spec_deviations:` (optional — written when operator acknowledges spec drift at the post-G2 checkpoint; lists each deviation with a brief rationale)

**Phase 3 fields (finalisation-coordinator-owned, appended under `## Phase 3 (FINALISATION) — complete`):**

- `PR number:`
- `chatgpt-pr-review log:`
- `spec_deviations reviewed:` (optional — "yes" if Phase 2 handoff had spec_deviations and they were reviewed in chatgpt-pr-review; "n/a" if no deviations)
- `Doc-sync sweep verdicts:`
- `KNOWLEDGE.md entries added:`
- `tasks/todo.md items removed:`
- `ready-to-merge label applied at:` (timestamp)

**Source-of-truth precedence** (per `docs/spec-authoring-checklist.md` §3 mandatory subsection):

When the same fact appears in `tasks/current-focus.md` and `tasks/builds/{slug}/handoff.md`, **the per-build handoff.md is the more detailed source**. `tasks/current-focus.md` is the high-level pointer; if the two disagree on a field both contain (e.g. `branch`), the handoff.md value wins. Coordinators that detect a disagreement must surface a warning to the operator before proceeding.

### §6.2 TodoWrite visibility strategy

The operator's stated requirement (paraphrased): *"detailed task lists so they don't time out like what we've seen previously."*

The timeout pattern: a sub-agent runs for tens of minutes with no surface-visible progress, the parent session shows no movement, and the operator (or the harness watcher) treats the lack of activity as a hang.

**Mitigation — three-tier TodoWrite strategy:**

1. **Coordinator-level TodoWrite (always visible).** Each coordinator emits a top-level TodoWrite list at Step 1 (§1.4, §2.4, §3.4). Items are updated in real time as sub-agents complete. This is what the operator sees in their main session UI; the list is the operator's single visible progress indicator across the entire phase.
2. **Sub-agent-level TodoWrite (visible when expanded).** Each sub-agent (`architect`, `builder`, `mockup-designer`, `spec-conformance` — already does this — `spec-reviewer`, `chatgpt-spec-review`, `chatgpt-plan-review`, `chatgpt-pr-review`, `pr-reviewer`, `adversarial-reviewer`, `dual-reviewer`) emits its own TodoWrite list at its Step 1. Visible in the VS Code sub-agent panel when expanded. Provides intra-sub-agent progress visibility.
3. **Spec-conformance plays back to parent (existing).** `spec-conformance` is uniquely run as a playbook in the parent session, NOT as a sub-agent (per its existing definition). Its TodoWrite list appears in the operator's main UI directly. This is preserved.

**Hard rule:** every sub-agent definition created or modified by this spec MUST include a Step 1 TodoWrite skeleton in its frontmatter `description` and a `Step 1 — TodoWrite list` section in its body. This is enforced at acceptance (§10.2).

**Authority:** `tasks/builds/{slug}/progress.md` is the authoritative record for chunk status, gate attempt counts, and review verdicts. The TodoWrite list is a real-time UI indicator only. If the two disagree (e.g. after a hard-interrupted session where TodoWrite was not updated), `progress.md` wins. Coordinators that detect a discrepancy must reconcile by writing `progress.md` first, then updating TodoWrite.

### §6.3 Timeout / cap rules

Every loop in the pipeline is capped:

| Loop | Cap | On cap |
|---|---|---|
| `spec-reviewer` (existing) | 5 lifetime iterations per spec | Continue with operator-owned directional review |
| `chatgpt-spec-review` rounds | None (operator-driven) | Operator says `done` |
| `chatgpt-plan-review` rounds | None (operator-driven) | Operator says `done` |
| `chatgpt-pr-review` rounds | None (operator-driven) | Operator says `done` |
| Mockup loop rounds | None (operator-driven) | Operator says `complete` |
| `architect` plan-revision rounds | 3 | Escalate |
| Per-chunk plan-gap rounds | 2 | Escalate, do not start later chunks |
| G1 / G2 / G3 / G4 fix-attempts (per check) | 3 | Escalate with full diagnostics |
| `spec-conformance` rounds | 2 | Escalate (do not proceed to pr-reviewer) |
| `pr-reviewer` fix-loop rounds | 3 | Escalate with unresolved findings |
| `dual-reviewer` iterations (existing) | 3 | Existing behaviour: produce log with verdict |

**Sub-agent runtime time-cap:** none. Sub-agents are not killed for taking too long. They are killed for not emitting TodoWrite progress, but that's a TodoWrite-strategy concern, not a coordinator-level cap.

### §6.4 Error and escalation paths

Two escalation modes:

#### §6.4.1 Soft escalation (pause-and-prompt)

The coordinator pauses, prints a clear prompt with the current state, and waits for operator input. Used for:

- Branch-sync conflicts (§8)
- Operator approval gates (mockup approval, plan-gate, user-facing finding triage)
- Cap exhaustion when the operator can choose to override
- Doc-sync verdict missing (operator must record)

After the prompt, the operator types a response and the coordinator resumes.

#### §6.4.2 Hard escalation (write state and exit)

The coordinator writes a `phase_status:` field to the handoff.md indicating the abort reason, sets `tasks/current-focus.md` status appropriately, prints a clear message naming the state and how to recover, and exits the session. Used for:

- Architect plan-revision rounds exceed 3
- Plan-gap rounds exceed 2 mid-build
- Static-check gate attempts exceed 3 with no obvious resolution
- spec-conformance NON_CONFORMANT after 2 rounds with architectural gaps
- Operator says "abort"

After hard escalation, the operator either:

- Resumes by re-launching the relevant coordinator (which detects the partial state and offers to continue or restart)
- Manually edits state files and restarts (escape hatch — not the default path)

**Abort invariant:** on any abort or hard-escalation path, `tasks/current-focus.md` MUST end in one of: `NONE` (full abort) OR a named status (`PLANNING | BUILDING | REVIEWING`) with a matching `phase_status: *_PAUSED | *_ABORTED` entry in `handoff.md`. Ambiguous state — non-NONE status with no matching handoff entry — is a pipeline bug and must never be left behind. If a coordinator cannot write the handoff cleanly before exiting, it MUST at minimum set `tasks/current-focus.md` to `NONE`.

**Abort write order:** always write `handoff.md` first, then update `tasks/current-focus.md`. Never reverse this order. A crash between the two writes leaves current-focus.md pointing at a valid handoff (safe recovery) rather than an updated current-focus.md with no matching handoff entry (ambiguous, confusing).

#### §6.4.3 Recovery path matrix

| Failure point | Recovery |
|---|---|
| Phase 1 spec-reviewer hits cap | Continue (soft); proceed to chatgpt-spec-review |
| Phase 1 mockup loop interrupted | Resume by re-launching spec-coordinator; coordinator detects partial state |
| Phase 2 architect plan-revision cap | Hard escalation; operator reviews architect output, manually fixes plan, re-runs from §2.7 (chatgpt-plan-review) |
| Phase 2 chunk plan-gap cap | Hard escalation; operator reviews the plan, may need to restart from architect with revised inputs |
| Phase 2 G1/G2 cap | Hard escalation; operator inspects diagnostics, fixes manually, re-runs the gate |
| Phase 2 spec drift detected (post-G2) | Soft escalation; operator describes the drift — coordinator records in `spec_deviations:` and continues, OR operator re-runs `spec-coordinator` for a targeted re-spec |
| Phase 2 spec-conformance NON_CONFORMANT | Hard escalation; operator triages the deferred items section, decides whether to fix in-pipeline (re-run feature-coordinator from §2.11) or re-do the spec |
| Phase 2 pr-reviewer fix-loop cap | Hard escalation; operator reviews unresolved findings, decides whether they're blocking or deferrable |
| Phase 3 doc-sync verdict missing | Soft escalation; operator records the verdict and types `continue` |
| Phase 3 ready-to-merge label fails | Soft escalation; operator resolves (likely permissions); coordinator retries |
| CI fails after label | Out of scope; standard CI-failure flow (operator opens follow-up commit) |

### §6.5 Auto-commit-and-push posture

Per `CLAUDE.md` user-preferences: the main session does NOT auto-commit or auto-push. Review agents have an explicit opt-in.

**Coordinator commit rules:**

- **`spec-coordinator`** — auto-commits at end of Phase 1: the spec file, the prototype directory if any, the handoff.md, the updated current-focus.md, `tasks/builds/{slug}/progress.md`, and `tasks/builds/{slug}/mockup-log.md` (if a mockup loop ran). Pushes to the current branch. Justification: the operator has opted in to the review-agent commit pattern, and spec-coordinator is the topmost orchestrator of Phase 1; without auto-commit-and-push, the next session starting on a different machine or after a context compaction would not see Phase 1's work.
- **`feature-coordinator`** — auto-commits per chunk (after each successful chunk + G1) AND at end of Phase 2 (after branch-level review pass + doc-sync). Pushes to the current branch after each commit. Justification: chunk-level commits preserve incremental work on the branch; if Phase 2 is interrupted, the operator can restart `feature-coordinator` on the same branch — architect re-runs from scratch, but already-built code changes persist on the branch and are visible to the new plan.
- **`finalisation-coordinator`** — auto-commits at end of Phase 3 (after doc-sync sweep + KNOWLEDGE.md + todo.md cleanup). Pushes to the current branch. Justification: same as the existing `chatgpt-pr-review` finalisation contract.
- **Sub-agents (`builder`, `mockup-designer`, `chatgpt-plan-review`)** — never commit. They edit files; the parent coordinator commits at its boundary.
- **Existing review agents (`spec-reviewer`, `dual-reviewer`)** — keep their existing auto-commit behaviour. `pr-reviewer` and `adversarial-reviewer` remain read-only.

Commit-message convention:

```
chore({coordinator}): {phase} — {short summary}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Examples:

```
chore(spec-coordinator): Phase 1 complete — dev-pipeline-coordinators
chore(feature-coordinator): chunk 3 complete — builder-sub-agent (G1 attempts: 1)
chore(feature-coordinator): Phase 2 complete — branch-level review pass + doc-sync
chore(finalisation-coordinator): Phase 3 complete — doc-sync sweep + ready-to-merge label
```

**Never** `--amend`, `--no-verify`, or force-push from a coordinator. If a pre-commit hook fails, the coordinator surfaces the failure as a soft escalation; the operator decides next steps.

---

## §7 Static-check gate policy (G1–G5)

### §7.1 Five named gates

| Gate | Position | Owner | Scope |
|---|---|---|---|
| **G1** | Per-chunk, inside `builder`, before reporting done | builder | Lint + typecheck + (build:server if server touched) + (build:client if client touched) + (targeted unit tests for new pure functions only — skip for route additions, migrations, UI components) |
| **G2** | feature-coordinator §2.10, after all chunks built, before branch-level review pass | feature-coordinator | Full lint + full typecheck on the integrated branch state |
| **G3** | After every fix-loop iteration that edits code (pr-reviewer fix-loop, dual-reviewer fix-loop, chatgpt-pr-review fix-loop) | feature-coordinator / finalisation-coordinator | Full lint + full typecheck |
| **G4** | finalisation-coordinator §3.6, regression guard at start of Phase 3 | finalisation-coordinator | Full lint + full typecheck |
| **G5** | CI, on PR with `ready-to-merge` label | CI (existing) | Full lint + full typecheck + full test gates |

### §7.2 Canonical commands

Use the commands from `CLAUDE.md § Verification Commands`:

```bash
npm run lint
npm run typecheck    # equivalent to: tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json
npm run build:server # if server files touched
npm run build:client # if client files touched
npx tsx <path-to-test>  # for the single targeted unit test authored in the chunk
```

Do NOT use:

- `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test` — CI-only per `CLAUDE.md`
- `bash scripts/run-all-unit-tests.sh`, `bash scripts/run-all-gates.sh`, individual `scripts/verify-*.sh` or `scripts/gates/*.sh` — CI-only
- Any "regression sanity check" / "quick re-verify everything" / "confirm no regression" wording — those are dressed-up gate runs

This is a hard rule and must be enforced by every coordinator and sub-agent. Builder explicitly rejects any plan-instruction that requests a forbidden command.

### §7.3 Cap and escalation

Each gate has a **3-attempt cap per check** (lint, typecheck, build:server, build:client, targeted test each get 3 attempts independently). On the fourth attempt of any check:

1. STOP. Do not retry.
2. Capture: the exact diagnostic, what was tried, the working hypothesis for root cause.
3. For builder (G1): return verdict `G1_FAILED` with the diagnostic.
4. For coordinators (G2, G3, G4): hard-escalate per §6.4.2.

This matches the existing CLAUDE.md "Stuck detection" rule.

### §7.4 Scoped vs full runs

Per-chunk gates (G1) run on **touched files only** to minimise wall-clock time. Cross-chunk and post-fix gates (G2, G3, G4) run on the **full project** because cross-file type drift won't show up in a scoped run.

Concretely:

| Gate | Lint scope | Typecheck scope |
|---|---|---|
| G1 | `eslint <touched files>` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json` (project-wide; tsc cannot be scoped to individual files for type-correctness) |
| G2 | `npm run lint` (full) | `npm run typecheck` (full) |
| G3 | `npm run lint` (full) | `npm run typecheck` (full) |
| G4 | `npm run lint` (full) | `npm run typecheck` (full) |
| G5 | CI runs full | CI runs full |

### §7.5 Performance posture

#### §7.5.1 Measured baseline (post PR #246 merge)

Wall-clock measurements taken on this dev environment after merging `origin/main` (commit `becf20ba`, includes PR #246 lint-typecheck-baseline):

| Check | Cold time | Notes |
|---|---|---|
| `tsc --noEmit -p server/tsconfig.json` | ~12s | 1700+ TS files, server-only |
| `tsc --noEmit -p tsconfig.json` (client) | ~5s | client-only |
| Combined `npm run typecheck` | ~17s | sequential, no cache |
| `npm run lint` (`eslint .`) | not measured here, ~20–40s expected on full project | flat config with type-aware rules |

**Total cold per gate:** ~30–60s. **5 gates × cold:** ~2.5–5 min total per feature.

This is materially better than the ~10 min figure assumed at original spec authoring time. The cache enablement below is therefore **optional, not blocking** — it shifts the experience from "tolerable" to "fast", but the pipeline is shippable without it.

#### §7.5.2 TypeScript incremental cache (recommended)

Add `"incremental": true` to **both** tsconfigs. Not yet present on `main` as of `becf20ba`:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsc-client.tsbuildinfo",
    // ... existing options
  }
}
```

```jsonc
// server/tsconfig.json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "../node_modules/.cache/tsc-server.tsbuildinfo",
    // ... existing options
  }
}
```

`.gitignore` already excludes `node_modules/` (verified at `becf20ba`), so `node_modules/.cache/` is implicitly ignored. No `.gitignore` change needed.

Effect: warm runs drop from ~17s → ~3–8s for typecheck combined.

#### §7.5.3 ESLint cache (recommended)

Update the `lint` script in `package.json`. Current script (post-PR #246) is `eslint .`:

```jsonc
{
  "scripts": {
    "lint": "eslint . --cache --cache-location node_modules/.cache/eslint"
  }
}
```

Effect: warm runs drop from ~20–40s → ~3–8s.

#### §7.5.4 Estimated total cost per feature

| State | Per-gate cold | Per-gate warm | 5 gates total |
|---|---|---|---|
| No caches (post PR #246, today) | ~30–60s | n/a | ~2.5–5 min |
| With caches (after follow-up) | ~30–60s | ~5–15s | ~1–1.5 min |

Either is acceptable. Cache enablement is a small follow-up PR — preferred but not gating.

### §7.6 Rollout dependency

PR #246 (`lint-typecheck-baseline`) merged to `main` at commit `eb39ac3e`. As of that merge:

- `eslint.config.js` (flat config, type-aware on server + client) shipped
- 64 server typecheck errors fixed
- `lint` and `typecheck` scripts in `package.json` shipped
- Server `tsconfig.json` `lib` extended to `ES2020/2021/2022`

**Remaining prerequisites before this pipeline ships:**

1. **None blocking.** The pipeline can ship against the post-PR #246 baseline. Per-gate cold cost is ~30–60s; 5 gates per feature is ~2.5–5 min — acceptable.
2. **Optional follow-up:** the cache enablement (§7.5.2, §7.5.3). Shrinks per-feature gate cost to ~1–1.5 min. A single small PR.

If the operator wants the cache enablement before shipping the pipeline, sequence: cache PR lands → pipeline PR lands. If not, ship the pipeline now and add caches when convenient.

The rollout sequence is enforced in §10.3.

### §7.7 What gates do NOT cover

- **Runtime correctness.** Static checks catch type errors and lint violations; they do not catch logic bugs. The pipeline's correctness backstop is `pr-reviewer` (logic review), `dual-reviewer` (Codex pass), and CI test gates (G5).
- **Test gates.** Per `CLAUDE.md`, full test gates are CI-only. G5 is the test-gate gate.
- **Migration safety.** Migration-number collisions are caught by §8 sync; migration content correctness is reviewed by `pr-reviewer` and `dual-reviewer`.
- **Frontend visual correctness.** Per `CLAUDE.md § Verifiability heuristic`, UI quality is non-verifiable; the operator iterates visually with mockups (§4.2) and does not delegate UI judgement to gates.

---

## §8 Branch-sync policy (S0–S2)

### §8.1 Three sync gates, all at coordinator entries

| Sync | Position | Coordinator | Operator present? |
|---|---|---|---|
| **S0** | spec-coordinator §1.5, before any work | spec-coordinator | ✓ (operator just typed `spec-coordinator: ...`) |
| **S1** | feature-coordinator §2.5, before architect | feature-coordinator | ✓ (operator just typed `launch feature coordinator`) |
| **S2** | finalisation-coordinator §3.5, before G4 | finalisation-coordinator | ✓ (operator just typed `launch finalisation`) |

**No mid-coordinator sync.** Per the operator's stated requirement: *"only include these merges at points where I'm already manually doing stuff so that the automated processes can run without impediment"*. Sync attempts during autonomous runs (per-chunk loop, branch-level review pass, ChatGPT loops) are forbidden — they could wedge the run on conflicts when the operator has walked away.

This means drift accumulated during a long Phase 2 build is not synced until S2 (finalisation entry), with the operator present to resolve any conflicts. Per the operator's acknowledgement: *"we'll just have to be mindful that there might be more conflicts to address at the end of the development run."*

### §8.2 Sync command sequence

At every sync gate:

```bash
# Step 1 — fetch
git fetch origin
if [ $? -ne 0 ]; then
  # Network failure — retry with exponential backoff (per project convention: 2s, 4s, 8s, 16s)
  # Cap at 4 retries, then surface the error
fi

# Step 2 — freshness check (informational)
COMMITS_BEHIND=$(git rev-list --count HEAD..origin/main)
echo "Branch is ${COMMITS_BEHIND} commits behind main"

# Step 3 — apply freshness threshold (see §8.4)

# Step 4 — check if already up to date (avoids starting an in-progress merge we'd need to abort)
if git merge-base --is-ancestor origin/main HEAD; then
  echo "Already up to date with main — no merge needed"
else
  # Step 5 — attempt merge with conflict detection
  git merge origin/main --no-commit --no-ff
  MERGE_EXIT=$?

  if [ $MERGE_EXIT -eq 0 ]; then
    # Clean merge — commit it
    git commit -m "chore(sync): merge main into <branch> (S{0|1|2})"
  else
    # Conflict — pause and prompt (see §8.5)
    echo "Merge conflicts present:"
    git diff --name-only --diff-filter=U
    # Coordinator pauses here for operator resolution
  fi
fi
```

### §8.3 Migration-number collision detection

Run as part of every sync gate. Before the merge attempt:

```bash
# Extract numeric prefixes from migrations on origin/main (not on current branch)
MAIN_PREFIXES=$(git diff HEAD...origin/main --name-only -- 'migrations/*.sql' \
  | xargs -I{} basename {} | grep -oP '^\d+' | sort)

# Extract numeric prefixes from migrations on current branch (not on origin/main)
BRANCH_PREFIXES=$(git diff origin/main...HEAD --name-only -- 'migrations/*.sql' \
  | xargs -I{} basename {} | grep -oP '^\d+' | sort)

# Find any prefix appearing on both sides — that is a collision
COLLISIONS=$(comm -12 <(echo "$MAIN_PREFIXES") <(echo "$BRANCH_PREFIXES"))

if [ -n "$COLLISIONS" ]; then
  echo "Migration-number collision(s) detected: $COLLISIONS"
  # Enumerate the specific files for each colliding prefix
  for PREFIX in $COLLISIONS; do
    MAIN_FILE=$(git diff HEAD...origin/main --name-only -- "migrations/${PREFIX}*.sql")
    BRANCH_FILE=$(git diff origin/main...HEAD --name-only -- "migrations/${PREFIX}*.sql")
    echo "  origin/main: $MAIN_FILE"
    echo "  this branch: $BRANCH_FILE"
  done
fi
```

If collisions are found, surface the collision explicitly:

> **Migration-number collision detected.**
>
> origin/main: `migrations/0244-foo.sql` ({sha})
> current branch: `migrations/0244-bar.sql` ({sha})
>
> The merge will produce a name conflict. Renumber your branch's migration before continuing.

The operator must resolve the collision manually (rename the local migration to the next available number) before the coordinator can continue. This is a known footgun and resolving it via generic merge-conflict resolution produces silent breakage.

### §8.4 Freshness check thresholds

Result of `git rev-list --count HEAD..origin/main` interpreted as:

| Commits behind | Behaviour |
|---|---|
| 0–10 | Green. Print `Branch is N commits behind main — proceeding.` Continue silently. |
| 11–30 | Yellow. Print `Branch is N commits behind main — recommend reviewing the diff.` Continue without blocking. |
| 31+ | Red. Refuse to start without explicit override. Print `Branch is N commits behind main — drift exceeds the safe threshold. Reply 'force' to override, or 'abort' to exit and rebase manually.` |

The 30-commit threshold is calibrated to the operator's velocity (~1–2 PRs/day; 30 commits ≈ 2–3 weeks). Adjust by editing this section.

### §8.5 Conflict-handling protocol

When `git merge` returns a non-zero exit code due to conflicts:

1. Coordinator prints the conflicting file list (`git diff --name-only --diff-filter=U`)
2. Coordinator prints the operator-facing prompt:

   > **Merge conflicts at S{0|1|2}.**
   >
   > {N} files have conflicts. Resolve them in your editor:
   >
   > {file list}
   >
   > After resolving and staging (`git add <files>`), reply **continue** to commit the merge and proceed.
   > Reply **abort** to abandon the merge (`git merge --abort`) and exit the coordinator.

3. Coordinator pauses and waits for operator input.
4. On `continue`: run `git diff --check` to confirm no remaining markers, run `git diff --cached --quiet` to confirm files are staged, then commit the merge with the message in §8.2.
5. On `abort`: run `git merge --abort` and hard-escalate per §6.4.2.
6. On any other input: ask the operator to clarify. Do not infer.

### §8.6 Optional manual mid-run sync (escape hatch)

If during an autonomous Phase 2 chunk loop or branch-level review pass the operator notices main has shipped something relevant, they can:

1. Interrupt the session (Ctrl-C / cancel the running tool call)
2. In the same session, type: `pause and sync main`
3. Coordinator runs the §8.2 sync sequence
4. After sync completes (clean or after operator-resolved conflicts), operator types `continue`
5. Coordinator resumes from the last completed step

This is a documented escape hatch, NOT a default. Coordinators do not auto-sync during autonomous runs.

### §8.7 What sync does NOT do

- **Does not rebase.** This codebase uses merge, not rebase, per the existing project history (`Merge remote-tracking branch 'origin/main' into <branch>` pattern in git log). Rebasing during a long-running branch would force-push and is forbidden.
- **Does not auto-resolve conflicts.** Auto-resolution silently picks one side; in this codebase that's a known source of bugs (migration numbers, RLS table registry, schema enums). Always pause-and-prompt.
- **Does not push.** Sync commits land on the local branch; the next coordinator-level commit (§6.5) pushes the branch including the sync commit.
- **Does not run during sub-agent execution.** Sub-agents (`builder`, `mockup-designer`, `chatgpt-plan-review`, etc.) never sync. Only coordinators do.

---

## §9 Housekeeping — mockups vs prototypes consolidation

### §9.1 Current state

Two locations exist on disk for design artifacts:

- **`tasks/mockups/`** — 1 file: `org-chart-redesign.html`. Single static screen.
- **`prototypes/`** — mix:
  - Flat single-pagers: `brief-endtoend.html`, `delegation-graph.html`, `system-costs-page.html`
  - Multi-screen clickable directories: `agent-as-employee/` (16 pages), `cached-context/` (5 pages), `pulse/` (10+ pages), `riley-observations/`

The mockups vs prototypes distinction was never enforced. Both directories serve the same purpose. New artifacts going to either location is operator-dependent.

### §9.2 Target state — single location, format-driven convention

**Consolidate to `prototypes/` only. Retire `tasks/mockups/`.**

Convention going forward:

- **`prototypes/{slug}.html`** — single static screen (one screen, no flow, no navigation)
- **`prototypes/{slug}/`** — multi-screen clickable directory, with:
  - `index.html` — entry page linking to all numbered screens
  - Numbered screen files: `01-{name}.html`, `02-{name}.html`, ...
  - `_shared.css` — shared styling for the slug's directory

The `mockup-designer` sub-agent (§4.2) selects format based on the brief. The choice is recorded in the round-1 return summary so the operator can override.

### §9.3 Migration

In the same commit that lands this spec:

1. Move `tasks/mockups/org-chart-redesign.html` → `prototypes/org-chart-redesign.html`
   ```bash
   git mv tasks/mockups/org-chart-redesign.html prototypes/org-chart-redesign.html
   ```
2. Remove the empty `tasks/mockups/` directory:
   ```bash
   rmdir tasks/mockups
   ```
3. Search the repo for references to `tasks/mockups/`:
   ```bash
   grep -r "tasks/mockups" . --exclude-dir=node_modules --exclude-dir=.git
   ```
   Update each reference to `prototypes/` accordingly. Likely files: `CLAUDE.md`, `architecture.md`, `docs/doc-sync.md`, any spec or plan that references the path.

### §9.4 Update docs/doc-sync.md if needed

`docs/doc-sync.md` does not currently reference `tasks/mockups/`. Verify with grep; if no references, no change to doc-sync.md is needed.

`docs/frontend-design-principles.md` may reference example mockup paths — update if it does.

### §9.5 What this does NOT change

- Existing prototype directories (`prototypes/agent-as-employee/`, `prototypes/cached-context/`, etc.) stay where they are. No renaming, no restructuring.
- The styling convention inside individual prototypes is unchanged. `mockup-designer` matches whatever exists.
- The operator's existing manual workflow (writing mockups by hand in either location) continues to work; the only change is that there is now one canonical location instead of two.

---

## §10 File inventory, acceptance criteria, rollout

### §10.1 File inventory

#### §10.1.1 New files

| Path | Purpose | Section |
|---|---|---|
| `.claude/agents/spec-coordinator.md` | Phase 1 coordinator | §1 |
| `.claude/agents/finalisation-coordinator.md` | Phase 3 coordinator | §3 |
| `.claude/agents/builder.md` | Sonnet sub-agent for chunk implementation | §4.1 |
| `.claude/agents/mockup-designer.md` | Sonnet sub-agent for hi-fi prototypes | §4.2 |
| `.claude/agents/chatgpt-plan-review.md` | Manual-mode wrapper for ChatGPT plan review | §4.3 |
| `prototypes/org-chart-redesign.html` | Migrated from `tasks/mockups/` | §9.3 |

#### §10.1.2 Rewritten files

| Path | Change | Section |
|---|---|---|
| `.claude/agents/feature-coordinator.md` | Full rewrite — builder dispatch, branch-level review pass, plan-gate without model switch, S1 sync, G1/G2/G3 gates, doc-sync | §2 |

#### §10.1.3 Modified files (frontmatter + small body changes)

| Path | Change | Section |
|---|---|---|
| `.claude/agents/adversarial-reviewer.md` | Auto-trigger surface; remove "manually invoked only" | §5.1 |
| `.claude/agents/dual-reviewer.md` | Auto-invocation from feature-coordinator only | §5.2 |

#### §10.1.4 Documentation updates

| Path | Change |
|---|---|
| `CLAUDE.md` | New entries in agent table for `spec-coordinator`, `finalisation-coordinator`, `builder`, `mockup-designer`, `chatgpt-plan-review`. New common invocations. Updated dual-reviewer rule. Updated pipeline diagram. Removed "manually invoked only" from adversarial-reviewer rule. |
| `architecture.md` | Updated agent fleet section if it references the old per-chunk review pattern. Updated Key files per domain if applicable. |
| `docs/doc-sync.md` | No change (does not reference `tasks/mockups/`). Re-grep at acceptance time to confirm. |
| `docs/frontend-design-principles.md` | No change to the principles themselves; if any example references `tasks/mockups/`, update path. |
| `docs/spec-context.md` | No framing change — this spec inherits existing framing. No update needed. |
| `KNOWLEDGE.md` | New entry: pipeline-coordinator hand-off contract; new entry: builder + sonnet model isolation pattern; new entry: gate-naming convention (G1–G5, S0–S2). Add at finalisation. |
| `tasks/current-focus.md` | Updated mission-control block to reflect this spec being in flight (PLANNING). |

#### §10.1.5 Removed files

| Path | Reason |
|---|---|
| `tasks/mockups/org-chart-redesign.html` | Migrated to `prototypes/org-chart-redesign.html` per §9.3 |
| `tasks/mockups/` (empty directory) | Retired per §9.3 |

#### §10.1.6 Pre-shipment dependencies (separate PRs)

| Path / change | Status | Purpose |
|---|---|---|
| Lint/typecheck cleanup | **DONE** — landed in PR #246 (`eb39ac3e`) | `main` is green on `npm run lint` and `npm run typecheck` |
| `eslint.config.js` (flat config, type-aware) | **DONE** — landed in PR #246 | Shared lint config for server + client |
| `lint` and `typecheck` npm scripts | **DONE** — landed in PR #246 | `npm run lint`, `npm run typecheck` available |
| `tsconfig.json` `incremental: true` + `tsBuildInfoFile` | **OPTIONAL** — recommended follow-up (§7.5.2) | Faster warm typecheck runs |
| `server/tsconfig.json` `incremental: true` + `tsBuildInfoFile` | **OPTIONAL** — recommended follow-up (§7.5.2) | Faster warm typecheck runs |
| `package.json` `lint` script with `--cache --cache-location` | **OPTIONAL** — recommended follow-up (§7.5.3) | Faster warm lint runs |
| `.gitignore` `node_modules/.cache/` entry | **NOT NEEDED** | `node_modules/` already excluded |

The OPTIONAL items can land in a single small follow-up PR. They are not gating — the pipeline ships against the post-PR #246 baseline at ~30–60s per gate cold cost.

### §10.2 Acceptance criteria

Each criterion below is deterministic — checkable by file inspection or a short shell command.

#### §10.2.1 Agent files exist with the right shape

- [ ] `.claude/agents/spec-coordinator.md` exists with `name: spec-coordinator`, `model: opus`, and includes Steps 0–11 from §1
- [ ] `.claude/agents/finalisation-coordinator.md` exists with `name: finalisation-coordinator`, `model: opus`, and includes Steps 0–11 from §3
- [ ] `.claude/agents/builder.md` exists with `name: builder`, `model: sonnet`, and includes the §4.1 Steps
- [ ] `.claude/agents/mockup-designer.md` exists with `name: mockup-designer`, `model: sonnet`, and references `docs/frontend-design-principles.md` in its Step 0 context loading
- [ ] `.claude/agents/chatgpt-plan-review.md` exists with `name: chatgpt-plan-review`, `model: opus`, and points at `tasks/builds/{slug}/plan.md` as its target
- [ ] `.claude/agents/feature-coordinator.md` rewritten — contains §2 Steps 0–12, references the `builder` sub-agent, references the branch-level review pass, references the doc-sync gate

#### §10.2.2 Existing agents updated

- [ ] `.claude/agents/adversarial-reviewer.md` description does NOT contain "Manually invoked only"
- [ ] `.claude/agents/adversarial-reviewer.md` body section "Trigger" lists the auto-trigger surface from §5.1.2
- [ ] `.claude/agents/dual-reviewer.md` description includes "Auto-invoked from feature-coordinator's branch-level review pass"
- [ ] `.claude/agents/dual-reviewer.md` body section "Local-development-only" includes the auto-invocation rule from §5.2.4

#### §10.2.3 Documentation updated

- [ ] `CLAUDE.md` agent table lists all five new agents (`spec-coordinator`, `finalisation-coordinator`, `builder`, `mockup-designer`, `chatgpt-plan-review`)
- [ ] `CLAUDE.md` common invocations section includes example invocations for the three coordinators
- [ ] `CLAUDE.md` dual-reviewer rule updated per §5.2.6
- [ ] `architecture.md` does not reference per-chunk pr-reviewer or per-chunk adversarial-reviewer

#### §10.2.4 Housekeeping complete

- [ ] `tasks/mockups/` directory does not exist
- [ ] `prototypes/org-chart-redesign.html` exists
- [ ] No file in the repo (except git history) references `tasks/mockups/`:
  ```bash
  grep -rn "tasks/mockups" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/superpowers/specs
  # Expected output: empty
  ```

#### §10.2.5 Pre-shipment baseline satisfied

Required (must be true before the pipeline PR merges):

- [x] On `main`, `npm run lint` exits 0 — satisfied by PR #246
- [x] On `main`, `npm run typecheck` exits 0 — satisfied by PR #246
- [x] `eslint.config.js` exists at repo root — satisfied by PR #246
- [x] `lint` and `typecheck` scripts in `package.json` — satisfied by PR #246

Optional (recommended follow-up, not gating):

- [ ] `tsconfig.json` contains `"incremental": true` and `"tsBuildInfoFile"`
- [ ] `server/tsconfig.json` contains `"incremental": true` and `"tsBuildInfoFile"`
- [ ] `package.json` `lint` script contains `--cache --cache-location`

#### §10.2.6 Smoke test (post-shipment, optional)

After the pipeline ships, run a single smoke-test feature through it end-to-end:

1. Pick a small Standard-class feature
2. Type `spec-coordinator: <brief>` in a fresh session
3. Walk through Phase 1 to handoff
4. Open new session, type `launch feature coordinator`
5. Walk through Phase 2 to handoff
6. Open new session, type `launch finalisation`
7. Complete Phase 3 to ready-to-merge label

Smoke-test acceptance:

- All three coordinators ran without manual model switching
- Branch-sync executed at S0 / S1 / S2 (operator confirms via commit history)
- All five gates G1 / G2 / G3 / G4 / G5 ran (operator confirms via the per-coordinator progress.md log)
- `tasks/current-focus.md` transitioned `NONE → PLANNING → BUILDING → REVIEWING → MERGE_READY`
- Doc-sync gate verdicts recorded for every registered doc
- ready-to-merge label applied; CI green

The smoke test is operator-driven; this spec does not automate it.

### §10.3 Rollout plan and dependencies

#### §10.3.1 Sequencing

```
Step 1 — Lint/typecheck cleanup — DONE (PR #246, merged at eb39ac3e)
Step 2 — Cache enablement PR — OPTIONAL follow-up (§7.5.2, §7.5.3)
         Can land before, with, or after Step 3. Not gating.
Step 3 — This pipeline's PR lands on main:
    — agent files (§10.1.1, §10.1.2, §10.1.3)
    — documentation updates (§10.1.4)
    — housekeeping (§10.1.5)
Step 4 — Smoke test (operator-driven; §10.2.6)
Step 5 — Existing in-flight Phase 2 builds restart on the NEW feature-coordinator
         (architect re-runs from scratch; progress.md is NOT consulted to skip
         already-built chunks; per §10.3.2, this is acceptable — the new coordinator
         re-reviews at branch level anyway, and the handoff.md contract is preserved
         so the spec path and branch context carry over)
Step 6 — All new features start on the NEW pipeline
```

**Operator decision point:** ship Step 3 immediately against the post-PR #246 baseline (~30–60s per gate cold), or wait for Step 2 cache enablement (drops warm runs to ~5–15s). Recommendation: ship Step 3 now; cache enablement can land any time after — the pipeline keeps working either way.

#### §10.3.2 Backwards compatibility

- **In-flight Phase 2 builds at shipment time:** the rewritten `feature-coordinator` reads the same `tasks/builds/{slug}/handoff.md` contract, so an in-flight build that started under the OLD `feature-coordinator` and is mid-build at shipment can be picked up by the NEW one. However, the OLD `feature-coordinator` ran reviewers per-chunk; the NEW one runs them at the end. An in-flight build that's already done some per-chunk reviews has wasted that review work — the NEW coordinator will re-review at the branch level. Acceptable.
- **In-flight Phase 1 specs:** existing specs work unchanged. `spec-coordinator` is purely additive; specs authored by hand without it continue to work.
- **In-flight Phase 3 sessions:** existing `chatgpt-pr-review` sessions are unaffected. `finalisation-coordinator` wraps `chatgpt-pr-review`; running `chatgpt-pr-review` standalone continues to work.

#### §10.3.3 Rollback plan

If the new pipeline causes problems on `main`:

1. Revert the pipeline PR (single commit revert per `rollout_model: commit_and_revert` in `docs/spec-context.md`)
2. Revert the housekeeping migration (`prototypes/org-chart-redesign.html` → `tasks/mockups/org-chart-redesign.html`) only if the housekeeping is the source of the problem
3. Cache enablements stay — they don't depend on the pipeline

The cleanup branch is upstream of this work and stays regardless.

#### §10.3.4 No feature flag

Per `docs/spec-context.md` (`feature_flags: only_for_behaviour_modes`), this spec does NOT introduce a flag to gate the new pipeline. Either the agents are present and active, or they're not (revert the PR).

The OLD `feature-coordinator.md` is fully replaced in the same commit that introduces the rewrite — there is no transitional period where both exist.

---

## Deferred items

- **Codex `plan-reviewer` agent.** The spec adds `chatgpt-plan-review` (manual ChatGPT-web pass on the plan) but does NOT add a Codex pass on the plan. Reason: the spec already gets Codex review via `spec-reviewer`, and the plan derives directly from the spec — a separate Codex-on-plan pass is high overlap. If, after the pipeline runs in production for a quarter, the operator finds plan-level issues that ChatGPT didn't catch but a Codex pass would have, add a sibling agent `plan-reviewer.md` (mirror of `spec-reviewer.md`, points at `tasks/builds/{slug}/plan.md`).
- **Auto-launch one coordinator from the next.** Phase 1 → Phase 2 → Phase 3 transitions all require the operator to open a new session. The current design treats this as a feature (clean context per phase). If session-isolation evolves to support cleanly handing off between sessions automatically, revisit.
- **Automated mid-build sync.** §8.6 documents a manual escape hatch but no automated mid-build sync. If feature-coordinator runs become long enough that drift during Phase 2 causes frequent S2 conflicts, consider adding an auto-sync at chunk boundaries (with the same pause-and-prompt rule). For now, defer.
- **Replacing manual ChatGPT-web with automated OpenAI API for plan review.** `chatgpt-plan-review` is manual-only by design (operator stated explicit preference for ChatGPT-web feedback richness). If the API quality reaches parity, the agent gains an automated mode mirroring `chatgpt-spec-review`'s.
- **`builder` parallelism within a chunk.** Builder runs sequentially file-by-file. If chunks grow large enough that parallel implementation would help, consider invoking multiple builders in parallel. Risk: parallel builders could produce conflicting edits to the same file. Defer.
- **Overgrown progress.md compression.** For large multi-month builds, `progress.md` may accumulate many chunk/gate entries that reduce machine readability. Consider keeping a detailed section for the last N entries and a summarized archive section for older ones. Deferred: pre-production build sizes are insufficient to trigger this; revisit when builds consistently exceed 20+ chunks.
- **Per-phase cost and time budgeting.** Add optional per-phase budget caps (tokens/time) surfaced in `progress.md`. Deferred: cost budgeting is a post-live-agency concern; revisit when first client onboards and `docs/spec-context.md` framing updates to `live_users: yes`.
- **Sub-agent runtime time-cap.** §6.3 explicitly does not cap sub-agent runtime. If a sub-agent hangs (vs taking long), the only recovery is operator interrupt. If hangs become a recurring problem, add a wall-clock cap with hard-escalation on cap. For now, defer.
- **Auto-merge on CI green.** `finalisation-coordinator` does NOT auto-merge after CI green. Operator merges manually via the GitHub UI. If the merge step becomes the bottleneck, consider extending finalisation to auto-merge; this requires a CI-green-detection loop and PR auto-merge wiring.
- **Spec-coordinator handling Standard-class briefs.** Currently Standard briefs run through the full Phase 1. If this is too heavy for small features (e.g. typo fixes, single-file additions), add a fast-path in spec-coordinator that skips mockup-detection, skips chatgpt-spec-review, and produces a thin "spec" that is really just an architect-ready brief. For now, the operator handles Trivial/Standard outside the pipeline (per §1.6).
- **Mission Control dashboard integration.** The mission-control HTML block in `tasks/current-focus.md` is read by `tools/mission-control/`. New status enum values (none introduced here, but the explicit clearing of active fields is new) should be tested against the dashboard. Defer dashboard-side updates if any visual changes are needed.

---

## Open questions

These are flagged for `chatgpt-spec-review` and the operator before agent files land.

1. **Should `spec-coordinator` auto-create a feature branch?** Currently the operator is expected to be on a feature branch before launching `spec-coordinator`. If the operator launches from `main`, S0 sync is meaningless and the subsequent commits would land on `main`. Should `spec-coordinator` refuse to start on `main`/`master`/`develop`, or auto-create a branch named `feat/{slug}` from the current state? The latter is more automated but takes a destructive action without explicit approval.
2. **Where should `tasks/builds/{slug}/handoff.md` live across long pauses?** If the operator pauses Phase 2 for a week (e.g. holiday), the branch may drift significantly. Should `feature-coordinator` snapshot handoff.md to a "paused" archive when status transitions to `PAUSED`? Currently the handoff is a single file that gets overwritten as phases progress; long pauses preserve the latest state but lose history.
3. **`mockup-designer` re-reading `frontend-design-principles.md` every round** — is this the right granularity, or should it re-read only when the doc's mtime changes? Re-reading is cheap but slightly wasteful. Recommend keeping the every-round read for simplicity unless cost becomes an issue.
4. **`chatgpt-plan-review` triage scope.** Plan-level findings split between "plan-content" (sequencing, contracts, primitives) and "spec-content" (the spec itself is wrong). If ChatGPT raises a spec-level finding during plan review, should `chatgpt-plan-review` route it to the spec, route it to `tasks/todo.md`, or refuse? Recommendation: route to `tasks/todo.md` under a new section `## Spec-level findings raised during plan review — {slug}` so the operator triages later.
5. **`finalisation-coordinator` doc-sync sweep vs `chatgpt-pr-review` doc-sync sweep.** Both run a doc-sync sweep — finalisation as a cross-check of chatgpt-pr-review's. If they disagree on a verdict, what's the resolution? Recommendation: `chatgpt-pr-review`'s verdict wins (it ran first and the operator approved the rounds), but `finalisation-coordinator` records both and flags the disagreement.
6. **`adversarial-reviewer` content-based fallback** (§5.1.2) — is the keyword list (`db.transaction`, `withOrgTx`, etc.) correct and complete? It's seeded from `architecture.md`'s sensitive primitives list, but the operator may want to add or remove keywords based on actual experience.
7. **Is the 30-commit freshness threshold (§8.4) appropriate**, or should it scale with the operator's recent push velocity? For now, fixed at 30. Adjust if the operator finds it triggers too often or too rarely.
