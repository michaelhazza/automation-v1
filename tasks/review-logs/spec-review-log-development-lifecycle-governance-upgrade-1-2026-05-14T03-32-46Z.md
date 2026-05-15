# Spec Review Iteration 1 — Log

**Spec:** `tasks/builds/development-lifecycle-governance-upgrade/spec.md`
**Iteration:** 1 of 5
**Codex output:** `tasks/review-logs/_codex_development-lifecycle-governance-upgrade_iter1_2026-05-14T03-32-46Z.txt`
**Codex distinct findings:** 50
**Reviewer rubric additions:** 4

---

## Classification + adjudication

### Codex findings (F1-F50)

- **F1 (§4.1) — `docs/spec-template.md` listed as new file but optional/deferred.** mechanical → ACCEPT. Mark optional in §4.1, adjust count note.
- **F2 (§4 count reconciliation) — "2 new files" includes runtime artefact.** mechanical → ACCEPT. Split repo-diff vs runtime counts.
- **F3 (§4.2 / Chunk 7 / §14 / §15.4) — `current-focus.md` mentioned in Chunk 7 but not in §4.2.** mechanical → ACCEPT.
- **F4 (§4 / §7.5 / §15.5) — `.claude/hooks/*`, `scripts/check-capabilities-md.sh`, `docs/context-packs/*`, ADR paths, test paths referenced in §7.5 enum but not in §4.** mechanical → ACCEPT. Clarify these are proposal targets, not v1 changes.
- **F5 (§4 / §11 / §13) — `references/test-gate-policy.md`, `docs/testing-conventions.md`, `docs/spec-context.md`, `KNOWLEDGE.md`, dev-pipeline-coordinators spec referenced outside §4.** mechanical → ACCEPT. Add §4.4 reference-only subsection.
- **F6 (Frontmatter brief link) — link target allegedly omits `tasks/`.** mechanical → REJECT. Verified: `../../ai-dlc-governance-brief.md` resolves to `tasks/ai-dlc-governance-brief.md` (spec lives two levels deeper).
- **F7 (§6.1 / Chunk 3 / §15.1) — Step 3a ordering specified two ways.** mechanical → ACCEPT.
- **F8 (§6.1 Order invariant) — conditional weakens the invariant.** mechanical → ACCEPT (folded into F7).
- **F9 (§10 Dependency graph) — Chunk 3 depends on Chunks 1 AND 2 in graph but only needs Chunk 1.** mechanical → ACCEPT.
- **F10 (§2 G6 / §5.5 / §6.2 / §7.5) — "shortlist of six" vs eight enum values.** mechanical → ACCEPT.
- **F11 (§7.5) — "one of the seven values" but eight listed.** mechanical → ACCEPT.
- **F12 (§7.5 target enum vs v1 binding scope) — `hook-or-grep-gate`, `regression-test`, `context-pack` conflict with no-hook/test/new-file scope.** mechanical → ACCEPT. Clarify proposal-only.
- **F13 (§7.1 Consumer / §6.2 vs §7.6) — finalisation auto-populates from intent.md but spec wins.** mechanical → ACCEPT.
- **F14 (§7.3 / §7.4.1) — ABCd has 4 dimensions, Asset Register only 2 (Carry/Decommission).** ambiguous → directional. AUTO-DECIDED accept (minimum-change variant: clarify Acquire/Build are pre-merge planning, not registered). Routed to `tasks/todo.md`.
- **F15 (§7.3 / §7.4.1) — "actuals against estimates" but no actuals fields.** mechanical → ACCEPT. Remove "actuals" wording.
- **F16 (§7.2 Lifecycle table) — malformed `| Inception | Growth |` row.** mechanical → ACCEPT.
- **F17 (§7.2 / §7.4.1) — Launch state allowed values vs Asset Register six-state enum.** mechanical → ACCEPT (folded into F16).
- **F18 (§7.1 Risk Surface) — zero-or-more + `None.` required is self-contradictory.** mechanical → ACCEPT.
- **F19 (§7.1 Affected Capability Area) — one value vs multiple.** mechanical → ACCEPT.
- **F20 (§7.1 Duplication / Strategy Check) — "three rows" with no format.** mechanical → ACCEPT.
- **F21 (§6.1 / §7.1) — "Migration rule from brief §6.1" load-bearing but not reproduced.** mechanical → ACCEPT.
- **F22 (§6.1 Step 3a) — "Run the check per §6.3 of the brief" load-bearing but not defined.** mechanical → ACCEPT.
- **F23 (§6.3 / §4.3) — Claims intent.md Risk Surface reaches feature-coordinator Step 8 but doesn't name handoff.** mechanical → ACCEPT.
- **F24 (§6.4) — "spec-conformance will by virtue of reading" is unsupported.** mechanical → ACCEPT. Anchor enforcement to authoring checklist edit.
- **F25 (G3 / §4.3 / §6.1) — spec-reviewer named as blocking but unchanged.** mechanical → ACCEPT.
- **F26 (§6.2 / §7.4.4) — verdict enum vs registration-outcome enum unclear.** mechanical → ACCEPT.
- **F27 (G5 / §6.2 / §7.4.4) — `n/a with reason` wording inconsistent.** mechanical → ACCEPT.
- **F28 (§7.4.1 Related docs) — ADR/KNOWLEDGE required but not always present.** mechanical → ACCEPT.
- **F29 (§7.4.1 Launch source) — build slug or PR URL ambiguous.** mechanical → ACCEPT.
- **F30 (§7.4.3) — Related docs links to tasks/todo.md entries without stable anchors.** mechanical → ACCEPT. Define stable per-task heading format.
- **F31 (§7.4.4 split outcome) — "deprecated or restated" introduces non-schema statuses.** mechanical → ACCEPT. Use Lifecycle state `Sunset Candidate`/`Sunset`.
- **F32 (§7.5 / §10 Chunk 6) — approved entries become tasks/todo.md items but Chunk 6 only lists finalisation-coordinator.md.** mechanical → ACCEPT.
- **F33 (Chunk 1 acceptance) — Requires coordinator behaviour but no test harness.** mechanical → ACCEPT.
- **F34 (Chunk 2 acceptance) — depends on unchanged reviewer.** mechanical → ACCEPT.
- **F35 (Chunk 5 acceptance) — "clear error" implies executable validation.** mechanical → ACCEPT.
- **F36 (§11 invariant) — side-by-side diff invariant excludes legitimate non-agent file diffs.** mechanical → ACCEPT.
- **F37 (§11) — `scripts/gates/*`, `scripts/verify-*`, `references/test-gate-policy.md` referenced but not in §4.** mechanical → ACCEPT (handled by §4.4).
- **F38 (§12 Self-consistency) — "no prose ref outside §4" violated by legitimate reference-only files.** mechanical → ACCEPT.
- **F39 (§13 Testing Posture) — lint/typecheck don't validate Markdown.** mechanical → ACCEPT.
- **F40 (§13 / §15.5) — `scripts/check-capabilities-md.sh` conflicts with no-scripts scope unless deferred.** mechanical → ACCEPT. Move fully to Deferred Items.
- **F41 (G4 / §7.4.2 / §15.3) — Cluster list "closed and verbatim" vs "extend during Chunk 4".** mechanical → ACCEPT.
- **F42 (§4.2 / Chunk 4) — `tasks/todo.md` task format undefined.** mechanical → ACCEPT.
- **F43 (§5.1 / Chunk 1) — intent.md required before Step 4 but path includes `<slug>`.** mechanical → ACCEPT. Define provisional-slug rule.
- **F44 (§6.1 / Chunk 3) — Operator decision recording: only Chunk 3 names progress.md.** mechanical → ACCEPT.
- **F45 (§7.6) — "amend intent.md retroactively" vs "append-only" vs §14 deferring.** mechanical → ACCEPT. Clarify pre-merge-only.
- **F46 (G7 / Chunk 7) — Lifecycle prose puts Capability Registration / Compound Learning after Merge but §6.2 places them before MERGE_READY.** mechanical → ACCEPT. They run pre-merge.
- **F47 (§10 Chunk 7) — "Elaboration" undefined.** mechanical → ACCEPT. Remove from sequence.
- **F48 (§8) — "no agent execution path" vs coordinator-instruction execution.** mechanical → ACCEPT.
- **F49 (§4.3 / §6.3) — feature-coordinator unchanged but spec relies on Risk Surface handoff.** mechanical → ACCEPT (paired with F23).
- **F50 (§15 Open Questions) — Several questions materially affect chunk scope.** mechanical → ACCEPT. Resolved by F7/F1/F3/F40 fixes; remaining §15 trimmed.

