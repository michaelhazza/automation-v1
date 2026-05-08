# Handoff — auto-knowledge-retrieval

**phase_status:** PHASE_1_COMPLETE
**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new Claude Code session)

---

## Identity

| Field | Value |
|---|---|
| Build slug | `auto-knowledge-retrieval` |
| Branch | `auto-knowledge-retrieval` |
| Spec path | `tasks/builds/auto-knowledge-retrieval/spec.md` |
| Spec line count | 875 |
| Last spec commit | `8a44844c` (`docs(auto-knowledge-retrieval): chatgpt round 1 — Item A resolution (always-available telemetry)`) |
| UI-touching | yes |
| Source brief | `docs/auto-knowledge-retrieval-dev-brief.md` (Rev 4) |

## Mockup state

| Item | Value |
|---|---|
| Mockup directory | `prototypes/auto-knowledge-retrieval/` |
| Mockup count | 8 prototypes |
| Pre-approval | Approved by operator across **5 prior iteration rounds** (pre-spec mockup loop) |
| Mockup log | `tasks/builds/auto-knowledge-retrieval/mockup-log.md` |

**Files:**
- `index.html` (entry / nav harness)
- `knowledge-documents-tab.html`
- `knowledge-bundles-tab.html`
- `knowledge-files-tab.html`
- `agent-data-sources.html`
- `add-to-knowledge-modal.html`
- `bundle-edit-modal.html`
- `document-detail-modal.html`

**Phase 2 implication:** mockups are the design source of truth. `feature-coordinator` should reference these during plan decomposition rather than re-running mockup loops. The spec already cross-references the prototype paths; do not regenerate mockups unless an architectural surprise during build forces a UI-shape decision the prototypes don't cover.

## spec-reviewer (Codex) summary

| Field | Value |
|---|---|
| Iterations | 5 / 5 (lifetime cap reached) |
| Mechanical findings applied | 20 |
| Verdict | Cap reached; remaining items routed to ChatGPT round |
| Final report | `tasks/review-logs/spec-review-final-auto-knowledge-retrieval-2026-05-08T04-25-47Z.md` |

Lifetime cap reached is **not a failure signal** — it's the normal upper bound for spec-reviewer per the agent contract. Remaining directional concerns were caught and resolved by the ChatGPT round below.

## chatgpt-spec-review summary

| Field | Value |
|---|---|
| Mode | Manual (operator-driven, ChatGPT-web responses pasted into session) |
| Rounds conducted | 1 |
| Round 2 | Declined by operator — spec frozen |
| Total findings | 9 |
| Mechanical (auto-applied) | 7 — items 1, 3, 4, 5, B, C, D |
| Confirmed-no-change | 1 — item 2 (per-document embedding model) |
| Operator-decided | 1 — item A (always-available starvation telemetry; option a chosen) |
| Findings unresolved | 0 |
| Triage log | `tasks/review-logs/chatgpt-spec-review-auto-knowledge-retrieval-2026-05-08T04-25-47Z.md` |

### Spec commit timeline (review phase)

| Stage | Commit |
|---|---|
| End of spec-reviewer iter 5 | `ec39dc30` |
| ChatGPT round 1 mechanical edits applied | `48d8c7b6` |
| Item A operator-decision applied (telemetry option a) | `8a44844c` (current head of spec) |

## Phase 2 entry point

Open a **new Claude Code session** and invoke:

```
launch feature coordinator
```

Per CLAUDE.md model guidance:
- **Plan decomposition:** Opus (`architect` invocation, plan.md authored under `tasks/builds/auto-knowledge-retrieval/plan.md`).
- **Plan gate:** `feature-coordinator` will present the finalised plan and stop. Operator reviews plan.md, then manually switches to Sonnet before execution.
- **Execution:** Sonnet (`subagent-driven-development` against the chunked plan).

## Notes for the build phase

1. **Mockups already exist and were operator-approved over 5 rounds.** Do not re-run `mockup-designer`. Plan chunks that touch UI should reference `prototypes/auto-knowledge-retrieval/` paths verbatim. Any deviation from prototype shapes during build needs an explicit operator OK — the prototypes are baseline-locked.

