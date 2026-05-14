# AI-DLC + Lifecycle Governance — Brief for Diagramming

Source inputs: AWS Summit Sydney 2026 AI-DLC talk (Teddy / Kenny / Stephen Brown), Skyjed *Build at 15-20x Speed* whitepaper, Skyjed *Product Lifecycle Governance Playbook 4.0*.

Audience for the diagrams: leadership / strategic review. The two flows below are written as labelled stages with explicit inputs, actors, gates, and outputs so a diagramming LLM can render them as side-by-side flowcharts.

## Contents

1. Current development flow (as built in this codebase)
2. Proposed development flow (AI-DLC + Skyjed-informed)
3. Gold nuggets from the talk and papers worth applying
4. Recommended sequencing
5. Diagram-ready node lists (for the LLM that will draw the flowcharts)

---

## 1. Current development flow (as built in this codebase)

### Stage 0 — Intake
- Actor: operator (human) + main Claude session.
- Input: free-text brief or rough spec topic.
- No cross-functional ritual. Single-author intake.
- Output: build slug, `tasks/builds/{slug}/brief.md`.

### Stage 1 — Specification (Phase 1 / `spec-coordinator`)
- Steps: context load, S0 branch sync + freshness check, brief intake + UI-touch detection, mockup loop (if UI-touch, via `mockup-designer`), spec authoring, `spec-reviewer` (Codex loop, max 5 iterations), `chatgpt-spec-review` (manual ChatGPT-web rounds), handoff write.
- Output: `tasks/builds/{slug}/spec.md`, `handoff.md` (`PHASE_1_COMPLETE`), `current-focus.md` → `BUILDING`.

### Stage 2 — Construction (Phase 2 / `feature-coordinator`)
- Steps: context load, S1 sync + migration-collision check, `architect` decomposes spec into chunks (<5 files each), `chatgpt-plan-review` (manual), plan gate (operator approves), per-chunk `builder` loop (Sonnet) with G1 gate (lint + typecheck + targeted unit tests), G2 integrated lint/typecheck, branch-level GRADED review pass.
- Review pass order: `spec-conformance`, `adversarial-reviewer` (if §5.1.2 security surface), `pr-reviewer`, `reality-checker`, fix-loop + G3, `dual-reviewer` (Codex, if available; else `REVIEW_GAP`).
- Output: implemented code on branch, `plan.md`, `progress.md`, `handoff.md` (`PHASE_2_COMPLETE`), `current-focus.md` → `REVIEWING`.

### Stage 3 — Finalisation (Phase 3 / `finalisation-coordinator`)
- Steps: context load + `REVIEW_GAP` check, S2 branch sync (auto-resolve append-only artefacts), G4 regression guard (`audit-runner` hotspot on changed files), PR existence check / create, `chatgpt-pr-review` (manual rounds), full doc-sync sweep per `docs/doc-sync.md`, `KNOWLEDGE.md` pattern extraction, `tasks/todo.md` cleanup, `current-focus.md` → `MERGE_READY` + apply `ready-to-merge` label (CI runs).
- Output: PR ready, branch sync verified, docs aligned, knowledge logged.

### Cross-cutting layers (current)
- **Task classification** (Trivial / Standard / Significant / Major) scales the reviewer matrix.
- **Append-only artefacts** under `tasks/builds/{slug}/`.
- **Compound engineering** lives in `KNOWLEDGE.md` (append-only, human-curated; lessons feed future sessions via context load, not automatic agent updates).
- **ADRs** under `docs/decisions/` for durable choices.
- **Context packs** for mode-scoped loading.
- **Code intelligence cache** (`references/project-map.md`, import-graph JSON) for fast cross-file reasoning, referenced in CLAUDE.md but not yet populated in this repo.
- **Capabilities registry** (`docs/capabilities.md`) is a list only. No lifecycle stamps, no health score, no cost-of-carry, no decommission tracking, no shadow-portfolio audit.

### What current flow does well
1. Three-phase split with explicit gates (S0/S1/S2 sync, G1-G4 quality) matches AI-DLC Inception / Construction / Operations cleanly at the *project* level.
2. Plan-first principle is enforced. `spec-reviewer`, `chatgpt-spec-review`, `chatgpt-plan-review` all gate before code is written.
3. Human-in-the-loop at moments that matter: plan gate, operator approval on user-facing findings, MERGE_READY gate.
4. AI treated as specialist team, human as orchestrator (`builder` is Sonnet, reviewers are specialised, main session is the developer).
5. Parallel reviewer specialisation already mirrors the AI-DLC "collective context" idea at the *review* end.