### Rubric findings (R-1 to R-4)

- **R-1 (Frontmatter + §7.1.1) — Canonical pipeline spec path is `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`, not `docs/2026-04-30-dev-pipeline-coordinators-spec.md`.** mechanical → ACCEPT.
- **R-2 (§4.2 "9 modified files" count) — Two rows are runtime/per-build artefacts (progress.md, tasks/todo.md).** mechanical → ACCEPT (handled with F2 count split).
- **R-3 (§4.2 tasks/todo.md row) — Listed as modified file but is a runtime sink; should be marked runtime.** mechanical → ACCEPT (handled with F2).
- **R-4 (§7.4.1 Last review date) — "backfill date" for migrated entries not defined.** mechanical → ACCEPT. Define as Chunk 4 merge date.

### Counts (for stopping heuristic)

- mechanical_accepted: 49 (F1-F5, F7-F13, F15-F49 minus F6, F14; +R-1, R-2, R-3, R-4 collapsed into edits where they overlap)
- mechanical_rejected: 1 (F6 — link is actually correct; verified path resolution)
- directional_or_ambiguous: 1 (F14 AUTO-DECIDED accept-minimum, routed to tasks/todo.md; F50 derivative — resolved by other fixes)
- reclassified_to_directional: 0

### Edits applied (this iteration)

