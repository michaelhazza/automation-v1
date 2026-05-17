# Plan — development-lifecycle-governance-upgrade

**Build slug:** development-lifecycle-governance-upgrade
**Branch:** claude/ai-driven-dev-lifecycle-FRqBd
**Spec:** [tasks/builds/development-lifecycle-governance-upgrade/spec.md](./spec.md) (locked — approved by spec-reviewer + chatgpt-spec-review 3 rounds APPROVED)
**Plan author:** architect (Opus)
**Plan date:** 2026-05-14
**Task class:** Significant (markdown-only, no runtime code path)

---

## Contents

1. Architecture notes
2. Model-collapse check
3. Chunks
   - Chunk 1 — Intent artefact + spec-coordinator Step 3 intake
   - Chunk 2 — Lifecycle Declaration + ABCd in spec authoring
   - Chunk 3 — Duplication / Strategy Check hard gate (Step 3a)
   - Chunk 4 — `docs/capabilities.md` Asset Register restructure
   - Chunk 5 — doc-sync trigger row + finalisation Step 6 verdict
   - Chunk 6 — Compound Learning Feedback (Step 7a)
   - Chunk 7 — Process documentation sync (CLAUDE.md + architecture.md)
4. Risks and mitigations
5. Self-consistency pass
6. Executor notes

---

## Architecture notes

### Plain-English summary (read this first)

This build adds a thin governance wrapper around the existing build pipeline so every shipped capability gets tracked properly: who owns it, what state it is in, what risk it carries, what the carry cost is, and what we learned shipping it.

Concretely, it changes how we start a build (a structured `intent.md` instead of a freeform brief, plus a duplication / strategy check before we write the spec), what every spec must include (a Lifecycle Declaration and a rough S/M/L sizing block), how we finalise (`docs/capabilities.md` becomes a proper asset register and finalisation must verdict whether the build changed a capability), and a learning-feedback step that decides where new patterns from a build should land (a spec rule? an agent instruction? a hook? a follow-up task?). All operator-driven, all markdown.

What it does NOT do: no database changes, no UI, no scheduled jobs, no scoring engines, no dashboards, no new gate scripts, no new tests. Every change is to markdown files (`.claude/agents/*.md`, `docs/*.md`, `CLAUDE.md`, `architecture.md`, `tasks/todo.md`). Enforcement is by coordinator instructions and doc-sync verdicts — the existing static gates (`lint`, `typecheck`) keep running as baseline, nothing new is added on top.

### Why this chunking

The spec's §10 already locked the chunk plan (7 chunks, dependency graph, ≤5 files per chunk). This plan translates §10 into the playbook-required fields without redesigning the boundaries. The chunking matches the natural enforcement seams: artefact capture (Chunk 1) → spec-block enforcement (Chunk 2) → strategy gate (Chunk 3) → asset register seeding (Chunk 4) → registration verdict (Chunk 5) → learning feedback (Chunk 6) → process docs sync (Chunk 7). Chunks 1, 2, and 4 are parallel-safe; Chunks 3, 5, 6, 7 are forward-only dependencies.

### Key invariants the plan must preserve

1. **Scope is binding (spec §1).** 0 new schema migrations, 0 new jobs, 0 new services, 0 new routes, 0 new hooks, 0 new gate scripts, 0 new tests. Any chunk that proposes any of these is a spec violation and must be rejected.
2. **File inventory is binding (spec §4), with one named conditional exception.** Default merge diff is **8 modified, 0 new = 8 repo files** (this plan locks `docs/spec-template.md` to "not created" — see Chunk 2). Any file outside §4.1+§4.2 is out of scope **except**: if Chunk 4's backfill finds a capability that does not fit the §7.4.2 closed cluster list (spec §15.1 open question), the §7.4.5 cluster mutation procedure may fire, adding **one new ADR file under `docs/decisions/`** to the merge diff. This is an explicitly-allowed scope extension by spec §15.1 + §7.4.5. The resulting merge diff in that case is 8 modified + 1 new ADR = 9 repo files. Every other deviation from "8 modified" is a violation. The §7.4.5 firing is recorded in `progress.md` with operator confirmation; if it does not fire, the merge diff stays at 8 files.
3. **Order invariants (spec §6).** `spec-coordinator`: Step 3 → 3a → 4 → 5 → 6. `finalisation-coordinator`: Step 6 → 7 → 7a → 8 → 9 → 10. Step 7a never blocks `MERGE_READY`.
4. **Backwards-compat invariants (spec §11).** Existing pipeline (S0/S1/S2 syncs, G1–G4 gates, GRADED reviewer matrix, KNOWLEDGE.md extraction, MERGE_READY flow) is unchanged in step ordering — only the named insertions/edits differ.
5. **Reviewer agent files unchanged.** New spec-block enforcement comes through `docs/spec-authoring-checklist.md`, which `spec-conformance` already reads. No reviewer agent file is edited (spec §6.4).
6. **No `feature-coordinator` edit.** Risk Surface flows through the spec's Lifecycle Declaration, which `feature-coordinator` already reads (spec §6.3).

### Cross-cutting risks (full list in §"Risks and mitigations" below)

