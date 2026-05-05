# ChatGPT Spec Review Session — universal-brief-dev-spec — 2026-04-22T00-00-00Z

## Session Info
- Spec: docs/universal-brief-dev-spec.md
- Branch: claude/research-questioning-feature-ddKLi
- PR: #172 — https://github.com/michaelhazza/automation-v1/pull/172
- Started: 2026-04-22T00:00:00Z

---

## Round 1 — 2026-04-22T00-05-00Z

### ChatGPT Feedback (raw)

Executive summary: strong near production-ready contract. Architecture decisions sound. Gaps are tightening edges, ambiguity removal, and future-proofing. No major structural flaws.

Praise (don't change): artefact lifecycle model, source + freshness model, confidence + confidenceSource layer, RLS + orchestrator backstop.

Findings:
1. Missing "chain resolution algorithm" — how to compute the tip deterministically at scale (orphaned chains, tie-breaker).
2. No explicit ordering / timestamp field on artefacts — `createdAt` or `sequenceNumber` missing; debugging and replay non-deterministic.
3. `relatedArtefactIds` too loose — suggests `relatedArtefactType?` semantic hints enum.
4. Approval execution model missing failure edge clarity — orphaned execution, timeout → failed, heartbeat.
5. Budget context underspecified — what happens when exceeded; pre- vs post-check; capability vs orchestrator ownership.
6. `filtersApplied: []` guard — empty array must be explicitly emitted vs omitted.
7. Error code enum not formally defined — `unsupported_query`, `provider_error` etc. not in a canonical list.
8. Duplicate changelog entry — "v1 (this version)" and "v1 (initial)" both present.
9. Repetition in RLS section — "Primary enforcement: at the capability layer" repeated.
10. Ambiguity in "columns optional but recommended" — minimum shape expectation (name + type) not defined.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| 1. Chain resolution algorithm — tip computation, orphans, tie-breaker | reject | medium | §6.5 already defines the algorithm explicitly in 5 deterministic steps including orphan handling and out-of-order behaviour. ChatGPT missed the existing prose. No edit needed. |
| 2. Ordering / timestamp field missing on artefacts | accept (in-spec clarification only) | medium | The contract (`briefResultContract.ts`) owns the `createdAt` field on artefacts — out of scope. However, §6.5's resolver did not state its ordering guarantee (arrival position vs timestamp). Added a note clarifying that `ArtefactChainState.artefacts` is arrival-ordered and tie-breaking within orphan sets uses array position, not time. Also notes that `conversation_messages.createdAt` exists for persistence audit but is not read by the resolver. |
| 3. `relatedArtefactIds` semantic hints / `relatedArtefactType` enum | defer | low | Purely contract territory — `relatedArtefactIds` is on `BriefArtefactBase` in `briefResultContract.ts`. Any type-hint addition requires a separate PR against main. Deferred to contract-revision task. |
| 4. Approval execution edge cases — orphaned execution, timeout→failed, heartbeat | defer | medium | Execution lifecycle semantics (timeout, heartbeat, orphaned `executionId`) belong in `docs/brief-result-contract.md` on the `BriefApprovalCard.executionStatus` field. This spec's §15.5 handles out-of-order arrival; full lifecycle edges are contract territory. Deferred. |
| 5. Budget enforcement rules — what happens on exceed, pre/post check, capability vs orchestrator | defer | medium | `BriefBudgetContext` semantics + enforcement ownership are contract territory. `briefResultContract.ts` + `docs/brief-result-contract.md` own these rules. This spec correctly references the existing `runCostBreaker` for enforcement — no gap in-spec. Deferred to contract-revision task. |
| 6. `filtersApplied: []` guard — empty array must be emitted | defer | low | `filtersApplied` is a field on `BriefStructuredResult` in `briefResultContract.ts`. Semantic rules for empty-vs-omitted belong there. Out of scope for this spec. |
| 7. Error code enum standardisation | accept (in-spec note only) | medium | The canonical enum lives in `briefResultContract.ts` — out of scope. However, the spec uses `'internal_error'` and `'unsupported_query'` as bridge-level codes without flagging that they must match the contract. Added a note in §6.4 directing implementers to keep these in sync with the canonical enum and review both §6.1 and §6.4 if the contract is revised. |
| 8. Duplicate changelog entry — "v1 (this version)" + "v1 (initial)" | reject | low | No changelog section exists in this spec file. ChatGPT's finding targets the dev brief (`docs/universal-brief-dev-brief.md`), which is out of scope for this session. No edit. |
| 9. Repetition in RLS section | reject | low | The repetition serves explicit defence-in-depth readability — each section is self-contained on purpose. Removing it trades clarity for brevity with no functional benefit. Stylistic preference; no functional impact. |
| 10. "columns optional but recommended" minimum shape ambiguity | defer | low | `columns` is on `BriefStructuredResult` + `BriefColumnHint` in `briefResultContract.ts`. Minimum shape expectations (name + type) belong in the contract doc. Out of scope. |

### Applied

- §6.5 "Algorithm" block: added **Ordering guarantee** paragraph — clarifies that `ArtefactChainState.artefacts` is ordered by arrival position (append-only), not by timestamp; tie-breaking within orphan sets uses array position; `conversation_messages.createdAt` is audit-time only and not read by the resolver.
- §6.4 "Orchestrator-side validator" block: added **Note on `errorCode` values** — flags that `'internal_error'` and `'unsupported_query'` referenced in this spec are a subset of the canonical enum in `briefResultContract.ts`; implementers must keep these values in sync; review §6.1 + §6.4 on contract revision.

### Integrity check

0 issues found this round.

**Top themes:** Most findings targeted the cross-branch artefact contract (`briefResultContract.ts` / `docs/brief-result-contract.md`), which is already merged to main and out of scope for this spec. 7 of 10 findings were deferred or rejected on that basis. The 2 accepted edits addressed in-spec ambiguities: ordering guarantee for the lifecycle resolver and sync-point annotation for contract-referenced error codes.

---

## Round 2 — 2026-04-22T01-00-00Z

### ChatGPT Feedback (raw)

Executive summary: solid shape after round 1. Round 2 focuses on eliminating ambiguity under real-world failure conditions and tightening cross-boundary responsibilities. 3 substantive findings + 2 minor.

1. Subtle ambiguity: "tip of chain" vs partial knowledge — what happens when consumer doesn't have full chain yet (streaming / reconnect / log truncation → multiple apparent tips). Suggested: clarify that partial views are allowed to be temporarily inconsistent; most-recently-received artefact should be treated as active candidate until full chain resolved.

2. Execution lifecycle: missing terminal guarantee — every execution MUST eventually emit terminal state (completed or failed); systems responsible MUST ensure eventual resolution. Suggested: "Every execution MUST eventually emit a terminal state. Systems responsible MUST ensure eventual resolution even in failure scenarios."

3. Budget context: ownership still slightly unclear — `budgetContext` could be read as enforcement signal rather than purely descriptive. Suggested: add explicit line that `budgetContext` is descriptive only and MUST NOT be used by capabilities to enforce limits; enforcement owned by orchestrator.

4. Minor: tighten "source is user-relevant" — suggested: "source MUST be surfaced to the user when it materially affects trust (e.g. stale canonical vs live data)."

5. Optional cleanup: "v1 (this version)" + "v1 (initial)" duplicate changelog still present in contract file — not blocking, worth cleaning.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| 1. Partial-chain / multiple candidate tips — resolver behaviour under incomplete local knowledge | accept | high | Real distributed-systems edge case not addressed in §6.5. The algorithm defines tip-resolution assuming complete knowledge, but reconnects and mid-stream pagination produce legitimate multi-tip transient states. Added a Partial-knowledge behaviour paragraph to §6.5 specifying MUST-render-all / MUST-converge obligations. In-spec resolver behaviour, not contract territory. |
| 2. Execution terminal guarantee — every execution must reach completed or failed | defer | medium | Execution lifecycle (terminal state guarantee, timeout → failed, heartbeat) belongs in `docs/brief-result-contract.md` on `BriefApprovalCard.executionStatus`. Consistent with round 1 deferral #4. This spec does not own executionStatus semantics. |
| 3. `budgetContext` descriptive-only / enforcement ownership clarification | defer | medium | `BriefBudgetContext` field semantics and enforcement ownership are in `briefResultContract.ts` + `docs/brief-result-contract.md`. Consistent with round 1 deferral #5. The spec already references `runCostBreaker` for enforcement — no in-spec gap. |
| 4. `source` must be surfaced when trust-affecting | accept | medium | Client rendering obligation for `source` is in-spec territory (§8.3 directive rules). The field definition is in the contract, but when the client must surface it to users is a rendering concern this spec owns. Added a bullet to §8.3 directive rules: `source` MUST be surfaced when it materially affects trust, with specific conditions (`canonical` + non-trivial `freshnessMs`, or `hybrid`). Visual treatment deferred to Phase 2 UX. |
| 5. v1/v1 duplicate changelog in contract file | defer | low | Targets `docs/brief-result-contract.md` which is already merged to main and out of scope for this spec. Consistent with round 1 reject #8 (same artefact, same reasoning). |

### Applied

- §6.5 "Algorithm" block: added **Partial-knowledge behaviour** paragraph — specifies that multi-tip transient states under incomplete local knowledge are expected and not errors; consumers MUST render all candidate tips and converge as missing artefacts arrive; most-recently-received artefact is the active candidate during resolution.
- §8.3 "Directive rules" block: added bullet — `source` MUST be surfaced to users when it materially affects trust (stale canonical or hybrid); `StructuredResultCard` is the primary surface; exact visual treatment is a Phase 2 UX decision.

### Integrity check

0 issues found this round.

**Top themes:** Round 2 feedback was narrower and more production-focused than round 1. 2 accepted / 2 deferred / 1 deferred (contract). Both accepted edits are in-spec behavioural obligations for the client-side lifecycle resolver and the artefact rendering layer — neither touches the contract. The 3 deferred items (terminal guarantee, budgetContext ownership, changelog duplicate) all target the cross-branch contract doc, consistent with the round 1 deferral pattern.

---

## Round 3 — 2026-04-22T02-00-00Z

### ChatGPT Feedback (raw)

Done.

Round 3 verdict: finalize the spec. The remaining items are correctly classified as contract-level follow-up, not reasons to keep iterating on docs/universal-brief-dev-spec.md.

What I'd lock in as the final position:

Your applied round 2 changes were the right last-mile hardening. Partial-knowledge chain resolution and mandatory surfacing of materially trust-affecting source/freshness are exactly the kinds of things that stop real UX drift later.
The three deferred items should stay deferred. They are shared contract concerns, not spec-specific gaps.
There is no meaningful spec-level hole left that justifies another review pass.

One small confirmation only: the duplicate v1 changelog issue really does live in the contract doc rather than this spec, so leaving it out of this review was the correct call.

Final status: docs/universal-brief-dev-spec.md is review-complete and implementation-ready.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| Session closure — no new findings; DONE verdict issued | n/a | n/a | ChatGPT confirmed spec is implementation-ready; all prior deferrals are correctly classified as contract-revision work; no additional edits warranted. |

### Applied

None. No spec edits this round — DONE verdict with no new actionable findings.

### Integrity check

0 issues found this round. No edits applied; no forward references or contradictions to check.

**Top themes:** ChatGPT confirmed finalization. The two rounds of accepted edits (ordering guarantee in §6.5, errorCode sync note in §6.4, partial-knowledge behaviour in §6.5, source trust-surfacing in §8.3) represent the complete set of in-spec improvements. All remaining deferred items are contract-territory and route to a separate contract-revision task.

---

## Final Summary

- Rounds: 3
- Total findings classified: 15 (Round 1: 10 | Round 2: 5 | Round 3: 0)
- Accepted: 4 | Rejected: 4 | Deferred: 7
  - Note: Round 2 findings 2 + 3 (execution terminal guarantee, budgetContext ownership) are the same family as Round 1 findings 4 + 5 — consistently deferred both rounds; counted as distinct findings but map to the same contract-revision tasks.
- Index write failures: 0 (clean)
- Deferred to tasks/todo.md § Spec Review deferred items / universal-brief-dev-spec (2026-04-22):
  - Add optional `relatedArtefactType` hint enum to artefact contract — contract territory, separate PR against main
  - Specify approval execution edge cases (timeout, orphaned-execution, heartbeat) — contract territory
  - Specify budget enforcement rule (`budgetContext` descriptive-only, enforcement orchestrator-owned) — contract territory
  - Guard: `filtersApplied: []` MUST be emitted when no filters apply — contract territory
  - Standardise canonical `errorCode` enum in `BriefErrorResult` — contract territory
  - Define minimum shape expectation for `BriefColumnHint` — contract territory
  - Clean up duplicate `v1 (this version)` / `v1 (initial)` changelog entries in `docs/brief-result-contract.md` — contract territory
  - Add execution terminal-state guarantee — contract territory
- KNOWLEDGE.md updated: yes (1 entry)
- PR: #172 — spec changes ready at https://github.com/michaelhazza/automation-v1/pull/172

---

## Addendum — Round 4 (post-finalization)

ChatGPT delivered one additional optional round after the round 3 DONE verdict — top-line verdict unchanged ("ship it"), but flagged 2 minor polish items. Session was re-opened briefly to adjudicate both.

### ChatGPT feedback (raw, summarised)

1. Subtle UX gap: can an `invalidated` artefact be the tip of a chain? Optional clarification requested — "An invalidated artefact MAY be the tip but MUST NOT be rendered as authoritative content."
2. Subtle consistency edge: can `rowCount` change across artefact updates in the same chain (e.g. pending → final refinement)? Optional clarification requested.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| Invalidated artefact as tip — clarify rendering rule | reject | low | Already covered — docs/universal-brief-dev-spec.md:1111 (§6.5 rendering consequences) already states: "`status: 'invalidated'` at the tip renders its parent as stale; the invalidation artefact is not rendered as primary content." ChatGPT missed the existing prose. |
| `rowCount` MAY change across artefact updates within a chain | defer (user-approved inline) | low | Contract territory — `BriefStructuredResult.rowCount` is defined in `shared/types/briefResultContract.ts:163`. Same family as the 7 other round 1–2 contract deferrals; routes to the existing contract-revision backlog in tasks/todo.md. |

### Applied

None. No spec edits this round.

### Addendum summary (pre-deferred-review)

- Round 4 findings: 2 (1 rejected, 1 deferred user-approved)
- Totals after round 4: 17 findings (Round 1: 10 | Round 2: 5 | Round 3: 0 | Round 4: 2) — 4 accepted, 5 rejected, 8 deferred

---

## Addendum — Deferred-items review (post-round-4)

User reviewed all 9 accumulated deferrals and asked whether any should be promoted into this spec before finalisation. Assessment re-classified each item as:

- (a) pure contract-schema change → stay deferred (but out of active backlog)
- (b) spec-level behavioural rule → candidate for promotion

**1 item promoted, 8 archived.**

### Decisions

| Finding | Previous | New decision | Rationale |
|---------|----------|--------------|-----------|
| `budgetContext` is descriptive-only + enforcement ownership | deferred (R1-F5, R2-F3) | **accept (promoted)** | Spec-level behavioural rule, not a contract schema change. Applied as a new paragraph at the end of §6.4 stating: capabilities MUST NOT read `budgetContext` for enforcement; orchestrator owns enforcement via `runCostBreaker`; over-budget emits synthesised `BriefErrorResult`; capabilities consume `budgetContext` only for UI rendering intent. Prevents capability drift from day 1. |
| `relatedArtefactType` hint enum | deferred | archived (contract territory) | Pure contract field addition — lives in `shared/types/briefResultContract.ts`. No spec action. |
| Approval execution edge cases (timeout / orphan / heartbeat) | deferred | archived (IEE subsystem) | IEE-owned behaviour, not this spec's scope. |
| `filtersApplied: []` must-emit guard | deferred | archived (contract semantic) | `BriefStructuredResult.filtersApplied` semantics live in the contract. |
| Canonical `errorCode` enum | deferred | archived (contract field) | Already covered by §6.4 sync note pointing implementers at the canonical enum. |
| `BriefColumnHint` minimum shape | deferred | archived (contract field) | Pure contract schema. |
| Duplicate `v1/v1` changelog | deferred | archived (contract doc) | Lives in `docs/brief-result-contract.md`, not this spec. |
| Execution terminal-state guarantee | deferred | archived (IEE subsystem) | IEE lifecycle ownership. |
| `rowCount` MAY change across updates | deferred (R4) | archived (contract semantic) | `BriefStructuredResult.rowCount` semantics live in the contract. |

### Applied

- **§6.4 budget enforcement ownership** — new paragraph added between "capability test harness" block and the `---` separator before §6.5. Enforces ownership separation (capabilities descriptive-only; orchestrator authoritative via `runCostBreaker`). Prevents capability drift without modifying the contract.

### Backlog action

All 8 archived items removed from `tasks/todo.md § Spec Review deferred items / universal-brief-dev-spec (2026-04-22)`. Historical record preserved in this log and in `tasks/review-logs/_index.jsonl`. If any archived item later matters, it will be filed under a dedicated contract-revision spec or PR against main — not as a deferred line on this review.

### Final totals (post-addendum)

- Rounds: 4 (plus post-round deferred-items review)
- Total findings classified: 17
- **Accepted:** 5 (was 4; +1 from promotion)
- **Rejected:** 5
- **Deferred (active backlog):** 0 (was 8; all archived)
- **Archived (contract-territory, logged only):** 8
- Spec final state: `docs/universal-brief-dev-spec.md` implementation-ready — latest commit will include the §6.4 budget enforcement paragraph.
- PR: #172