### What current flow lacks
- **Inception is single-author.** No Mob Elaboration ritual, no structured cross-functional intent-gathering session (product, engineering, design, target-user-proxy) before the spec is drafted. The brief enters as one person's interpretation.
- **No portfolio-level lifecycle.** Every cycle ends at "merged"; there is no Stage 4 that registers the new capability in a governed asset register with a lifecycle state, owner, and health score.
- **No ABCd cost framing.** Specs and plans estimate Build effort only. Carry cost (ongoing test, monitoring, compliance) and decommission cost are invisible at decision time.
- **No shadow-portfolio audit.** `audit-runner` works at code level; nothing maps production surface (routes, endpoints, capabilities) back to `docs/capabilities.md` to surface live-but-ungoverned features.
- **No decommission practice.** There is no fourth coordinator for deprecation; sunsets happen ad-hoc or not at all, so decommission debt accumulates silently.
- **No continuous regulatory / compliance monitoring.** `adversarial-reviewer` runs diff-based on §5.1.2 surface; it does not re-evaluate the existing portfolio when regulations or threat models shift.
- **No portfolio coherence check.** Each feature is governed; the portfolio-as-whole has no scheduled coherence review against current strategy, so Ghost R&D risk is real.
- **Compound engineering is manual.** Corrections land in `KNOWLEDGE.md`, but nothing auto-decides whether the correction also warrants an agent-definition edit, a hook, a regression test, or a doc update. The "play it back to the entire solution" pattern from the talk is partly missing.
- **Parallel streams unstructured.** Worktrees exist; there is no formal pattern for running a primary spec-driven stream + change-request side stream + vibe-coding stream concurrently without collision. `current-focus.md` is sprint-singular.

---

## 2. Proposed development flow (AI-DLC + Skyjed-informed)

Re-cast as a continuous loop, not a linear pipeline. Three project-level phases remain, plus a portfolio-level governance loop and a compound-learning loop running underneath.

### Stage 0 — Mob Elaboration (NEW)
- Actor: operator + product proxy + engineering proxy + (if UI) design proxy + (if regulated surface) compliance proxy. Roles can collapse onto one human; the *ritual* is what matters.
- Process: collective brain-dump, AI-led Q&A unpacking ambiguity, reverse-engineering pass against existing codebase patterns, capabilities, and constraints, validated assumptions log.
- Gate: Ghost-R&D check. Capability-similarity scan against `docs/capabilities.md` plus code-pattern search via the code intelligence cache. Surface any overlap before drafting spec.
- Output: `tasks/builds/{slug}/intent.md` (collective context, validated assumptions, ABCd lifecycle cost estimate, regulatory obligations).

### Stage 1 — Specification (enhanced)
- Existing flow, plus:
  - Spec template now includes an **ABCd table** (Acquire / Build / Carry / decommission estimated cost or effort).
  - Spec template now includes a **lifecycle declaration** (which capability cluster, intended maturity stage on launch, intended sunset criteria).
  - Spec-reviewer adds a "duplication-vs-portfolio" check as a Ghost R&D blocker.

### Stage 2 — Construction (enhanced)
- Existing per-chunk loop, plus:
  - **Mob Construction option** for risky chunks (schema migration, RLS change, cross-cutting): invoke `mob-builder`, which runs two `builder` sub-agents in parallel against the same chunk, with `dual-reviewer` adjudicating. The existing `dual-reviewer` is the seed.
  - **Parallel-stream framework**: `current-focus.md` becomes multi-stream. A `stream-coordinator` registers each active stream (primary / change-request / experiment), allocates worktrees, and prevents file collision. Enables the three-streams-in-parallel pattern Stephen described.

### Stage 3 — Finalisation (enhanced)
- Existing flow, plus:
  - **Capability registration step**: before `MERGE_READY`, update `docs/capabilities.md` with lifecycle state, owner, ABCd actuals, regulatory obligations, and an initial Lifecycle Health Score baseline.
  - **Compound-engineering playback**: a `lessons-feedback` agent runs after `KNOWLEDGE.md` pattern extraction. For each new lesson it decides, and proposes, whether to also (a) update an agent definition, (b) add a hook, (c) add a doc-sync trigger, (d) add a regression test, (e) update a context pack. Operator approves before changes apply.