- Load-bearing-value drift across coordinator-file sections (KNOWLEDGE.md 2026-05-14 pattern — grep-the-old-value pass is mandatory after every Edit).
- Chunk 4 structure-preserving backfill must include post-S1-merge content (PR #301 god-file register entries) — author cannot rely on the spec's snapshot view.
- Chunk 7 architecture.md edit must not clobber PR #303 (Rule 16 audit framework section).
- Capability Registration verdict for this build itself runs in Phase 3 (finalisation), not Phase 2.

### Source-of-truth precedence (carried from spec §7.6)

- intent.md vs spec Lifecycle Declaration → **spec wins** at finalisation.
- Spec Lifecycle Declaration vs Asset Register row → **Asset Register row wins** for ongoing state.

Plan respects both; neither is touched directly by any chunk's merge diff (both apply at runtime to future builds).

## Model-collapse check

The spec does not propose a runtime pipeline (ingest → extract → transform → render). It proposes markdown contracts and coordinator-instruction edits that govern an operator-driven flow.

Considered collapsing the spec-coordinator Step 3 (intent capture) into a single structured-output LLM call that produces the §7.1 schema directly from the brief. **Rejected** for three reasons:

1. The operator is in the loop on purpose at intent capture — the strategy gate (Step 3a) depends on operator-amendable inputs (Problem Statement, Desired Outcome, Affected Capability Area). A single-call collapse bypasses the amendment cycle when Step 3a returns `revise`.
2. The duplication check at Step 3a runs deterministic greps against `docs/capabilities.md` and `tasks/builds/*/spec.md`. A model call would re-implement that check at lower determinism for no benefit.
3. The audit trail of operator decisions (recorded inline in `progress.md`) is the load-bearing artefact for governance — a hidden model-call decision is worse than a visible operator decision for this domain.

**Decision: reject collapse.** The build is a markdown-only governance overlay on an existing operator-driven pipeline. No new LLM-call path is introduced and none should be.

## Chunks

### Chunk 1 — Intent artefact + spec-coordinator Step 3 intake

- **spec_sections:** §2 G1, §4.2 row 1, §4.3 row 1, §5.1, §6.1 Step 3 row + provisional-slug preamble, §7.1 (intent.md schema including §7.1.0 table and §7.1.1 Risk Surface vocabulary), §10 Chunk 1.

- **Files:**
  - `.claude/agents/spec-coordinator.md` — edit the Step 3 section (currently titled "Step 3 — Brief intake and UI-touch detection"). Edit anchor: the section heading at line ~115 ("## Step 3 — Brief intake and UI-touch detection") and the prose immediately below. Rename to "Step 3 — Intent intake and UI-touch detection".

- **Contracts (what the file says after the edit):**
  - Step 3 branches on classification: `Trivial` → existing `brief.md` flow (unchanged); `Standard | Significant | Major` → produce `tasks/builds/<provisional-slug>/intent.md` matching spec §7.1 schema before proceeding to Step 4.
  - The §7.1 schema's nine required H2 sections are reproduced verbatim inside the Step 3 instructions (Problem Statement, Desired Outcome, Non-Goals, Affected Capability Area, User / Operator Impact, Risk Surface, Assumptions, Open Questions, Duplication / Strategy Check).
  - The §7.1 field rules table is reproduced (or referenced explicitly with a "see spec §7.1 for field rules" pointer that names the spec file path under `tasks/builds/development-lifecycle-governance-upgrade/spec.md`).
  - Provisional-slug rule (spec §6.1 preamble) is reproduced inline: operator nominates a working slug at intent capture so `tasks/builds/<slug>/intent.md` has a writable path; Step 4 ratifies (or renames after Step 3a's outcome) and carries files into the ratified slug directory if renamed.
  - Migration rule (spec §6.1 Step 3 row) is reproduced inline: in-flight Standard+ builds that pre-date this spec keep their existing `brief.md`; new Standard+ builds use `intent.md`; per-build `progress.md` records any voluntary `brief.md → intent.md` upgrade decision; **no retroactive rewriting** of historical `brief.md` files (spec §14 — permanently deferred).
  - Risk Surface canonical vocabulary (spec §7.1.1) reproduced verbatim so the coordinator's Step 3 instructions are self-contained.
  - Existing UI-touch detection prose preserved unchanged.

- **Error handling (coordinator-instruction edge cases):**
  - Classification ambiguous (between Standard and Trivial): coordinator instructions state explicitly that the operator decides; if the operator chooses Standard, intent.md is produced; if Trivial, `brief.md` flow. Recorded in `progress.md`.
  - Provisional slug clashes with an existing `tasks/builds/<slug>/` directory: existing Step 4 prose handles this (append date suffix) — no new edge case introduced by Chunk 1.
  - intent.md authored but Step 4 later renames the slug: provisional-slug rule (carry files into the ratified directory) is reproduced inline; preserves audit trail.

- **Dependencies:**
  - Upstream: none (this is the entry chunk).
  - Downstream unblocks: Chunk 3 (Step 3a inserts between Step 3 and Step 4 and depends on intent.md's schema existing).

- **Acceptance (inspection-based; progress.md evidence required):**
  - Reading `.claude/agents/spec-coordinator.md` end-to-end shows Step 3 explicitly branches on classification (`Trivial` vs `Standard+`).
  - The provisional-slug rule, the migration rule, and the §7.1 schema (with §7.1.1 Risk Surface vocabulary) are reproduced in the Step 3 instructions verbatim or as named references with the spec path.
  - **Implementer dry-run evidence in `progress.md` (Chunk 1 section):**
    - One walkthrough of a Standard classification — confirms intent.md is produced with all nine sections.
    - One walkthrough of a Trivial classification — confirms `brief.md` flow is preserved.
    - Both walkthroughs annotated with "this matches the spec §7.1 schema" / "this matches the existing Trivial flow".
  - **Grep-the-old-value pass (per KNOWLEDGE.md 2026-05-14):** after editing Step 3, grep `.claude/agents/spec-coordinator.md` for the old "Brief intake" phrasing and any references to "the brief is read" / "brief.md" — every hit that needs updating is updated in the same chunk. Hits that legitimately stay (Trivial-flow references to `brief.md`) are confirmed and recorded in `progress.md`.

### Chunk 2 — Lifecycle Declaration + ABCd in spec authoring

- **spec_sections:** §2 G3, §4.1, §4.2 rows 1 and 5, §5.2, §5.3, §6.1 Step 6 row, §6.4 (spec-conformance reuse), §7.2 (Lifecycle Declaration), §7.3 (ABCd), §10 Chunk 2, §14 (spec-template optional deferral).

- **Files:**
  - `.claude/agents/spec-coordinator.md` — edit the Step 6 section ("## Step 6 — Spec authoring"). Edit anchor: the existing required-sections list. Insert two new mandatory blocks (Lifecycle Declaration, ABCd Estimate) into the required-sections list and reference §7.2 / §7.3 by name (and the spec path).
  - `docs/spec-authoring-checklist.md` — edit two locations: (a) add a new sub-section (likely between §10 and §11, or extending §3 Contracts) covering the Lifecycle Declaration + ABCd blocks; (b) append two new boxes to the Appendix pre-review checklist: "Lifecycle Declaration present per spec §7.2" and "ABCd Estimate present with S/M/L sizing only per spec §7.3".
  - **`docs/spec-template.md` is NOT created in this build (plan decision, locked).** The schema lives in `docs/spec-authoring-checklist.md` Appendix (this chunk extends it) and in `.claude/agents/spec-coordinator.md` Step 6 (this chunk extends it). A separate template file would duplicate that content and create a drift risk. If recurring need surfaces in future builds, a follow-up can be raised through the Compound Learning Feedback step (spec §7.5 target `spec-authoring-instructions`) and handled as its own Trivial PR. The implementer does NOT make a create/skip decision in this chunk — the decision is locked here.

- **Contracts (what each file says after the edit):**
  - `.claude/agents/spec-coordinator.md` Step 6: required sections list now includes "Lifecycle Declaration (see spec §7.2 / template below)" and "ABCd Estimate (see spec §7.3 / template below)". The §7.2 table (5 fields: Capability cluster, Capability owner, Lifecycle state on launch, Risk surface, Review cadence) is reproduced inline. The §7.3 table (4 dimensions: Acquire / Build / Carry / decommission with `S | M | L` sizing) is reproduced inline. Launch-state restriction reproduced: `Inception` or `Growth` only at first registration. Numeric estimates prohibited (false-precision class).
  - `docs/spec-authoring-checklist.md`: new sub-section names the two blocks, references §7.2 / §7.3 of the build spec by path, and gives a one-line rationale. Appendix has two new pre-review boxes.

- **Error handling:**
  - Operator authors a spec without one of the blocks: `spec-conformance` reads the checklist Appendix (its existing behaviour) and flags the missing block as a blocking gap. No `spec-conformance` agent-file edit required (spec §6.4). The Chunk 2 instructions in `spec-coordinator.md` Step 6 also restate the requirement so the authoring path catches it pre-handoff.
  - Numeric estimate appears in ABCd Sizing column: checklist box explicitly says "S / M / L only — numeric values fail this box". Implementer confirms by reading the new wording.

- **Dependencies:**
  - Upstream: none — parallel-safe with Chunks 1 and 4.
  - Downstream: none directly. Chunk 7 process-doc sync references this work but does not block on it.

- **Acceptance (inspection-based; progress.md evidence required):**
  - `docs/spec-authoring-checklist.md` Appendix contains two new boxes: "Lifecycle Declaration present per §7.2" and "ABCd Estimate present with S/M/L sizing only per §7.3".
  - `.claude/agents/spec-coordinator.md` Step 6 names both blocks and references §7.2 / §7.3 of the build spec by path.
  - The two block templates (§7.2 and §7.3 tables) are reproduced verbatim in `spec-coordinator.md` Step 6 — including launch-state restriction (`Inception` or `Growth` only) and S/M/L-only sizing.
  - Implementer reads both files end-to-end, confirms the wording matches §7.2 / §7.3, and records the confirmation in `progress.md` under the Chunk 2 section.
  - **`docs/spec-template.md` is NOT created (plan locked).** Implementer confirms `docs/spec-template.md` does not exist in the merge diff and records the confirmation in `progress.md`.
  - **Grep-the-old-value pass:** after editing the checklist Appendix, grep for any stale references to "spec authoring rubric" that should now mention the new boxes. Same for `.claude/agents/spec-coordinator.md` Step 6.

### Chunk 3 — Duplication / Strategy Check hard gate (Step 3a)

- **spec_sections:** §2 G2, §4.2 row 1, §4.3 row 2, §6.1 Step 3a row + §6.1.1 (inputs / sources / decision criteria, multi-cluster + mixed-lifecycle tie-break rules), §7.1.0 (Duplication / Strategy Check table format), §10 Chunk 3.

- **Files:**
  - `.claude/agents/spec-coordinator.md` — insert a new Step 3a section between the existing Step 3 (Intent intake — modified in Chunk 1) and Step 4 (build slug derivation). Edit anchor: insertion point is after the Step 3 section closing and before "## Step 4 — Build slug derivation + directory creation".

- **Contracts (what the new Step 3a says):**
  - **Title:** "## Step 3a — Duplication / Strategy Check".
  - **Order invariant statement:** Step 3 → Step 3a → Step 4 → Step 5 → Step 6 (reproduced from spec §6.1).
  - **Inputs reproduced verbatim** from spec §6.1.1: the just-authored `intent.md` (specifically Problem Statement, Desired Outcome, Affected Capability Area); the Asset Register at `docs/capabilities.md`; any in-flight build under `tasks/builds/*/`.
  - **Sources to consult (mechanical greps) reproduced verbatim** from §6.1.1: row-by-row Asset Register comparison; in-flight spec title + Goals comparison.
  - **Decision-criteria table reproduced verbatim** from §6.1.1 (Duplication assessment / Strategic fit / Recommendation; three values each for the first two, four for Recommendation).
  - **Tie-break rules reproduced verbatim** from §6.1.1: most-conservative-wins for multi-cluster; worst-toward-Sunset ordering for mixed-lifecycle within a cluster; per-cluster supplementary rows recorded in `intent.md` below the mandatory §7.1.0 three-row table.
  - **Recording location:** the three outputs and any supplementary rows go into `intent.md` `## Duplication / Strategy Check` section using the §7.1.0 mandatory Markdown table shape.
  - **Hard gate behaviour (recommendation = `stop` OR `merge with existing capability`):** halt the coordinator; append a `### Duplication gate escalation` heading to `tasks/builds/<slug>/progress.md` with the gate outputs verbatim; escalate to the operator; resume only after `**Operator decision:**` line is appended to that section.
  - **Soft gate behaviour (recommendation = `revise`):** pause the coordinator; append a `### Revise loop` heading to `tasks/builds/<slug>/progress.md` with the gate outputs verbatim; require the operator to amend `intent.md` (typically Affected Capability Area, Desired Outcome, or Problem Statement); after amendment, re-run Step 3a from the top; the coordinator proceeds to Step 4 only when re-run produces `recommendation = proceed` AND `**Operator decision:** revision complete` is appended to the `### Revise loop` section.
  - **`proceed` path:** continue to Step 4 normally.

- **Error handling:**
  - Operator types "continue" before adding the required `**Operator decision:**` line: coordinator instructions explicitly state that the decision line is the gate signal — without it, the coordinator does not resume. This makes the gate textually idempotent.
  - Multi-cluster Affected Capability Area: tie-break rules reproduced inline; coordinator records per-cluster sub-results as supplementary rows in `intent.md`.
  - Mixed-lifecycle clusters within one cluster header: worst-toward-Sunset ordering reproduced inline.
  - Operator amends `intent.md` during the `revise` loop in a way that creates a NEW partial overlap: re-run Step 3a from the top — the loop is naturally re-entrant. No special handling needed.

- **Dependencies:**
  - Upstream: Chunk 1 (intent.md schema must exist before Step 3a can write into it).
  - Downstream: none. Chunk 4 (Asset Register seeding) is independent — Step 3a in Chunk 3 references the Asset Register but does not block on Chunk 4's seeding (Chunk 4 happens before any future build runs Step 3a).

- **Acceptance (inspection-based; progress.md evidence required):**
  - Reading `.claude/agents/spec-coordinator.md` shows a Step 3a block between Step 3 and Step 4 (no other reordering).
  - Step 3a names the §6.1.1 inputs / sources / decision criteria verbatim, with the spec path as authority.
  - The hard-gate and soft-gate behaviours name `tasks/builds/<slug>/progress.md` as the recording location and `**Operator decision:**` as the resume signal.
  - **Implementer dry-runs four recommendation branches** and records each in `tasks/builds/development-lifecycle-governance-upgrade/progress.md` under the Chunk 3 section:
    1. `proceed` (clear / clear) → continues to Step 4 without escalation.
    2. `revise` (partial overlap) → soft-gate loop demonstrated, intent.md amended, re-run produces `proceed`, operator decision recorded.
    3. `merge with existing capability` (likely duplicate) → hard gate, escalation recorded, operator decision recorded, coordinator resumes.
    4. `stop` (not aligned) → hard gate, escalation recorded, operator decision recorded, coordinator stops.
  - **Grep-the-old-value pass:** after inserting Step 3a, grep `.claude/agents/spec-coordinator.md` for any "Step 4" references that may need to mention Step 3a as their immediate predecessor (e.g. cross-references in the TodoWrite list in Step 1). Update in the same chunk.

### Chunk 4 — `docs/capabilities.md` Asset Register restructure

- **spec_sections:** §2 G4, §4.2 rows 4 and 8, §5.4, §7.4.1 (12-column row schema + pinned header), §7.4.2 (closed cluster list — seed), §7.4.3 (owner placeholder rule), §7.4.4 (registration outcomes), §7.4.5 (cluster mutation procedure), §10 Chunk 4, §15.1 (open question — non-blocking).

- **Files:**
  - `docs/capabilities.md` — full restructure (structure-preserving backfill). Existing capability descriptions and post-S1-merge content (PR #301 audit-runner Area 10 god-file register additions) are mapped into the new Asset Register row schema. The 10-cluster seed list (spec §7.4.2) is added to the file header so it is grep-able. The pinned 12-column Markdown table header (spec §7.4.1) is used verbatim.
  - `tasks/todo.md` — **one-time append for Asset Register backfill placeholders only** (per spec §4.2 row 8 + §10 Chunk 4 acceptance + §7.4.3 owner-placeholder rule). One entry per backfilled placeholder under the heading `### capabilities-backfill: <capability-id>` (per spec §10 Chunk 4 Backfill entry format). A separate sub-class `### owner-resolution: <capability-id>` per spec §7.4.3 is used for owner-specific placeholders. **Note for builder:** this Chunk 4 append is distinct from any later Chunk 6 Compound Learning approved-entry appends. Both chunks add to `tasks/todo.md` but to different heading namespaces — Chunk 4 to `capabilities-backfill` / `owner-resolution`, Chunk 6 to `compound-learning`. See Executor notes for the multi-chunk file-edit summary.

- **Contracts (what each file says after the edit):**
  - **`docs/capabilities.md` (top of file, header):**
    - Existing front-matter prose preserved (Editorial Rules, How-to-use, vendor-neutrality).
    - New cluster-list header section (grep-able): 10 closed clusters listed verbatim from spec §7.4.2 — `Workflow Engine`, `Approvals`, `Identity & Auth`, `Reporting`, `Integrations`, `Agent Runtime`, `Admin & Ops`, `Billing`, `Memory & Knowledge`, `Audit & Governance`.
    - Cluster-mutation procedure referenced (spec §7.4.5): the file is the live source of truth; future builds extend via the §7.4.5 procedure (cluster header edit + ADR + checklist update in the same PR).
  - **`docs/capabilities.md` (body):**
    - Asset Register table introduced. Pinned 12-column header (spec §7.4.1) reproduced verbatim:
      ```
      | Capability ID / slug | Name | Description | Owner | Cluster | Lifecycle state | Launch source | Risk surface | Last review date | Carry notes | Decommission notes | Related docs |
      ```
    - One row per existing capability (structure-preserving backfill). Sources for each field:
      - Capability ID / slug: derived kebab-case from existing capability name; stable forever.
      - Name: existing capability heading.
      - Description: preserved from the existing prose (≤ 300 chars; trim if longer, preserving the lead).
      - Owner: `TBD owner - temp reviewer: <operator>; due <ISO date>` placeholder per spec §7.4.3, with a matching `### owner-resolution: <capability-id>` entry in `tasks/todo.md`.
      - Cluster: one or more from the 10-cluster header.
      - Lifecycle state: `Mature` for capabilities that have been live and stable for ≥1 quarter; `Growth` for capabilities in active iteration; `Inception` if newly introduced. Implementer chooses per capability with a one-line rationale in `progress.md`.
      - Launch source: best-effort; `unknown — historical` is acceptable for migrated rows (no build slug available).
      - Risk surface: pulled from existing capability prose if any §7.1.1 vocabulary maps, else `None.`.
      - Last review date: Chunk 4 merge date (spec §7.4.1 explicit rule for migrated entries).
      - Carry notes: best-effort from existing prose; placeholder `TBD — see tasks/todo.md#capabilities-backfill-<id>` if not derivable.
      - Decommission notes: `None planned` for Inception / Growth / Mature rows; explicit text for Declining / Sunset Candidate / Sunset.
      - Related docs: `spec: <not applicable — historical capability>` for migrated rows; `architecture.md § <section>` if a relevant anchor exists.
    - **Post-S1-merge content preservation:** PR #301 added Area 10 god-file register entries to `docs/capabilities.md`. These entries (whatever their current shape) must be included in the restructured form — the implementer enumerates them BEFORE drafting the new structure and maps each into the row schema. If post-S1-merge content adds entries beyond the spec's view of `docs/capabilities.md` at spec-authoring time, those entries are first-class citizens of the backfill.
  - **`tasks/todo.md` (one-time append, at the end of the file):**
    - For each backfill unknown (Owner, Description, Carry notes, etc.), one entry under `### capabilities-backfill: <capability-id>` (or `### owner-resolution: <capability-id>` for owner-specific placeholders per spec §7.4.3).
    - Body fields per spec §10 Chunk 4: `Capability ID:`, `Unknown field:`, `Current value:`, `Due date:`, `Notes:`.
    - **Anchor collision check:** before appending, scan existing `tasks/todo.md` for any pre-existing `### capabilities-backfill:` or `### owner-resolution:` headings (e.g. from the skill-merge-consolidation-pass build merged via S1 sync). If a collision exists, the new heading is namespaced (e.g. `### capabilities-backfill: <capability-id> (development-lifecycle-governance-upgrade)`) and the collision is recorded in `progress.md`.

- **Error handling:**
  - **Closed cluster list gap** (spec §15.1 open question): if during backfill the implementer cannot place a capability into any of the 10 seed clusters, the §7.4.5 procedure applies — extend the cluster header in `docs/capabilities.md` (this same PR), author a short ADR under `docs/decisions/` (this same PR), and reference the extension in `docs/spec-authoring-checklist.md` Appendix. The Chunk 4 PR's merge diff then includes the ADR file in addition to the §4.1+§4.2 inventory. **This is an explicitly-allowed scope extension via spec §7.4.5** — it is NOT a scope violation. Implementer records the rationale in `progress.md`.
  - **Owner placeholder missing one of three artefacts** (temp reviewer / `### owner-resolution:` follow-up / ISO due date): spec §7.4.3 requires all three. Implementer checks each placeholder row against the three-artefact rule before commit; any row missing one is fixed in the same chunk.
  - **No row has an unfilled field:** every cell is either a real value or an explicit placeholder. Blank cells are invalid. Implementer greps the post-edit file for empty-pipe pairs (`| |` or `|  |`) and resolves before commit.

- **Dependencies:**
  - Upstream: none — parallel-safe with Chunks 1 and 2.
  - Downstream: Chunk 5 (doc-sync row references `docs/capabilities.md`; the Asset Register structure must exist before the doc-sync row is added).

- **Acceptance (inspection-based; progress.md evidence required):**
  - Every existing capability description (including post-S1-merge content from PR #301) appears as a row in the new Asset Register structure. No dropped capabilities.
  - File header contains the 10-cluster list verbatim from spec §7.4.2.
  - Pinned 12-column header is present verbatim.
  - No row has an unfilled field — every cell is either a real value or an explicit placeholder with a matching `tasks/todo.md` follow-up entry.
  - Every placeholder Owner has all three §7.4.3 artefacts (temp reviewer in the cell, `### owner-resolution:` entry in `tasks/todo.md` with anchor matching `<capability-id>`, ISO due date in the cell).
  - **Implementer evidence in `progress.md` (Chunk 4 section):**
    - Count of capabilities migrated.
    - Count of placeholders created (broken down by Unknown field type).
    - Decision on the §15.1 open question: was the 10-cluster list sufficient? If extended, the extension rationale + the ADR path + the §7.4.5 procedure compliance.
    - Confirmation that post-S1-merge content (PR #301 entries) was included.
    - Confirmation of anchor-collision check against existing `tasks/todo.md` entries from PR #300 (skill-merge-consolidation-pass).
  - **Grep-the-old-value pass:** after the restructure, grep the repo for any documentation that points at the OLD `docs/capabilities.md` structure (e.g. anchors that no longer exist after restructure). **Fix stale references in-scope in the same chunk** — i.e. when the stale reference is inside one of the 8 modified files (the §4.2 inventory) the implementer fixes it in this chunk's PR. **If the stale reference is outside the allowed merge inventory** (e.g. a reference in a file not listed in §4.1+§4.2), record a follow-up in `tasks/todo.md` and cite it in `progress.md` — do NOT expand the merge diff to fix out-of-inventory references.

### Chunk 5 — doc-sync trigger row + finalisation Step 6 verdict

- **spec_sections:** §2 G5, §4.2 rows 2 and 3, §6.2 Step 6 row, §6.2.1 (combined verdict format — 8 valid strings), §7.4.4 (registration outcomes), §10 Chunk 5, §11 (MERGE_READY preserved).

- **Files:**
  - `docs/doc-sync.md` — add a new trigger row for Capability Registration. Edit anchor: the existing trigger table (the file is the canonical doc-sync ledger). The new row names `docs/capabilities.md` as the synced document, with trigger conditions and `n/a` reasons enumerated.
  - `.claude/agents/finalisation-coordinator.md` — edit the Step 6 section (currently "## Step 6 — Full doc-sync sweep"). Edit anchor: the Reference-doc update-triggers table within Step 6 (currently shows `docs/capabilities.md` as a row with "Add / remove / rename capability, skill, integration. Editorial Rules apply."). Extend the row's wording to align with spec §6.2.1, and add explicit Step 6 instructions for emitting the Capability Registration verdict in the §6.2.1 combined format.

- **Contracts (what each file says after the edit):**
  - **`docs/doc-sync.md`** new row (or extended existing row):
    - Doc: `docs/capabilities.md`
    - Update trigger conditions: any merge that creates, mutates, splits, or merges a capability surface — i.e. anything that would change an Asset Register row's spec §7.4.1 fields.
    - Valid `n/a` reasons: the four reasons from spec §6.2.1 (`docs-only change`, `test-only change`, `internal refactor with no capability surface change`, `build / tooling change only`).
    - Valid `yes` outcomes: the four registration outcomes from spec §7.4.4 (`create new capability record`, `update existing capability record`, `split existing capability record`, `merge with existing capability record`).
    - Verdict format pinned (per spec §6.2.1): `yes: <outcome>` or `n/a: <reason>` — exactly one of the eight valid strings. Any other phrasing is invalid.
  - **`.claude/agents/finalisation-coordinator.md` Step 6:**
    - The existing Reference-doc update-triggers table row for `docs/capabilities.md` is updated to reference the new doc-sync row and the §6.2.1 combined verdict format.
    - New prose inside Step 6 states: "When the doc-sync sweep reaches `docs/capabilities.md`, the verdict is recorded in the combined format `<verdict>: <registration outcome>`. Exactly one of these eight strings is valid: [list the eight verbatim]. Any other phrasing is invalid and treated as a missing verdict."
    - New prose also states: "A `yes`-class verdict requires that the Asset Register row(s) follow spec §7.4.1 and that one of the §7.4.4 registration outcomes is named explicitly. A `n/a`-class verdict requires that one of the four §6.2.1 reasons is named explicitly."
    - **MERGE_READY block clause reproduced inline:** `MERGE_READY` (Step 9) is blocked until a valid §6.2.1 verdict is recorded. If the verdict is absent or invalid, Step 6 records the missing-verdict reason in `progress.md` and halts the pipeline.

- **Error handling:**
  - **Invalid verdict phrasing** (e.g. `yes: maybe new capability` instead of one of the eight valid strings): Step 6 instructions explicitly state that the verdict is invalid and treated as missing — pipeline halts.
  - **`yes`-class verdict without a §7.4.4 outcome named:** invalid; halts.
  - **`n/a`-class verdict without a §6.2.1 reason named:** invalid; halts.
  - **`split existing capability record`:** the original row's `Lifecycle state` is moved to `Sunset Candidate` or `Sunset` (using the existing spec §7.4.1 enum — no new fields); a Related-docs link is added pointing to the successor row(s). This is reproduced in Step 6 instructions so the coordinator handles it without operator hand-holding.

- **Dependencies:**
  - Upstream: Chunk 4 (the Asset Register structure must exist before doc-sync.md can reference it).
  - Downstream: Chunk 6 (the Compound Learning Step 7a runs after Step 6's verdict).

- **Acceptance (inspection-based; progress.md evidence required):**
  - `docs/doc-sync.md` contains a row for `docs/capabilities.md` naming the trigger conditions (any spec §7.4.1 field change) and the four valid `n/a` reasons.
  - `.claude/agents/finalisation-coordinator.md` Step 6 names the §6.2.1 eight-string combined verdict format verbatim.
  - Step 6 instructions explicitly state that `MERGE_READY` (Step 9) is withheld and the missing-verdict reason is recorded in `progress.md` when the verdict is absent or invalid.
  - **Implementer dry-runs both branches and records in `progress.md` (Chunk 5 section):**
    - Capability-surface-touching change → `yes: update existing capability record` (or another `yes:` variant).
    - Internal refactor with no capability surface change → `n/a: internal refactor with no capability surface change`.
  - **Grep-the-old-value pass:** after editing Step 6, grep `.claude/agents/finalisation-coordinator.md` for any references to the old doc-sync format that may need to mention the new combined verdict shape (e.g. the doc-sync enforcement invariant prose at line ~280).

### Chunk 6 — Compound Learning Feedback (Step 7a)

- **spec_sections:** §2 G6, §4.2 row 2, §4.3 rows 3 and 4, §5.5, §6.2 Step 7a row, §7.5 (LEARNING_FEEDBACK_PROPOSAL contract + 8-value target enum + 6-agent shortlist for `agent-instruction` + auto-apply prohibition), §10 Chunk 6, §11 (Step 7a never blocks MERGE_READY).

- **Files:**
  - `.claude/agents/finalisation-coordinator.md` — insert a new Step 7a section immediately after the existing Step 7 ("## Step 7 — KNOWLEDGE.md pattern extraction", ending around line 299) and before Step 8 ("## Step 8 — tasks/todo.md cleanup", starting around line 300). Edit anchor: the insertion point is between those two section headings.

- **Contracts (what the new Step 7a says):**
  - **Title:** "## Step 7a — Compound Learning Feedback".
  - **Order invariant statement:** Step 6 → Step 7 → Step 7a → Step 8 → Step 9 (`MERGE_READY`) → Step 10 (reproduced from spec §6.2). Step 7a never blocks `MERGE_READY` — it emits proposals and continues.
  - **Producer / consumer (per spec §7.5):** `finalisation-coordinator` produces the `LEARNING_FEEDBACK_PROPOSAL` table in `tasks/builds/<slug>/progress.md`; operator approves / rejects / defers each row; approved entries become `tasks/todo.md` items.
  - **Proposal table contract reproduced verbatim** (per spec §7.5):
    ```
    | Pattern | Target | Rationale | Operator decision |
    |---|---|---|---|
    ```
  - **8-value target enum reproduced verbatim** (per spec §7.5):
    1. `spec-authoring-instructions`
    2. `plan-template`
    3. `agent-instruction` (constrained to the 6-agent shortlist below)
    4. `hook-or-grep-gate`
    5. `regression-test`
    6. `context-pack`
    7. `documentation`
    8. `no-further-action`
  - **6-agent shortlist for `agent-instruction` reproduced verbatim:** `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`, `pr-reviewer`, `architect`, `builder`. Other agents are not v1 targets — surface as separate `tasks/todo.md` items.
  - **Auto-apply prohibition reproduced verbatim:** the coordinator MUST NOT apply the change in the same finalisation cycle. Approved entries become `tasks/todo.md` items handled as separate (often Trivial) PRs. **No exception in v1.**
  - **Proposal-only scope (v1 binding):** the §7.5 enum names future-change targets, not files this build edits. Targets 4–7 reference paths explicitly out of scope for v1 — approved entries trigger separate, future PRs.
  - **Behaviour:** for each pattern extracted in Step 7, the coordinator emits one proposal row. The operator marks each row's decision inline (approved / rejected / deferred). Approved entries are appended to `tasks/todo.md` with a per-build heading or inline as appropriate (specifics: each approved entry becomes a follow-up task; the heading format is `### compound-learning: <pattern-title> (<slug>)` for grep-ability — note this is a Chunk 6 plan-author proposal, not from spec §10 verbatim; implementer may adjust the heading format and record the choice in `progress.md`).
  - **Anchor collision check at runtime:** before appending each approved entry to `tasks/todo.md`, the coordinator scans for an existing heading with the same anchor; if found, the heading is namespaced with the build slug.

- **Error handling:**
  - **Pattern routed to a target outside the 8-value enum:** Step 7a instructions explicitly state that the target is invalid and the row is rewritten before operator approval.
  - **`agent-instruction` target naming an agent outside the 6-agent shortlist:** Step 7a instructions state the row is rewritten or split into a `tasks/todo.md` separate-PR follow-up.
  - **Operator absent / declines to triage:** Step 7a instructions state that unapproved rows remain in `progress.md` as deferred; they do NOT block `MERGE_READY`. The build proceeds to Step 8.
  - **No patterns extracted in Step 7:** Step 7a emits an empty proposal table with a note "no patterns extracted from Step 7 — Compound Learning Feedback section is empty." This is normal for builds that produced no KNOWLEDGE.md entries.

- **Dependencies:**
  - Upstream: Chunk 5 (Step 7a sits after Step 6 in the new ordering, and Chunk 5 establishes the new Step 6 wording — keeping them in sequence avoids any merge-order surprises in `finalisation-coordinator.md`).
  - Downstream: Chunk 7 (process docs sync references Step 7a as part of the new lifecycle sequence).

- **Acceptance (inspection-based; progress.md evidence required):**
  - `.claude/agents/finalisation-coordinator.md` contains a new "## Step 7a — Compound Learning Feedback" section between Step 7 and Step 8.
  - Step 7a names the 8-value target enum verbatim, the 6-agent shortlist verbatim for `agent-instruction`, and the auto-apply prohibition explicitly.
  - The proposal table contract is reproduced verbatim.
  - The order invariant statement (Step 6 → 7 → 7a → 8 → 9 → 10) is present, including the "Step 7a never blocks MERGE_READY" clause.
  - **Implementer dry-runs three synthetic KNOWLEDGE.md patterns through Step 7a** and records in `progress.md` (Chunk 6 section):
    1. A pattern about agent instructions (routes to `agent-instruction: <agent>`).
    2. A pattern about a missing checklist box (routes to `spec-authoring-instructions`).
    3. A pattern with no clear target (routes to `no-further-action`).
  - Implementer confirms three proposal rows are produced; confirms no agent / hook / test file is edited in the same dry-run.
  - **Grep-the-old-value pass:** after inserting Step 7a, grep `.claude/agents/finalisation-coordinator.md` for any references to the old step sequencing (Step 7 → Step 8) that should now reference Step 7 → Step 7a → Step 8. Update in the same chunk.

### Chunk 7 — Process documentation sync (CLAUDE.md + architecture.md)

- **spec_sections:** §2 G7, §4.2 rows 6 and 7, §10 Chunk 7, §11 (backwards-compat invariants), §14 (current-focus.md deferred).

- **Files:**
  - `CLAUDE.md` — edit the lifecycle description section. Edit anchor: the existing lifecycle prose (whichever section currently describes the build pipeline phases — likely under "Local Dev Agent Fleet" or "Task Management Workflow" or "Plan Mode Default"). Replace the existing lifecycle sequence with the corrected sequence.
  - `architecture.md` — edit the agent fleet / lifecycle pointers section. Edit anchor: the existing prose describing the dev pipeline phases (typically in a "Build pipeline" or "Lifecycle" or "Agent fleet" section). Apply the same corrected sequence.

- **Contracts (what each file says after the edit):**
  - **Corrected lifecycle sequence reproduced verbatim in both files** (spec §10 Chunk 7):
    > Intent → Duplication / Strategy Check → Specification → Build Planning → Construction → Review → Capability Registration → Compound Learning → Merge
  - No step named "Elaboration" appears (spec §10 Chunk 7 explicitly omits it).
  - Capability Registration and Compound Learning run **during finalisation, before merge** — they precede `MERGE_READY`, consistent with spec §6.2's order invariant. The prose makes this explicit.
  - **`CLAUDE.md`:** the lifecycle prose is updated to reflect the new wrapper steps. Any cross-references to the old sequence (e.g. in the Task Management Workflow section) are updated in the same chunk.
  - **`architecture.md`:** the agent fleet section's references to the dev pipeline are updated to reflect the new wrapper steps. **Critical: do NOT clobber the audit framework section** (PR #303 Rule 16 content). The lifecycle prose section is separate from the audit framework section; implementer verifies the audit framework content is untouched by reading the post-edit file and confirming Rule 16 prose is intact.

- **Error handling:**
  - **Architecture.md audit framework clobber risk:** before committing, the implementer greps the post-edit `architecture.md` for "Rule 16" (or equivalent PR #303 marker) to confirm it is preserved. If clobbered, the chunk is reverted and re-applied with explicit scope around the lifecycle section.
  - **Stale references to old step names:** spec §10 Chunk 7 acceptance requires a repo-wide grep for old step phrasing (e.g. "Intent → Elaboration"). Every result is either updated, or confirmed in `docs/decisions/` (historical) / `_retired/` (archived) — both legitimately keep the old phrasing.
  - **Capability Registration verdict for this build itself** runs in Phase 3 (finalisation), not Phase 2. Plan note: the `finalisation-coordinator` running on this build's PR will register the Asset Register row for the build itself under cluster `Audit & Governance` (capability ID `dev-lifecycle-governance`). The **exact verdict is conditional on the post-Chunk-4 Asset Register state**: if Chunk 4's backfill produced an Asset Register that already contains a `dev-lifecycle-governance` row, the verdict is `yes: update existing capability record` with the row transitioning to `Growth`. If Chunk 4's backfill did not produce that row (e.g. no existing capability mapped to dev-lifecycle governance), the verdict is `yes: create new capability record` and the row is added at finalisation with `Lifecycle state: Growth`. Finalisation must read `docs/capabilities.md` post-Chunk-4 and pick the valid §7.4.4 outcome — the verdict is NOT hardcoded by this plan. Implementer is aware but does NOT need to do anything in Chunk 7 itself — Phase 3 handles the verdict.

- **Dependencies:**
  - Upstream: Chunks 1–6 (the process documentation sync names the new wrapper steps, so all prior chunks must have shipped their contributions in the same merge).
  - Downstream: none. Chunk 7 is last.

- **Acceptance (inspection-based; progress.md evidence required):**
  - The doc-sync sweep at finalisation of this build emits ordinary `yes (updated)` verdicts for `CLAUDE.md` and `architecture.md` (these are process docs, not capability docs — NOT subject to the new Capability Registration verdict).
  - The Capability Registration verdict for this build itself is conditional on the post-Chunk-4 Asset Register state. **If** a `dev-lifecycle-governance` row exists post-Chunk-4: `yes: update existing capability record` with the row transitioning to `Growth`. **Else**: `yes: create new capability record` with the row added at finalisation under cluster `Audit & Governance`, `Lifecycle state: Growth`. Finalisation inspects `docs/capabilities.md` post-Chunk-4 and picks the valid §7.4.4 outcome — this plan does NOT hardcode it.
  - **Repo-wide grep for old step phrasing** returns no results, or every result is in `docs/decisions/` (historical) or `_retired/` (archived). Implementer records the grep output in `progress.md` (Chunk 7 section).
  - **Architecture.md audit framework section integrity check:** implementer greps for PR #303 / Rule 16 markers post-edit and records confirmation in `progress.md`.
  - **Grep-the-old-value pass:** after editing both files, grep both files for any remaining references to the OLD lifecycle sequence and update in the same chunk.

## Risks and mitigations

| # | Risk | Impact | Mitigation | Owner |
|---|---|---|---|---|
| R1 | Load-bearing-value drift across coordinator-file sections (e.g. "Step 3" appearing in cross-references). Per KNOWLEDGE.md 2026-05-14 pattern, the local Edit is necessary but not sufficient — same value appears in multiple sections. | Builder ships an inconsistent agent file; future sessions get conflicting instructions. | Every chunk's acceptance includes a mandatory **grep-the-old-value pass**: after every Edit, grep the file for the OLD value and update every hit in the same chunk. Surfaced in every chunk's acceptance criteria. | Builder per chunk |
| R2 | Chunk 2 / Chunk 3 textual collision on `.claude/agents/spec-coordinator.md` — different sections but a misordered rebase could break either. | Build halts on rebase conflict; one chunk's edit overwrites another. | Implement Chunks 2 and 3 sequentially (Chunk 3 only after Chunk 1 lands, regardless of Chunk 2's status; Chunk 2 is parallel-safe with Chunk 1). Document in `progress.md` which chunk landed first and the resulting line ranges. | feature-coordinator |
| R3 | Chunk 4 structure-preserving backfill clobbers post-S1-merge content (PR #301 audit-runner Area 10 god-file register additions). | Lost documentation content; future audit-runner runs misbehave. | Chunk 4 contract explicitly states: "enumerate ALL current entries (including post-S1-merge content) before drafting the new structure". Implementer records the count and source attribution in `progress.md`. | Builder for Chunk 4 |
| R4 | Chunk 7 architecture.md edit clobbers PR #303 (Rule 16 audit framework section). | Lost rule documentation; audit-runner regression. | Chunk 7 contract explicitly states: "do NOT clobber Rule 16 prose". Implementer greps post-edit architecture.md for Rule 16 markers and records confirmation in `progress.md`. | Builder for Chunk 7 |
| R5 | Closed cluster list (spec §15.1 open question) is incomplete for current `docs/capabilities.md`. | Chunk 4 implementer cannot place every capability without invoking §7.4.5 cluster mutation. | This is an explicitly-allowed scope extension via spec §7.4.5: extend the cluster header, author an ADR, update the checklist — all in the same PR. Plan flags this as a known path; not a violation. | Builder for Chunk 4 (with operator decision on cluster names) |
| R6 | Owner-placeholder rule requires three artefacts per row (spec §7.4.3) — easy to forget one. | Asset Register row passes commit but fails finalisation-coordinator Step 6 verdict (registration rejected). | Chunk 4 contract enumerates the three artefacts inline; acceptance criteria require a per-placeholder check. Implementer greps post-edit `docs/capabilities.md` for `TBD owner` and confirms each row has all three artefacts. | Builder for Chunk 4 |
| R7 | Capability Registration verdict for THIS build runs at Phase 3 (finalisation), not Phase 2. If finalisation-coordinator's operator is not aware, the verdict may be incorrectly recorded as `n/a: docs-only change`. The verdict also depends on the post-Chunk-4 register state — if the register does not contain a `dev-lifecycle-governance` row, hardcoding `yes: update existing capability record` would be wrong. | This build's own Asset Register row is missing or wrongly classified at finalisation. | Plan's Chunk 7 acceptance criteria + Executor notes specify the verdict **conditionally**: `yes: update existing capability record` IF a `dev-lifecycle-governance` row exists post-Chunk-4 (the row transitions to `Growth`); ELSE `yes: create new capability record` (the row is added at finalisation under cluster `Audit & Governance`, `Lifecycle state: Growth`). Finalisation inspects `docs/capabilities.md` post-Chunk-4 to pick the valid §7.4.4 outcome. Verdict is NOT hardcoded by the plan. | finalisation-coordinator operator |
| R8 | `tasks/todo.md` anchor collision between Chunk 4 backfill headings and existing entries (e.g. from PR #300 skill-merge-consolidation-pass). | Two `### capabilities-backfill: <id>` headings collide; tooling or future automation cannot disambiguate. | Chunk 4 contract requires a pre-append collision scan; on collision, the new heading is namespaced with the build slug. Implementer records each collision in `progress.md`. | Builder for Chunk 4 |
| R9 | Implementer accidentally adds a file outside §4.1+§4.2 (e.g. a new gate script, a hook, a test file). | Spec §1 binding scope constraint violated; build is non-conformant. | Acceptance criteria for every chunk re-state the scope ban. Plan's Architecture notes lead with the constraint. `spec-conformance` (Phase 2 review) reads spec §4 inventory and reports any file outside it as a blocking gap. **Named exception:** the single allowed `docs/decisions/<ADR>.md` file IF Chunk 4 triggers the spec §15.1 / §7.4.5 cluster-mutation procedure — that ADR is in-scope and not a violation (Architecture notes Key invariant #2 + Self-consistency pass + Executor notes File-count summary all state this conditional exception). Every other file outside §4.1+§4.2 is a violation. | Builder + spec-conformance |
| R10 | Spec-template.md optional file (spec §4.1) is created but duplicates the checklist content, creating a maintenance burden. | Drift between checklist and template. | **Resolved by plan decision (chatgpt-plan-review Round 1 F4):** Chunk 2 is **locked to NOT create** `docs/spec-template.md`. The schema lives in `docs/spec-authoring-checklist.md` Appendix + `.claude/agents/spec-coordinator.md` Step 6. Future need surfaces through Compound Learning Feedback (spec §7.5 target `spec-authoring-instructions`) as a separate Trivial PR. Risk closed. | Plan author (resolved) |

## Self-consistency pass

Confirmed against spec before plan write:

- **Goals (spec §2) match implementation (spec §10 / plan chunks):**
  - G1 (intent.md per Standard+) → Chunk 1.
  - G2 (Step 3a duplication gate + soft-gate revise loop) → Chunk 3.
  - G3 (Lifecycle Declaration + ABCd S/M/L blocks) → Chunk 2.
  - G4 (`docs/capabilities.md` Asset Register + closed cluster list) → Chunk 4.
  - G5 (doc-sync row + Step 6 verdict + 8 valid strings) → Chunk 5.
  - G6 (Step 7a Compound Learning, 8-value enum, no auto-apply) → Chunk 6.
  - G7 (existing pipeline invariants preserved) → Chunk 7 + every prior chunk via spec §11.

- **Chunk file inventory matches spec §4.1+§4.2 (with one named conditional exception):**
  - Every file touched in any Chunk is in §4.2 (8 modified files).
  - `docs/spec-template.md` (spec §4.1, optional per spec §14) is **locked to NOT created** by plan decision in Chunk 2 (chatgpt-plan-review Round 1 F4).
  - Default merge diff count: **8 modified, 0 new = 8 repo files**, within the spec §4.6 range of "8–9 repo files".
  - **Conditional exception:** if Chunk 4 backfill triggers spec §15.1 / §7.4.5 cluster-mutation procedure, **one new ADR file under `docs/decisions/`** is added. In that case the diff is **8 modified + 1 new = 9 repo files**, still within spec §4.6's "8–9" range. This is the only allowed deviation from "8 modified, 0 new"; every other deviation is a spec violation.
  - No Chunk adds a file outside this set.

- **No schema / route / service / job / hook / gate-script / test additions:**
  - Confirmed against every Chunk's file list. All edits are to markdown agent files, markdown docs, or `tasks/todo.md`.
  - Plan's Architecture-notes Key invariant #1 reproduces the scope ban verbatim.

- **Backwards-compat invariants (spec §11) hold:**
  - Step-list ordering preserved except for named insertions/edits (Chunks 1, 2, 3, 5, 6).
  - No reviewer agent file changes (Chunks 1–7 file lists confirmed; spec §4.5 reinforced in plan Architecture notes Key invariant #5).
  - No gate-script changes (Chunks 1–7 file lists confirmed).
  - KNOWLEDGE.md extraction (Step 7) preserved — Chunk 6 inserts Step 7a AFTER Step 7.
  - MERGE_READY flow preserved — Step 7a never blocks Step 9 (Chunk 6 contract).
  - Trivial builds keep `brief.md`-only flow — Chunk 1 contract preserves Trivial path.

- **Single-source-of-truth claims (spec §7.6) honoured:**
  - intent.md vs spec Lifecycle Declaration → spec wins at finalisation. Plan respects (Chunk 5 verdict reads spec Lifecycle Declaration).
  - Spec Lifecycle Declaration vs Asset Register row → Asset Register wins for ongoing state. Plan respects (Chunk 4 establishes Asset Register; Chunk 5 verdict reads it).

- **Order invariants (spec §6.1, §6.2) enforced:**
  - spec-coordinator: Step 3 → 3a → 4 → 5 → 6. Chunks 1, 3, 2 cover the named edits in compliant positions.
  - finalisation-coordinator: Step 6 → 7 → 7a → 8 → 9 → 10. Chunks 5 and 6 cover the named edits in compliant positions. Step 7a never blocks MERGE_READY.

- **Test gates:** none introduced. CI-only. Plan has no Verification commands section that proposes any gate run.

- **Operator-visible communication:** plan opens with a plain-English summary (Architecture notes → "Plain-English summary (read this first)").

**No self-consistency defects.**

## Executor notes

**No unit tests are authored in this plan.** Targeted test execution is not applicable. Verification is inspection-based only (read the edited file end-to-end, dry-run the relevant flow, record walkthroughs in `tasks/builds/development-lifecycle-governance-upgrade/progress.md`), plus baseline CI (`lint`, `typecheck`) after merge readiness — and those baseline gates are CI-only, not run locally during any chunk per `references/test-gate-policy.md`.

**Per-chunk verification surface for THIS build:** none of the chunks edit TypeScript files. `lint`, `typecheck`, `build:server`, `build:client` are not relevant per chunk — they remain as the baseline CI safety net only. The acceptance criteria for every chunk are inspection-based as described above.

**Per-chunk grep-the-old-value pass is mandatory** (KNOWLEDGE.md 2026-05-14). Each chunk's acceptance criteria includes this pass — it is not optional and not summary-able.

**Multi-chunk file edits:**
- `.claude/agents/spec-coordinator.md` is touched by Chunks 1, 2, 3 (Step 3 / Step 6 / Step 3a — non-overlapping). Implement in dependency order: Chunk 1 first (Step 3 edit), then either Chunk 2 (Step 6) or Chunk 3 (Step 3a) — both can land in either order after Chunk 1. Record line-range deltas in `progress.md` so the next chunk's diff is unambiguous.
- `.claude/agents/finalisation-coordinator.md` is touched by Chunks 5 and 6 (Step 6 extend / Step 7a insert — non-overlapping). Implement Chunk 5 first (Step 6 wording change), then Chunk 6 (Step 7a insert).
- `tasks/todo.md` is touched by Chunks 4 and 6 — non-overlapping heading namespaces. Chunk 4 appends under `### capabilities-backfill: <capability-id>` and `### owner-resolution: <capability-id>`. Chunk 6 (at runtime, per future builds) appends under `### compound-learning: <pattern-title> (<slug>)`. Chunks 4 and 6 do not collide; both can land in any order after their respective upstream chunks.

**File-count summary:** default merge diff is **8 modified, 0 new = 8 repo files**. `docs/spec-template.md` is NOT created in this build (locked by Chunk 2 plan decision). The only allowed extension to the merge diff is **one new ADR under `docs/decisions/`** if Chunk 4 backfill triggers the spec §15.1 / §7.4.5 cluster-mutation procedure — in that case the diff is 8 modified + 1 new = 9 files. Every other deviation is a spec violation.

**Capability Registration verdict for this build itself** runs at Phase 3 (finalisation-coordinator on the merge PR). Verdict is **conditional on post-Chunk-4 register state**: if a `dev-lifecycle-governance` row exists in `docs/capabilities.md` post-Chunk-4, verdict is `yes: update existing capability record` (row transitions to `Growth`); else `yes: create new capability record` (row added at finalisation under cluster `Audit & Governance`, `Lifecycle state: Growth`). Finalisation reads `docs/capabilities.md` post-Chunk-4 and picks the valid §7.4.4 outcome. **The verdict is NOT hardcoded by this plan.** The Phase 3 operator should expect one of these two outcomes and NOT record `n/a: docs-only change`.

---

End of plan. Status: ready for plan-gate review.