2. **Spec uses tier numbering 1..5 for scope, distinct from the platform's tier-1/tier-2 always-pinned distinction in `memory_blocks`.** Do not conflate. The spec's five-tier scope refers to `reference_document_data_sources` (organisation, subaccount, agent, scheduled_task, task_instance). The platform's `memory_blocks.tier` refers to always-pinned vs domain-matched. Two unrelated tier dimensions; plan reviewers should be alert to ambiguity in chunk descriptions.

3. **Phase 1 migration `0290`** is referenced for the scope tier CHECK constraint (§4.1). Verify the next free migration number at plan time — if other branches have landed migrations since, increment and update the spec via a directional ADR/spec-amendment, not a silent rename.

4. **Retrieval version completeness invariant (§13.1, §16) is load-bearing.** The chunking job must not flip `retrieval_version_id` until the full chunk set exists for `active_embedding_model`. This needs explicit test coverage in `documentRetrievalServicePure.test.ts` (named in §17).

5. **Bounded observability payload contract (§11.4) is non-negotiable.** Truncation values are constants in `retrievalObservabilityService`. Tests must assert byte-bounded payloads; replays must be byte-identical (§10.8 ranking determinism invariant).

6. **Always-available telemetry (§11.5)** — preventive surface, not runtime safety net. Soft warning in Documents tab at `doc_count >= 30` OR `token_cost >= 30000`. Constants in `retrievalObservabilityService` for v1; per-org overrides explicitly deferred.

## Known directional notes for build phase

These are not blockers — surfaced during review for the build team to keep an eye on:

1. **Always-available threshold values (`doc_count >= 30`, `token_cost >= 30000`)** are first-cut constants chosen without production data. Post-launch, these may want operator tuning once real telemetry from `retrieval.always_available.doc_count` / `retrieval.always_available.token_cost` lands. Spec explicitly defers configurability to a post-launch amendment when per-org overrides exist on `organisations`.

2. **Observability payload caps (§11.4)** are deterministic by design (sort + slice, fixed N), but if production traces look thin or if the truncation indicators show frequent hits, consider:
   - Backfilling per-array histograms before raising N (raising caps is the wrong first move).
   - Migrating to the deferred dedicated `retrieval_events` table noted in §15 — this is the documented escalation path, not a cap raise.

3. **Per-document embedding model (item 2 in ChatGPT review)** — confirmed correct, no simplification to global pointer. If a future architectural pressure suggests a global pointer would simplify a hot path, treat it as a spec amendment, not a refactor — the per-document model is intentional (rolling migration, no lockstep reindex events).

4. **Tie-break determinism comparator chain** — `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`. The `id ASC` tiebreaker is the determinism anchor. Build team must not reorder, drop, or insert non-deterministic columns. Tests in `retrievalServicePure.test.ts` should pin this chain.

5. **Document-level relevance** is `MAX(chunk.finalScore)`, not average / sum / weighted. Trivially easy to regress during ranking-tweak refactors; pin via test.

## Open questions for Phase 2

None blocking. All Phase 1 ambiguity was resolved during the spec-reviewer + chatgpt-spec-review rounds. Any new architectural questions surfaced during plan decomposition should be routed to a brief Opus session, not absorbed into plan chunks silently.

## Decisions made in Phase 1

- Retain per-document embedding model; do **not** simplify to a global pointer (item 2).
- Include lightweight always-available starvation telemetry in v1 (item A, option a) — derived metrics, soft UI warning, mode-change events. Hard caps deferred.
- Lock retrieval version completeness invariant: `retrieval_version_id` MUST always reference a version whose full chunk set exists for `active_embedding_model` (item 1).
- Lock bounded observability payload contract with deterministic top-N truncation (items 3 + B).
- Operator-facing copy: `"Context limits prevented some always-available documents from loading."` (item 4).
- Lock five-tier scope CHECK invariant: exactly one tier active per row, organisation = all FK columns NULL (item 5).
- Lock ranking determinism: comparator chain `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`; document relevance = `MAX(chunk.finalScore)` (items C + D).
- Round 2 ChatGPT review declined; spec frozen at `8a44844c`.

---

## Phase 3 (FINALISATION) — complete

**phase_status:** PHASE_3_COMPLETE
**Completed at:** 2026-05-08T12:06:00Z
**HEAD at finalisation:** `9a4a4557`
**PR number:** #274 — https://github.com/michaelhazza/automation-v1/pull/274
**ready-to-merge label applied at:** 2026-05-08T12:06:00Z

### State-machine note