### Stage 4 — Operations & Portfolio Governance (NEW, continuous)
Runs continuously, not per-build. Outputs are visible to leadership.

- **Live Asset Register**: `docs/capabilities.md` becomes lifecycle-stamped (Inception / Growth / Mature / Declining / Sunset-candidate / Sunset), with owner, last-review-date, ABCd actuals, current Lifecycle Health Score. Updated on every merge by a new `capability-registrar` agent.
- **Lifecycle Health Score** (Skyjed framework): scored per capability on four dimensions, namely strategic alignment, performance signals (errors, usage, support load), risk exposure (security debt, dependency age, regulatory drift), and lifecycle-stage appropriateness. Surfaces in a `tasks/portfolio-health.md` dashboard.
- **Shadow-portfolio audit** (new `audit-runner` mode `portfolio-shadow`): scheduled (for example, monthly) cross-reference of production surface (routes, endpoints, feature flags, exposed agents/skills) against the Asset Register. Any live-but-ungoverned surface is flagged with an owner-assignment task.
- **Decommission coordinator** (Phase D, new): mirrors `feature-coordinator` in reverse. Steps: candidate identification, dependency / customer-impact assessment, deprecation comms + dual-running plan, execute sunset, archive ADR + remove from Asset Register. Decommission debt is then visible and shrinkable.
- **Regulatory / compliance continuous monitor**: extends `adversarial-reviewer` with a regulatory-rules table per capability cluster. Runs on schedule against the full portfolio, not only against branch diffs. Surfaces drift when the threat model or rule set changes.
- **Portfolio coherence review** (quarterly): coherence-check coordinator maps capabilities by current strategic priorities, flags obsolete-priority concentrations and current-priority gaps. Drives strategic decommission candidates.

### Stage 5 — Compound Learning Loop (NEW, continuous, underneath all stages)
- Trigger sources: corrections (existing `KNOWLEDGE.md` hook), reviewer findings repeated more than twice, post-incident write-ups (`incident-commander`).
- Routed by `lessons-feedback` agent into the right artefact (agent def / hook / test / doc / context pack / capability health rule).
- Operator approves; changes ship as a regular Trivial/Standard PR.
- Closes Stephen's "compound engineering" gap by turning one correction into systemic immunisation, not just an appendix entry.

### New / enhanced actors summary
| Actor | New / Enhanced | Role |
|---|---|---|
| Mob Elaboration ritual | New | Stage 0 cross-functional intent gathering |
| `capability-registrar` | New | Updates Asset Register on every merge |
| `lessons-feedback` | New | Compound-engineering playback router |
| `portfolio-health` dashboard | New | Lifecycle Health Score view for leadership |
| `decommission-coordinator` | New | Phase D sunset orchestrator |
| `stream-coordinator` | New | Multi-stream worktree allocator |
| `mob-builder` | New | Parallel-builder pattern for risky chunks |
| `adversarial-reviewer` | Enhanced | Adds portfolio-wide scheduled regulatory monitor |
| `audit-runner` | Enhanced | Adds `portfolio-shadow` audit mode |
| `docs/capabilities.md` | Enhanced | Becomes lifecycle-stamped Asset Register |
| Spec template | Enhanced | Adds ABCd table + lifecycle declaration |

---

## 3. Gold nuggets from the talk and papers worth applying

1. **Collective context before code.** The largest delta in the talk was framing Inception as a *cross-functional ritual*, not a brief handoff. We already gate plans well; we don't gate *intent* well.
2. **AI as team member, human as orchestrator.** We already do this; the talk validates the architecture. No change needed, but worth naming explicitly in onboarding/README.
3. **Compound engineering as a closed loop.** Stephen called this out as a *primary* differentiator. `KNOWLEDGE.md` is the right substrate; the missing piece is the agent that routes a lesson to the right artefact.
4. **Parallel streams without context collision.** Three concurrent workstreams was a striking productivity claim. We have worktrees; we lack the lightweight stream-coordinator.
5. **ABCd lifecycle economics.** Making Carry and decommission visible at *decision time* (in spec / plan) is a small artefact change with outsized governance leverage.
6. **Lifecycle Health Score.** The single most useful import from Skyjed for leadership visibility. Converts code review (per-PR) into capability review (continuous).
7. **Shadow portfolio audit.** The failure mode (features live, ungoverned, accumulating risk) is real even in small codebases. A scheduled audit costs almost nothing and prevents the slow-drift class of failure.
8. **Decommission as first-class workflow.** Most engineering orgs have no decommission rigour. Building it as a coordinator (not a vibe) is a durable advantage.
9. **Continuous regulatory monitoring.** For Syntheos / Automation OS the regulatory surface is lower than financial services, but the *principle*, namely re-evaluate the portfolio when the rule set changes, not just at build time, applies to security/threat-model drift.
10. **Portfolio coherence as a metric.** Quarterly check that the capability portfolio still serves current strategy. Drives strategic decommission, not just operational sunset.

