# Brief: Development Lifecycle Governance Upgrade

**Slug:** `development-lifecycle-governance-upgrade`
**Status:** Locked — handed to specification (2026-05-14)
**Supersedes:** previous draft of this file (AI-DLC + Skyjed synthesis, 2026-05-14)
**Extends, does not replace:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md` (canonical pipeline contract)

**Purpose:** Upgrade the SynthetOS development lifecycle so it remains fully backwards-compatible with the current spec, build, review and finalisation process, while adding lightweight intent governance, capability registration, and compound learning.

---

## Contents

1. Executive Summary
2. Why This Matters
3. Current State (diagram)
4. Near-Term Target (diagram)
5. Design Principle
6. Scope (in scope)
7. Out of Scope
8. Backwards Compatibility
9. Proposed Implementation Shape (chunks)
10. Acceptance Criteria
11. Recommended Specification Focus
12. Final Positioning

---

## 1. Executive Summary

SynthetOS already has a strong AI-assisted development lifecycle: specification, build planning, construction, review, hardening, finalisation, documentation sync, knowledge capture, and merge readiness. This stays intact.

The gap is not in the build pipeline. The gap is that shipped work is not consistently governed as an ongoing capability after merge. Capabilities lack clear ownership, lifecycle state, risk context, carry cost, review status, and learning feedback.

This upgrade adds a **lightweight governance wrapper** around the existing lifecycle. It does not replace the lifecycle. The near-term target is:

> Current build lifecycle + structured intent + lightweight elaboration + duplication / strategy check + lifecycle-aware spec fields + capability registration before merge + compound learning feedback.

---

## 2. Why This Matters

AI-speed development compresses the build cycle, but it does not remove lifecycle obligations. The Skyjed material names this the **governance gap**: features ship faster than the organisation can track ownership, lifecycle cost, risk, performance, strategic alignment, and decommission readiness.

The current SynthetOS lifecycle already aligns with the AI-DLC principle of *plan first, execute second, verify continuously*. The AWS / Skyjed talk explicitly warns against single-shotting complex work to AI and recommends human alignment, AI planning, execution against agreed plans, and human verification.

This upgrade preserves that strength and adds portfolio-level governance so SynthetOS can scale without accumulating unmanaged capabilities.

---

## 3. Current State Diagram

Reference: attached "Current Development Lifecycle" diagram. Linear pipeline — Operator Intent → Specification → Build Planning → Construction → Review and Hardening → Finalisation → Merge. Strength: strong control over specs, plans, builds, reviews, tests, merge readiness. Gap: limited governance of the capability after merge.

## 4. Near-Term Target Diagram

Reference: attached "Proposed Development Lifecycle" diagram. Same backbone, plus: Clarify Intent → Align Product/Engineering/Risk Context → Duplication or Strategic Drift check → Write and Review Spec → Approve Build Plan → Build with AI Agents → Run Quality and Review Gates → Finalise Docs and Knowledge → Merge → Register Capability → Govern Capability Portfolio. Compound Learning Feedback feeds **forward** into future builds (template / agent / hook / test updates), not back into the current spec.

**Diagrams are explanatory artefacts only.** The implementation contract is the written lifecycle, artefact, and gate requirements in this brief. Where the diagram and the prose disagree, the prose wins.

---

## 5. Design Principle

The current lifecycle is the build engine. The proposed additions are the governance wrapper. Nothing in this upgrade should weaken or bypass existing lifecycle gates.

This mirrors the SynthetOS architecture principle: the Control Plane governs and the Execution Plane executes. The development lifecycle should follow the same pattern.

---

## 6. Scope (in scope)

### 6.1 Structured Intent (replaces today's `brief.md` for Standard+ builds)

For non-trivial builds, the existing `tasks/builds/{slug}/brief.md` becomes a structured `intent.md`. Trivial builds may keep the freeform `brief.md`. The spec must state the cutover rule clearly so future sessions do not maintain both.

Required `intent.md` sections:

| Field | Purpose |
|---|---|
| Problem statement | What are we solving? |
| Desired outcome | What should be true when complete? |
| Non-goals | What are we explicitly not doing? |
| Affected capability area | Which existing capability cluster does this touch? (must reference the closed cluster list in §6.5) |
| User / operator impact | Who benefits or is affected? |
| Risk surface | From the §5.1.2 taxonomy below — must match the adversarial-reviewer auto-trigger vocabulary |
| Key assumptions | What must be true for the work to make sense? |
| Open questions | What needs resolution before spec approval? |
| Duplication / strategy check | Output of §6.3 |

**Risk surface taxonomy (canonical, reused from `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md` §5.1.2):**
server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, webhook handlers, billing surfaces, external messaging, agent runtime, approvals. Selecting any of these flags the build for `adversarial-reviewer` auto-invocation during construction — the intent declaration and the construction-time trigger share one vocabulary.

This stays lightweight. It is not a replacement for the spec.

**Migration rule (`brief.md` → `intent.md`):**
- Existing `tasks/builds/{slug}/brief.md` files remain valid historical artefacts. Do not retro-rewrite.
- New Standard+ builds use `intent.md` only.
- For an in-progress Standard+ build that already has `brief.md`, the next coordinator touching it must either (a) promote `brief.md` into `intent.md`, or (b) record in `progress.md` why promotion is not required.
- Do not maintain both `brief.md` and `intent.md` as active authoritative artefacts for the same Standard+ build unless `intent.md` explicitly supersedes `brief.md`.

### 6.2 Lightweight Elaboration

> **v1 implementation note (2026-05-14):** Elaboration is captured *inside* Intent intake for v1 — it is not represented as a separate lifecycle step. The brief's references to a distinct "Elaboration" stage (including the lifecycle ordering in §1 and §9 Chunk 7) describe the conceptual decomposition, not the runtime contract. The runtime lifecycle implemented in `CLAUDE.md`, `spec-coordinator.md`, and `feature-coordinator.md` is: Intent → Duplication / Strategy Check → Specification → Build Planning → Construction → Review → Finalisation → Merge → Capability Registration → Compound Learning. The elaboration checks below run as fields/prompts within the Intent intake schema rather than as a standalone stage.

A Stage 0 ritual before specification. Not a formal workshop for every build. The required outcome: product, engineering, and risk perspectives have been considered before the spec is written.

- Trivial / Standard: operator may complete inline, single-pass.
- Significant / Major: require an explicit elaboration pass with notes captured into `intent.md`.

Minimum checks:
- **Product:** is this valuable and aligned with the current roadmap?
- **Engineering:** does this fit the current architecture? Any obvious conflicts with existing patterns?
- **Risk:** does this touch auth, data, execution, billing, approvals, or customer-impact surfaces?

### 6.3 Duplication and Strategy Check (hard gate)

Before spec authoring proceeds, check whether the requested capability duplicates or overlaps existing product surface, and whether it still serves the current strategy.

Sources consulted:
- `docs/capabilities.md` (Asset Register)
- Relevant architecture docs
- Existing build artefacts under `tasks/builds/`
- Code search / code intelligence cache (`references/project-map.md`, import-graph) if available

**Expected output (captured in `intent.md`):**

| Field | Allowed values |
|---|---|
| Duplication check | clear / partial overlap / likely duplicate |
| Strategic fit | clear / questionable / not aligned |
| Recommendation | proceed / revise / merge with existing capability / stop |

**Hard gate behaviour:** if recommendation is `stop` or `merge with existing`, `spec-coordinator` must escalate to the operator before authoring proceeds. Advisory-only is not acceptable — without a gate this check will be skipped under time pressure.

The goal is to prevent Ghost R&D, named in the Skyjed playbook as a predictable failure mode when AI-speed development outpaces portfolio governance.

### 6.4 Lifecycle-Aware Spec Authoring

There is no checked-in spec template file today — specs are authored freeform by `spec-coordinator`. The lifecycle and ABCd blocks must therefore land in **authoring instructions**, not a template file alone. Required changes:

- `.claude/agents/spec-coordinator.md` Step 6 (authoring instructions) — add a mandatory "Lifecycle Declaration" and "ABCd Lifecycle Estimate" section to every spec it produces.
- `docs/spec-authoring-checklist.md` — add the same two sections to the pre-authoring rubric.
- Optional: a new `docs/spec-template.md` reference file that the agent and operator can copy from. Decide during spec phase whether the file is worth the maintenance cost.

**Lifecycle Declaration block (required in every Standard+ spec):**

| Field | Required |
|---|---|
| Capability cluster | yes (from §6.5 closed list) |
| Capability owner | yes (or explicit placeholder) |
| Lifecycle state on launch | yes (Inception / Growth) |
| Risk surface | yes (from §6.1 taxonomy) |
| Review cadence | yes |

**ABCd Lifecycle Estimate block (required in every Standard+ spec):**

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S / M / L | cost to understand, scope, and decide |
| Build | S / M / L | cost to implement and integrate |
| Carry | S / M / L | ongoing maintenance, monitoring, support, compliance |
| decommission | S / M / L | cost and complexity of safe retirement |

**Sizing is deliberately three-bucket (S / M / L), not numeric.** The point is making Carry and decommission cost *visible* before launch, not pseudo-precise accounting. Numeric estimates degrade to noise within two sprints.

### 6.5 Capability Registration Before Merge (via doc-sync)

Before `finalisation-coordinator` transitions to `MERGE_READY`, `docs/capabilities.md` must be updated so every governed capability change is reflected in the Asset Register.

**When registration is required (trigger rule):**
Capability registration is required when the PR creates, materially changes, exposes, retires, or changes ownership / risk posture of a product capability, agent capability, skill, integration, execution environment, approval surface, customer-facing workflow, or governed platform primitive. It is **not** required for every non-trivial PR.

**Capability registration outcomes (must be one of):**
- create new capability record
- update existing capability record
- split existing capability record (one capability becomes two or more)
- merge with existing capability record (absorbed into an existing entry)
- n/a with reason

Most builds will be `update existing` — this keeps the register from fragmenting into one row per PR.

**Integration point:** add a new row to the trigger table in `docs/doc-sync.md`. Capability registration is verdicted by the existing doc-sync investigation procedure — single enforcement mechanism, not two parallel ones. The verdict supports the same `yes / no / n/a with reason` pattern doc-sync already uses.

**Valid `n/a` reasons (must be captured in the verdict):**
- docs-only change
- test-only change
- internal refactor with no capability surface change
- build / tooling change only

**Asset Register fields (`docs/capabilities.md`):**

| Field | Required |
|---|---|
| Capability ID / slug | yes |
| Name | yes |
| Description | yes |
| Owner | yes (or explicit placeholder per the rule below) |
| Capability cluster | yes |
| Lifecycle state | yes |
| Launch source | yes — link to build slug or PR |
| Risk surface | yes |
| Last review date | yes |
| Carry cost notes | yes |
| Decommission notes | yes |
| Related docs | yes |

**Lifecycle states:** Inception, Growth, Mature, Declining, Sunset Candidate, Sunset. Most new capabilities launch as Inception or Growth.

**Owner placeholder rule:** placeholders are practical but dangerous if they persist. Any placeholder owner must include:
1. A **temporary accountable reviewer** (a named human who will field questions until the permanent owner is assigned).
2. An **owner-resolution follow-up task** in `tasks/todo.md`.
3. A **resolution due date** captured on the Asset Register row.

Without these three, "TBD" silently becomes the owner of the portfolio.

**Closed starter list of capability clusters (seeded in `docs/capabilities.md` before the gate goes live):**
Workflow Engine, Approvals, Identity & Auth, Reporting, Integrations, Agent Runtime, Admin & Ops, Billing, Memory & Knowledge, Audit & Governance.

Builds may not invent new cluster names without updating this list in the same PR. Without a closed list the register fragments within a quarter.

**Auto-population hint:** at finalisation, the capability-registration step should pre-fill the Asset Register row from `intent.md` (capability area, risk surface) and the spec's Lifecycle Declaration (owner, cluster, state, review cadence). Operator confirms; operator does not re-type.

### 6.6 Compound Learning Feedback (feed-forward)

After `finalisation-coordinator` runs `KNOWLEDGE.md` pattern extraction (existing Step 7), add a lightweight feedback decision step.

**Critical framing: feed-forward, not feedback-into-current-spec.** Lessons update templates, agents, hooks, tests, and docs that affect *future* builds. They do not mutate the current spec — the current build is finalising. The diagram's "lessons" arrow goes to a future-builds connector, not back into the current spec.

For each meaningful lesson, decide whether it should update:

| Target | Example |
|---|---|
| Spec authoring instructions | add a missing lifecycle field |
| Plan template | add a required sequencing check |
| Agent instruction (fixed shortlist) | `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`, `pr-reviewer`, `architect`, `builder` |
| Hook / grep gate | catch recurring mistake automatically |
| Regression test | add protection for the specific failure mode |
| Context pack | improve future context loading |
| Documentation | update architecture or process docs |
| No further action | lesson logged but does not warrant systemic change |

**Agent target is a fixed shortlist of six.** The full fleet is ~25 agents — opening the decision to all of them slows the operator and dilutes the feedback. If a different agent genuinely needs an update, surface it as a separate follow-up in `tasks/todo.md`.

**Initial behaviour:** the step produces a proposed list of follow-up changes for operator approval. No auto-apply in v1.

---

## 7. Out of Scope (deferred to later builds)

Do not include in the near-term spec:

| Excluded item | Reason |
|---|---|
| Decommission coordinator | Premature until the Asset Register exists and has real entries to act on |
| Automated Lifecycle Health Score | Start with fields and manual review; scoring engine is a later build |
| Regulatory continuous monitor | Too heavy for v1; later iteration can become a policy / security-drift monitor |
| Stream coordinator | Multi-stream parallel work increases process complexity; defer |
| Mob-builder | Useful only for risky chunks once the normal lifecycle is stable |
| Quarterly portfolio coherence automation | Begin as manual leadership review later |
| ML-based lifecycle scoring | Not needed for v1 |
| Full portfolio dashboard UI | Markdown register is enough for v1 |

**V1 implementation constraint (binding):** v1 must be enforceable through markdown artefacts, coordinator instructions, doc-sync verdicts, and lightweight static checks only. Do **not** introduce database schema, UI, background jobs, dashboards, scoring engines, scheduled monitors, or new coordinators in this build. This is a hard constraint, not a guideline — it prevents the governance wrapper from drifting into a product-feature build.

---

## 8. Backwards Compatibility (hard requirement)

The implementation must preserve every existing stage and gate:

| Current stage / artefact | Must remain |
|---|---|
| Specification | yes |
| Spec review loops (`spec-reviewer`, `chatgpt-spec-review`) | yes |
| Build planning (`architect`) | yes |
| Human plan gate | yes |
| Chunked construction (`builder`) | yes |
| G1 / G2 / G3 / G4 gates | yes |
| Reviewer matrix (GRADED posture per CLAUDE.md) | yes |
| `finalisation-coordinator` | yes |
| `docs/doc-sync.md` sweep | yes (extended, not replaced) |
| `KNOWLEDGE.md` pattern extraction | yes (extended, not replaced) |
| `MERGE_READY` label flow | yes |

New governance steps **wrap or extend** the lifecycle. They must not replace existing gates.

---

## 9. Proposed Implementation Shape (chunks)

The spec author should refine these; this is a starting decomposition for the architect.

### Chunk 1: Structured intent artefact
- Rename / reshape `tasks/builds/{slug}/brief.md` → `intent.md` for Standard+ builds; preserve `brief.md` path for Trivial.
- Update `spec-coordinator` Step 3 (brief intake) to require `intent.md` with the §6.1 fields when classification is Standard or higher.
- Add a minimal intent template the agent fills with operator help.

### Chunk 2: Lifecycle-aware spec authoring
- Update `.claude/agents/spec-coordinator.md` Step 6 to require a Lifecycle Declaration block and an ABCd Lifecycle Estimate block in every Standard+ spec.
- Update `docs/spec-authoring-checklist.md` accordingly.
- Decide during spec phase whether to add a `docs/spec-template.md` reference file.

### Chunk 3: Duplication and Strategy Check gate
- Extend `spec-coordinator` to run §6.3 before authoring.
- Capture the three required outputs in `intent.md`.
- Implement the hard gate: `stop` or `merge with existing` escalates to operator before authoring proceeds.

### Chunk 4: Asset Register upgrade
- Convert `docs/capabilities.md` into the Asset Register structure (§6.5 fields).
- Seed the closed capability-cluster list before the gate goes live.
- Backfill existing capabilities into the new structure as a one-time pass.
- **Implementation guidance for the spec author:** preserve useful existing content. Treat the first pass as a **structure-preserving backfill**, not a wholesale replacement. Keep current capability descriptions, map them into the new Asset Register fields, and mark unknowns with explicit placeholders plus follow-up tasks in `tasks/todo.md`. Do not delete content the operator may need; route ambiguity to follow-up rather than discarding it.

### Chunk 5: Capability Registration gate via doc-sync
- Add the new trigger row to `docs/doc-sync.md`.
- Extend `finalisation-coordinator` Step 6 (doc-sync sweep) to investigate / verdict capability registration with valid `n/a` reasons.
- Implement auto-population of the Asset Register row from `intent.md` + Lifecycle Declaration.

### Chunk 6: Compound Learning Feedback step
- Extend `finalisation-coordinator` after Step 7 (KNOWLEDGE.md extraction) with the §6.6 decision step.
- Use the fixed shortlist of six agents.
- Frame as feed-forward — output is a proposal list for operator approval, no auto-apply in v1.

### Chunk 7: Process documentation sync
- Update `CLAUDE.md`, `architecture.md`, and any context-pack references to describe the revised lifecycle:
  Intent → Elaboration → Duplication / Strategy Check → Specification → Build Planning → Construction → Review → Finalisation → Merge → Capability Registration → Compound Learning.
- `current-focus.md` capability reference is **optional in v1** and should only be added if it does not require broader schema migration. If a schema migration would be needed, defer to a later build.

---

## 10. Acceptance Criteria

A spec created from this brief must satisfy:

### Functional
- Non-trivial builds produce a structured `intent.md` (or equivalent intent section).
- Specs include the Lifecycle Declaration block.
- Specs include the ABCd Lifecycle Estimate block (S / M / L sizing).
- `docs/capabilities.md` supports Asset Register records per §6.5.
- Finalisation requires capability registration before `MERGE_READY`, unless an explicit `n/a` reason is captured in the doc-sync verdict.
- Finalisation includes compound-learning feedback routing after `KNOWLEDGE.md` extraction.

### Backwards Compatibility
- Existing spec, plan, build, review, and finalisation flow remains intact.
- Existing gates (S0/S1/S2, G1/G2/G3/G4) are not removed or weakened.
- Existing reviewer matrix (GRADED posture) is preserved.
- Existing `KNOWLEDGE.md` extraction is preserved.
- Existing `MERGE_READY` flow is preserved.

### Governance
- Every shipped capability has an owner (or an explicit owner placeholder).
- Every shipped capability has a lifecycle state.
- Every shipped capability has risk-surface notes drawn from the §6.1 taxonomy.
- Every shipped capability has carry-cost notes.
- Every shipped capability has decommission notes, even if minimal.
- Every exempted build has a clear reason in the doc-sync verdict.

---

## 11. Recommended Specification Focus

The development specification should focus on process artefacts, templates, and gates first. Avoid building complex automation in v1.

Priority order for the spec author:

1. Template / authoring-instruction changes (`spec-coordinator`, `spec-authoring-checklist`).
2. Finalisation checklist changes (`finalisation-coordinator` Steps 6 and 7+).
3. Asset Register structure (`docs/capabilities.md`).
4. Capability Registration gate (via `docs/doc-sync.md`).
5. Compound Learning Feedback step.
6. Light validation scripts only if simple.

Do **not** start with dashboards, scoring engines, ML, scheduled audits, or new coordinators.

---

## 12. Final Positioning

This upgrade makes SynthetOS development more governable without slowing the existing build engine.

> We are not replacing the current AI-assisted development lifecycle. We are preserving the current lifecycle and adding the missing governance wrapper: better intent, less duplication, lifecycle-aware specs, capability registration, and compound learning.

This is the smallest practical step toward governed speed.

---

End of brief.
