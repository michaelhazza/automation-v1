# Handoff — development-lifecycle-governance-upgrade

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** tasks/builds/development-lifecycle-governance-upgrade/spec.md
**Branch:** claude/ai-driven-dev-lifecycle-FRqBd
**Build slug:** development-lifecycle-governance-upgrade
**UI-touching:** no
**Mockup paths:** n/a
**Spec-reviewer iterations used:** 3 / 5
**Spec-reviewer verdict:** READY_FOR_BUILD (final report: `tasks/review-logs/spec-review-final-development-lifecycle-governance-upgrade-2026-05-14T03-52-18Z.md`)
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-development-lifecycle-governance-upgrade-2026-05-14T03-57-57Z.md
**ChatGPT spec review verdict:** APPROVED (3 rounds; 18 findings + 5 integrity-check; 4 user-decided + 19 auto-applied)

**Note on Phase 1 close:** The spec authoring + reviews were run partially-manually rather than through the formal `spec-coordinator` playbook. This handoff was written retroactively from the actual review log evidence (spec frontmatter, the spec-reviewer final report, and the chatgpt-spec-review session log). The spec itself is locked and approved — only the closing artefacts (this handoff + the `current-focus.md` flip to BUILDING) were missing.

**Open questions for Phase 2:**

- §15.1 — Closed cluster list completeness (non-blocking). The §7.4.2 seed list has 10 clusters. Implementer reviews against the existing `docs/capabilities.md` during Chunk 4 backfill; if a gap is found, Chunk 4 PR extends the live cluster header in `docs/capabilities.md` and adds a short ADR per §7.4.5. Does NOT block plan authoring or any chunk before Chunk 4.

No other open questions remain — the spec is implementation-ready.

**Decisions made in Phase 1 (directional, locked):**

- **Hard scope constraint (binding):** v1 introduces no DB schema, UI, background jobs, dashboards, scoring engines, scheduled monitors, or new coordinators. Enforcement is markdown + coordinator instructions + doc-sync only.
- **ABCd sizing:** S/M/L only. Numeric estimates prohibited (false-precision class).
- **intent.md vs brief.md:** intent.md for Standard+; brief.md retained for Trivial. No retroactive rewriting of historical brief.md files.
- **Closed cluster list (seed, 10 clusters):** Workflow Engine, Approvals, Identity & Auth, Reporting, Integrations, Agent Runtime, Admin & Ops, Billing, Memory & Knowledge, Audit & Governance. Mutable post-Chunk-4 via the §7.4.5 cluster-mutation procedure.
- **Capability Registration verdicts:** exactly 8 valid strings (4 `yes:` + 4 `n/a:`). MERGE_READY blocked without a valid verdict.
- **§7.5 Compound Learning enum:** 8 fixed target values; one of them (`agent-instruction`) is itself constrained to a fixed shortlist of 6 named agents. Proposal-only in v1 — no auto-apply.
- **spec-coordinator order invariant:** Step 3 → Step 3a → Step 4 → Step 5 → Step 6.
- **finalisation-coordinator order invariant:** Step 6 → Step 7 → Step 7a → Step 8 → Step 9 (MERGE_READY) → Step 10. Step 7a never blocks MERGE_READY.
- **Owner placeholder rule (3 artefacts):** temp reviewer + `tasks/todo.md` follow-up under `### owner-resolution: <capability-id>` heading + ISO due date.
- **Source-of-truth precedence:** spec Lifecycle Declaration wins over `intent.md`; Asset Register row wins over spec Lifecycle Declaration (for ongoing state).
- **Soft-gate (`revise`) handling:** pause-and-rerun loop — operator amends intent.md, coordinator re-runs Step 3a until `proceed`.
- **Risk Surface handoff path:** intent.md → spec Lifecycle Declaration → feature-coordinator reads spec (no feature-coordinator agent-file change required).
- **Lifecycle launch-state restriction:** only `Inception` or `Growth` at first registration. Full 6-state enum tracked on the Asset Register row.
- **Reviewer agent files unchanged:** new spec-block enforcement comes through `docs/spec-authoring-checklist.md` Appendix, which `spec-conformance` already verifies.
- **Chunk plan (7 chunks):** Chunk 1 (Intent + spec-coord Step 3), Chunk 2 (Lifecycle + ABCd in spec authoring), Chunk 3 (Duplication / Strategy gate), Chunk 4 (capabilities.md Asset Register), Chunk 5 (doc-sync row + finalisation Step 6), Chunk 6 (Compound Learning Step 7a), Chunk 7 (process docs sync). Dependency graph in §10.

**Files to change (locked inventory — see spec §4):**

- 0–1 new repo file: `docs/spec-template.md` (optional per §14)
- 8 modified repo files: `.claude/agents/spec-coordinator.md`, `.claude/agents/finalisation-coordinator.md`, `docs/doc-sync.md`, `docs/capabilities.md`, `docs/spec-authoring-checklist.md`, `CLAUDE.md`, `architecture.md`, `tasks/todo.md`
- Total merge diff: 8–9 repo files
- 0 schema migrations, 0 new jobs, 0 new services, 0 new routes, 0 new hooks, 0 new gate scripts