---

## 4. Recommended sequencing (if we pursue this)

Not a commitment, just a recommended order if the user wants to act:

1. **Quick wins** (one or two sessions each): ABCd table in spec template; lifecycle declaration in spec template; `capability-registrar` agent; lifecycle stamps added to `docs/capabilities.md`; `portfolio-shadow` audit-runner mode.
2. **Medium** (one build cycle each): `lessons-feedback` compound-engineering agent; Mob Elaboration ritual codified as Stage 0 playbook; `portfolio-health.md` dashboard with Lifecycle Health Score.
3. **Larger** (multi-cycle): `decommission-coordinator`; `stream-coordinator` and multi-stream `current-focus.md`; `mob-builder` parallel-builder pattern; quarterly coherence review automation.

---

## 5. Diagram-ready node lists (for the LLM that will draw the flowcharts)

### Current flow nodes (left diagram)

Linear left-to-right pipeline:

```
Brief
  → Phase 1: spec-coordinator
      [S0 sync, mockup-loop (conditional), spec-reviewer, chatgpt-spec-review]
  → handoff
  → Phase 2: feature-coordinator
      [S1 sync, architect, chatgpt-plan-review, plan-gate,
       builder × N + G1, G2,
       spec-conformance, adversarial (conditional), pr-reviewer,
       reality-checker, fix-loop + G3, dual-reviewer (conditional)]
  → handoff
  → Phase 3: finalisation-coordinator
      [S2 sync, G4 audit, chatgpt-pr-review, doc-sync, KNOWLEDGE.md,
       MERGE_READY label]
  → Merge → END
```

Underlying constant (bottom band): `KNOWLEDGE.md` (manual append-only).

### Proposed flow nodes (right diagram)

Two horizontal tracks plus a band underneath:

**Top track (per-feature, same three phases, enhanced):**

```
Stage 0: Mob Elaboration
    [collective brain-dump, AI Q&A, reverse-engineer, Ghost-R&D check]
    → intent.md (incl. ABCd estimate + regulatory obligations)
  → Phase 1: spec-coordinator (+ABCd table, +lifecycle declaration,
                               +portfolio-duplication check)
  → Phase 2: feature-coordinator (+mob-builder option for risky chunks,
                                  +stream-coordinator)
  → Phase 3: finalisation-coordinator (+capability-registrar,
                                       +lessons-feedback)
  → Merge → Asset Register entry
```

**Bottom track (continuous, portfolio-level, runs underneath):**

```
Live Asset Register (lifecycle-stamped docs/capabilities.md)
  ↔ Lifecycle Health Score (4 dims)
  ↔ Shadow-portfolio audit (scheduled audit-runner mode)
  ↔ Regulatory continuous monitor (extended adversarial-reviewer)
  ↔ Portfolio coherence review (quarterly)
  ↔ Decommission coordinator (Phase D)
```

**Underlying band (touches both tracks):**

```
Compound Learning Loop
  (lessons-feedback agent routes corrections →
   agent defs / hooks / tests / docs / context packs)
```

**Edge labels between tracks:**
- Every per-feature merge writes into the Asset Register.
- Every Asset Register signal (declining health, regulatory drift, coherence flag) can launch either a feature cycle (improve) or a Phase D cycle (decommission).
- Every correction (from review, incident, or operator) feeds the Compound Learning Loop, which can update any agent or doc used in either track.

### Suggested visual treatment
- Current diagram: linear arrow chain, single colour, single lane.
- Proposed diagram: two lanes (per-feature on top, portfolio-governance on bottom), with vertical arrows connecting them at merge points and at health-trigger points; the compound-learning band sits beneath both with dashed upward arrows touching every named agent.
- Use one accent colour for *new* nodes (Mob Elaboration, capability-registrar, lessons-feedback, Asset Register, Health Score, Shadow audit, Regulatory monitor, Coherence review, Decommission coordinator, stream-coordinator, mob-builder) so the delta vs current is obvious at a glance.

---

End of brief.