Phase 3 entry was permitted with `tasks/current-focus.md` `status: BUILDING` (not the `REVIEWING` value the entry guard normally enforces). Phase 2 review pipeline was complete per the operator's explicit kickoff context and verified against branch commits — `33f30ae4` (spec-conformance), `9535d59c` (adversarial fixes), `384bd7cd` (pr-reviewer fixes), `9662b8b7` (dual-reviewer fixes), `9a4a4557` (external ChatGPT review follow-ups). The state field was never advanced from `BUILDING → REVIEWING` during Phase 2; not a correctness issue, just a missing pointer update. Phase 3 advances the field directly to `MERGE_READY` per its standard contract.

### Phase 2 review pipeline summary (per operator kickoff)

| Reviewer | Verdict | Disposition |
|---|---|---|
| spec-conformance | NON_CONFORMANT | 14 directional gaps deferred as `AKR-CONF-1..14` |
| adversarial-reviewer | HOLES_FOUND | 3 confirmed-holes FIXED (`9535d59c`); 5 likely-holes deferred (`AKR-ADV-2/3/5/W1/W2`) |
| pr-reviewer | CHANGES_REQUESTED → APPROVED | 4 mechanical fixes applied (`384bd7cd`); 9 design/UX deferred (`PR-REV-B2/B3/S2/S3/S4/S6/N1-N3`) |
| dual-reviewer | APPROVED (2 Codex iters) | 2 P1 RLS-context bugs FIXED (`9662b8b7`) — 3 worker files |
| chatgpt-pr-review | **SKIPPED** | Operator instructed autonomous mode; manual ChatGPT-web loop incompatible. REVIEW_GAP flagged (matches consolidation-govern PR #273 precedent) |
| External PR review (ad-hoc ChatGPT) | APPROVE-with-follow-up | 4 net-new items appended as `AKR-EXT-1..4` (`9a4a4557`); 95% overlap with existing deferred items |

### REVIEW_GAP

`chatgpt-pr-review: SKIPPED` — operator chose autonomous mode (no manual ChatGPT-web round trips). The build did receive: spec-conformance, pr-reviewer (re-checked APPROVED after mechanical fixes), adversarial-reviewer, dual-reviewer (Codex APPROVED after 2 iterations), and an external ChatGPT review. Consider running `chatgpt-pr-review` retrospectively against the merged commit if the build's risk profile warrants further review.

### Phase 3 actions

| Step | Result |
|---|---|
| S2 branch sync | No-op — branch already contained `origin/main` HEAD `ac20aa2f`. 0 commits behind main, no migration collision (branch carries 0288–0294, main capped at 0287). |
| G4 regression-guard | GREEN. `npm run lint` 0 errors / 849 warnings (baseline level, not new). `npm run typecheck` clean (both root + server tsconfig). |
| PR existence | Confirmed open: PR #274. |
| chatgpt-pr-review | Skipped per operator (autonomous mode). REVIEW_GAP recorded above. |
| Doc-sync sweep | Verdicts table below. |
| KNOWLEDGE.md | 8 patterns appended (worker-opt-out FORCE-RLS reads, embedding silent-truncation observability, pure-helper-return-discarded bug shape, retrieval-version completeness read-path enforcement, document-promotion atomicity audit-anchor, retrieval-ranker generic-core extraction, bounded observability payload pattern, always-available preventive UI surface). |
| tasks/todo.md cleanup | No items closed — operator explicitly directed deferred items to remain in place. 33 items in `AKR-CONF-*`, `AKR-ADV-*`, `PR-REV-*`, `AKR-EXT-*` namespaces left intentionally. |
| current-focus.md | Status `BUILDING → MERGE_READY`. Active fields cleared. `last_merge_ready_*` keys recorded. |
| ready-to-merge label | Applied 2026-05-08T12:06:00Z. CI runs G5 (full lint + typecheck + test gates). |

### Doc-sync sweep verdicts

Investigation procedure ran per `docs/doc-sync.md` for every registered doc.

| Doc | Verdict |
|---|---|
| `architecture.md` | **yes** — added new § *Document Retrieval Pipeline* covering five-tier scope model, modes (auto / always-available / reference-only), source provenance, the seven new/extended tables (0288–0294), retrieval version completeness invariant, ranking determinism, generic ranker shared with memory blocks, bounded observability payload contract, always-available telemetry, files-vs-documents split, key files list, routes table. Added 4 rows to § *Key files per domain*: modify retrieval pipeline; modify Knowledge Documents/Files tabs; add new scope tier; promote a file to Knowledge document. |
| `docs/capabilities.md` | **yes** — extended § *Memory & Knowledge System* with 4 new bullets covering semantic document retrieval, three retrieval modes, Add to Knowledge promotion, and always-available budget guidance. Vendor-neutral, editorial-rules compliant. Added Changelog entry (2026-05-08). |
| `docs/integration-reference.md` | **n/a** — checked grep terms `retrieval`, `reference_document`, `document_chunk`, `loading_mode`, `always_available`; zero hits. No integration behaviour change in this build. |
| `CLAUDE.md` | **n/a** — checked grep terms above; zero hits. No build-discipline / agent-fleet / locked-rule changes in this build. |
| `DEVELOPMENT_GUIDELINES.md` | **n/a** — checked grep terms above; zero hits. No new schema invariant, gate, or §8 rule introduced — the FORCE-RLS-worker-opt-out finding is captured in KNOWLEDGE.md instead (per CLAUDE.md §13: rules belong in DEVELOPMENT_GUIDELINES.md, observations in KNOWLEDGE.md; this is closer to an observation than a hard rule). |
| `CONTRIBUTING.md` | **n/a** — no lint-suppression / `// reason:` policy change. |
| `docs/frontend-design-principles.md` | **yes** — already updated in branch (commit during Phase 2 mockup pass): added § *Recurring UI patterns* with 9 sub-sections (three-dot menus, source badges, token/cost/size info, stat tiles, explainer banners, admin-only controls, default-case controls, modal advanced expanders, em-dashes, sub-text on rows) plus 10 new pre-design checklist items. Already merged to branch HEAD. |
| `KNOWLEDGE.md` | **yes** — 8 patterns appended (listed above in Phase 3 actions row). |
| `docs/spec-context.md` | **n/a** — spec-review session only; not applicable to PR finalisation. |
| `docs/decisions/` (ADRs) | **no — rationale captured in spec.md instead.** Spec § *Decisions made in Phase 1* (in this handoff doc) captures the durable architectural choices (per-document embedding model, retrieval version completeness, ranking comparator chain, five-tier scope CHECK shape, always-available telemetry shape). Spec.md is the authoritative artefact for build-specific decisions; promoting to standalone ADRs would duplicate. If any of these decisions get cited 3+ times in future specs, promote then. |
| `docs/context-packs/` | **n/a** — no architecture.md anchor changes. New § *Document Retrieval Pipeline* anchor added but no existing pack referenced the prior section structure. |
| `references/test-gate-policy.md` | **n/a** — no test-gate posture change. |
| `references/spec-review-directional-signals.md` | **n/a** — no new spec-review classifier signal repeated >2 times. |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | **n/a** — repo-specific application changes; framework version 2.1.0 unchanged. |

### Spec deviations reviewed

The 14 `AKR-CONF-*` directional gaps from spec-conformance are intentional design-decision deferrals (e.g. AKR-CONF-1/2 simplified-ranker design vs spec contract; AKR-CONF-5 5-tier candidate-pool reduced to 3-tier in `retrievalService` pending design resolution). These are NOT regressions — each is a spec-vs-impl divergence the build team chose to ship with, routed to backlog for explicit design resolution rather than rushed in-build. Operator-acknowledged: "do not implement them as part of finalisation".

### Outstanding deferred items (intentional, in `tasks/todo.md`)

| Namespace | Count | Notes |
|---|---|---|
| `AKR-CONF-*` | 14 | spec-conformance directional gaps (e.g. CONF-1/2 simplified ranker, CONF-5 3-tier candidate pool) |
| `AKR-ADV-*` | 5 | adversarial-reviewer likely-holes (W1/W2/2/3/5) |
| `PR-REV-*` | 9 | pr-reviewer design/UX strong-recommendations (B2, B3, S2, S3, S4, S6, N1, N2, N3) |
| `AKR-EXT-*` | 4 | external ChatGPT review follow-ups; 95% overlap with above |

Total: 33 items deferred, all named in `tasks/todo.md` for post-merge backlog grooming.

### Final verdict

**MERGE_READY.** PR #274 labelled `ready-to-merge` at 2026-05-08T12:06:00Z. CI runs the full G5 gate suite. Operator drives merge sequence per Phase 3 end-of-phase prompt.
