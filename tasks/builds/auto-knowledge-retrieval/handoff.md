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