Spec sections rewritten or added:
- Frontmatter: corrected canonical pipeline spec path; bumped Status to `reviewing`; bumped Last updated.
- §4 Files inventory: completely restructured into 6 sub-sections (4.1 new repo files, 4.2 modified repo files, 4.3 runtime artefacts, 4.4 reference-only documents, 4.5 files NOT changed, 4.6 count reconciliation). Counts split: 7-8 repo-diff files + 4 runtime sinks.
- §6.1 spec-coordinator: added provisional-slug rule; inlined migration rule and duplication/strategy check (§6.1.1); fixed order invariant to single rule (Step 3 → 3a → 4 → 5 → 6); named `progress.md` as gate-escalation recording location.
- §6.2 finalisation-coordinator: added §6.2.1 combined verdict format (8 valid strings); clarified §7.5 enum has 8 values.
- §6.3 feature-coordinator: explicit Risk Surface handoff path documented.
- §6.4 reviewers: enforcement anchored to spec-authoring-checklist; removed spec-reviewer claim.
- §7.1 intent.md: fixed Affected Capability Area (one-or-more), Risk Surface (`None.` or list), Duplication / Strategy Check (exact Markdown shape in §7.1.0); consumer wording rewritten to honour §7.6 precedence.
- §7.2 Lifecycle Declaration: fixed malformed table row; explicit Inception/Growth launch restriction; six-state enum tracked on Asset Register.
- §7.3 ABCd: removed "actuals against estimates" wording; clarified Acquire/Build are pre-merge planning only.
- §7.4 Asset Register row: fixed Cluster (one-or-more); Launch source (slug required, PR optional); Risk surface (None./list); Last review date (Chunk 4 merge / finalisation); Related docs (spec required, ADR/KNOWLEDGE optional). Updated §7.4.3 owner placeholder heading anchor format. Updated §7.4.4 split outcome to reuse Sunset Candidate/Sunset states. Added §7.4.5 cluster mutation procedure.
- §7.5 Compound Learning enum: corrected "seven" → "eight"; six-agent-instruction sub-enum named; clarified targets 4-7 are proposal targets, not v1 edits.
- §7.6 source-of-truth precedence: clarified intent.md amendment is pre-merge only.
- §8 RLS opt-out: tightened to "no new runtime agent execution path".
- §10 dependency graph: removed spurious Chunk 2 → Chunk 3 edge; clarified parallel-safe chunks.
- §10 Chunk 1-7 acceptance: every chunk recast in inspection-based terms; verdict strings in Chunk 7 aligned to §6.2.1 format; "Elaboration" removed from lifecycle sequence; Capability Registration / Compound Learning placed BEFORE Merge (consistent with §6.2 order invariant).
- §10 Chunk 4: added required `tasks/todo.md` task entry format with stable heading anchor.
- §10 Chunk 6: split files-touched vs runtime-artefacts; clarified runtime tasks/todo.md writes happen per-build, not in this chunk's PR.
- §11 Invariants: scoped invariants to agent step-list ordering and named non-agent diff list; added "no new hooks" line.
- §12 Self-consistency: corrected count reference to §4.6; corrected "no prose reference outside §4" to "no prose reference to a changed file outside §4.1/§4.2/§10".
- §13 Testing Posture: inspection-based primary verification; static gates as incidental-code-check only; explicit cross-reference to §14 for validation-script deferral.
- §14 Deferred Items: added validation script deferral; added Acquire/Build Asset Register expansion deferral (AUTO-DECIDED F14).
- §15 Open Questions: trimmed from 5 to 1 (only cluster-list completeness remains).

AUTO-DECIDED items routed to `tasks/todo.md`:
- F14 (ABCd Acquire/Build vs Asset Register schema) — accept-minimum-change variant. Acquire/Build remain pre-merge planning; Asset Register continues to carry only Carry/Decommission notes.

## Iteration 1 Summary

- Mechanical findings accepted: 49
- Mechanical findings rejected: 1 (F6 — false positive on link path)
- Directional findings: 0
- Ambiguous findings: 1 (F14)
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 1 (F14 — see tasks/todo.md)
- Spec commit after iteration: `90026032`
