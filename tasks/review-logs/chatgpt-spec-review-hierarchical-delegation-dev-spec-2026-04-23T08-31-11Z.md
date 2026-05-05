# ChatGPT Spec Review Session — hierarchical-delegation-dev-spec — 2026-04-23T08-31-11Z

## Session Info
- Spec: docs/hierarchical-delegation-dev-spec.md
- Branch: claude/paperclip-agent-hierarchy-9VJyt
- PR: #181 — https://github.com/michaelhazza/automation-v1/pull/181
- Started: 2026-04-23T08:31:11Z
- Prior review history: Full `spec-reviewer` loop (5 iterations, 75 mechanical fixes applied, 5 directional items logged in tasks/todo.md). Spec considered implementation-ready; ChatGPT pass is final polish.

---

## Round 1 — 2026-04-23T08-38-04Z

### ChatGPT Feedback (raw)

Eight findings surfaced in the ChatGPT review pass:

1. **Snapshot vs live-state concern on `HierarchyContext`** — ChatGPT flagged that a run using a per-run hierarchy snapshot can act on stale data if the graph mutates mid-run.
2. **`subaccountNoRoot` — hard block vs fallback** — ChatGPT questioned whether zero-roots should block dispatch outright rather than fall through to the org Orchestrator.
3. **Error contract precision** — ChatGPT noted the structured-error shape across `delegation_out_of_scope`, `cross_subtree_not_permitted`, and `hierarchy_context_missing` is not uniformly spec'd — `context` payload varies by code, `runId` is only present on one example, and the enum/extensibility posture is implicit.
4. **Hierarchy mutation during run** — ChatGPT raised the concern about skills re-reading the hierarchy mid-run.
5. **Nearest-common-ancestor routing** — ChatGPT suggested automatic NCA-based routing for cross-subtree reassigns rather than root-only.
6. **Max delegation depth** — ChatGPT asked whether a deeper MAX_DEPTH or dynamic depth limit is needed.
7. **Trace ID invariant** — ChatGPT flagged that the `runId` threading across `agent_runs.parentRunId` / `agent_runs.handoffSourceRunId` / `delegation_outcomes.runId` / `agent_execution_events.context.runId` is load-bearing for the §7.2 DAG and §17 metrics but is not stated as a single invariant anywhere; call-sites could drift silently.
8. **Violation sampling / alerting** — ChatGPT suggested a sampling-based alerting tier above the rejection-rate metric in §17.3.

### Recommendations and Decisions

| # | Finding | Agent Recommendation | User Decision | Severity | Rationale |
|---|---------|----------------------|---------------|----------|-----------|
| 1 | Snapshot vs live-state on `HierarchyContext` | reject | reject | medium | §4.1 "Immutability contract" + §10.1 "no caching" already pin the snapshot semantics and justify per-run freshness; §15 "Risks & mitigations" covers the stale-context failure mode explicitly. Re-litigating would duplicate existing prose. |
| 2 | `subaccountNoRoot` block vs fallback | reject | reject | medium | §6.6 documents the fallback to the org-level Orchestrator; §10.5 explains the detector is async/backstop; §16.3 names zero-roots as an acceptable steady state. Hard-blocking would regress Brief dispatch during healthy operator configuration windows. |
| 3 | Error contract precision | apply | apply | high | Genuine gap — the three error examples diverge on `context` shape (only `hierarchy_context_missing` carried `runId`; `hierarchy_context_missing` used `agentId` where the other two used `callerAgentId`). Uniform contract clause added to §4.3; all three examples aligned to include `runId` + `callerAgentId`; extensibility rule (additive-only) made explicit. |
| 4 | Hierarchy mutation during run | reject | reject | low | §4.1 "Immutability contract" already pins `Readonly<HierarchyContext>` + `Object.freeze()` runtime enforcement + prohibition on re-querying mid-run. Duplicate concern with #1. |
| 5 | Nearest-common-ancestor routing | defer | defer | medium | Valid future capability but requires an algorithmic design + UX decision about how the NCA is surfaced to the caller; pulls in prompt-engineering work to teach agents when to use it. Out of scope for v1 where root-only is a deliberate simplification. |
| 6 | Max delegation depth | reject | reject | low | §4.1 fixes `MAX_DEPTH = 10`, §6.1 validates it at write time, §15 covers the "depth exceeded" failure mode. Automation OS agent hierarchies are intentionally shallow (3–4 levels common); raising the cap adds validation cost with no known use case. |
| 7 | Trace ID invariant | apply | apply | high | Load-bearing invariant that cut across §4.3, §4.4, §6.3, §6.4, §7.2 without being stated once. New §10.6 "Run-id trace continuity invariant" added; §10.6 → §10.7 renumber for consistency pass; consistency-pass checklist extended with the trace-continuity tick. |
| 8 | Violation sampling / alerting | defer | defer | low | Valid ops tooling improvement but an ops/observability concern, not a spec concern — belongs in the post-launch ops playbook or a dedicated monitoring spec, not in the delegation contract. |

### Applied (only items the user approved as "apply")

- **§4.3 — Uniform error-contract clause.** Added a "Uniform contract (applies to every error code in this section)" paragraph pinning: closed enum for `code`, human-readable `message` posture, stable minimum `context` shape (`runId` + `callerAgentId` mandatory, per-code identifiers required when resolvable, additive-only extensibility), and explicit mirror to `agent_execution_events`.
- **§4.3 — Example alignment.** Added `runId` to `delegation_out_of_scope` and `cross_subtree_not_permitted` examples. Renamed `agentId` → `callerAgentId` in the `hierarchy_context_missing` example for consistency.
- **§10.6 — Run-id trace continuity invariant (new).** States the cross-cutting invariant that `runId` threads through `agent_runs.parentRunId` / `agent_runs.handoffSourceRunId` / `delegation_outcomes.runId` / `agent_execution_events.context.runId` by construction at the skill handler's write site, with enumerated enforcement points in §6.3, §6.4, §10.3, §4.3. No reconciliation path — broken pointer is a bug.
- **§10.7 — Consistency pass (renumbered).** Former §10.6 renumbered; added a "Run-id trace continuity" tick to the checklist.

### Deferred (routed to `tasks/todo.md`)

- #5 Nearest-common-ancestor routing — deferred to backlog.
- #8 Violation sampling / alerting — deferred to backlog.

### Rejected (no edits — spec already addresses the concern)

- #1 Snapshot vs live-state — covered by §4.1 + §10.1 + §15.
- #2 `subaccountNoRoot` block vs fallback — covered by §6.6 + §10.5 + §16.3.
- #4 Hierarchy mutation during run — covered by §4.1 immutability contract.
- #6 Max delegation depth — covered by §4.1 + §6.1 + §15.

### Integrity Check

- Forward references: §10.6 → §10.7 rename scanned; no other section references §10.6 or §10.7. Clean.
- Contradictions: new §10.6 invariant reuses `SkillExecutionContext.runId` as the single source, consistent with §4.3, §4.4, §6.3, §6.4. No contradictions.
- Missing inputs/outputs: new §10.6 enumerates producers (skill handlers at §6.3, §6.4, §10.3) and consumers (§7.2 DAG traversal, §17 metrics, §4.3 error log). Complete.
- Integrity check: 0 issues found this round.

### Top themes

- **Uniform contracts.** Error payload precision + trace-id continuity both landed because the spec previously stated the same constraint in scattered prose instead of naming the invariant once.
- **Rejections reflect existing coverage, not scope disputes.** 4 of 5 rejections were "this is already in the spec" — ChatGPT is reading the 1900-line doc sequentially; re-raising existing constraints is the expected noise floor for a spec of this size.

---

## Round 2 — 2026-04-23T08-50-48Z

### ChatGPT Feedback (raw)

Three findings surfaced in the second ChatGPT pass:

1. **Error `context` size bound missing** — the uniform contract added in round 1 pins shape and extensibility but not a byte budget. An agent with thousands of children could produce a multi-megabyte `callerChildIds` payload that blows the prompt context window and creates oversized `agent_execution_events` rows.
2. **`runId` propagation enforcement** — ChatGPT asked whether the new §10.6 trace-continuity invariant has a runtime check or is only a call-site discipline.
3. **`agent_execution_events` dual-write failure handling** — §4.3 promises the event-log write is "lossless" as a backstop for `delegation_outcomes` drops, but there's no corresponding §15 risk entry describing what happens if the event-log write itself fails. §15.6 covers the outcomes table; the event-log table has no mirror entry.

### Recommendations and Decisions

| # | Finding | Agent Recommendation | User Decision | Severity | Rationale |
|---|---------|----------------------|---------------|----------|-----------|
| 1 | Error context size bound | apply | apply | medium | Real gap — the contract pinned shape but not size. One-line addition to the uniform-contract block in §4.3 prevents prompt-blowup and outsized event rows. |
| 2 | `runId` propagation enforcement | reject | reject | low | §10.6 explicitly states "invariant holds by construction at write time, or the row is broken and must be investigated as a bug — not auto-repaired." §10.6 + §6.3 + §6.4 + §4.3 already enumerate every write-site. No runtime reconciliation is the point of the contract. |
| 3 | Event-log dual-write failure | apply | apply | high | Genuine asymmetry — §15.6 covers `delegation_outcomes` but `agent_execution_events` is equally best-effort under load and has no failure-mode contract. New §15.8 mirrors §15.6's structure, names `insertExecutionEventSafe()` as the detached try/catch entry point, and pins the distinct WARN tag (`delegation_event_write_failed`) so operators can distinguish the two telemetry failures. |

### Applied (only items the user approved as "apply")

- **§4.3 — Error `context` size bound (new bullet in uniform contract).** 4 KiB cap on serialised `context`; array-valued diagnostic fields truncated to first 50 elements with a `truncated: true` sibling flag. Rationale pinned inline — prompt-window fit + prevents multi-megabyte event rows.
- **§4.3 — Cross-reference to §15.8.** Last uniform-contract bullet now reads "The event-log write is itself best-effort — failure-mode contract in §15.8." so the dual-write risk is discoverable from the contract page.
- **§15.8 — `agent_execution_events` dual-write failure (new).** Mirrors §15.6's structure. Names `insertExecutionEventSafe()` on `agentExecutionEventService` as the detached try/catch entry point, swallowed + WARN-tagged with `delegation_event_write_failed` to distinguish from `delegation_outcome_write_failed`. Reinforces that the error is always returned to the caller's prompt — telemetry writes never fail the skill call and the agent sees the rejection regardless.

### Rejected (no edits — spec already addresses the concern)

- #2 `runId` propagation enforcement — §10.6 is explicit that the invariant holds by construction; no reconciliation job is the deliberate design, not a gap.

### Integrity Check

- Forward references: §15.8 references §4.3, §10.3, §15.6 — all exist. §4.3's new cross-ref to §15.8 — target exists. Clean.
- Contradictions: `agent_execution_events` was previously described as "lossless" in §4.3 without a failure-mode clause. §15.8 qualifies that as "best-effort under DB pressure" — refinement, not contradiction. §4.3 updated to cross-reference §15.8 so the two statements reconcile (lossless discipline, best-effort implementation). The 4 KiB cap + 50-element truncation in §4.3 is consistent with existing examples (the `callerChildIds` example has 3 ids, well under the cap).
- Missing inputs/outputs: §15.8 names producer (`agentExecutionEventService.insertExecutionEventSafe()`), consumers (Live Execution Log, platform DB error logs under `delegation_event_write_failed` tag), and swallow-and-return-the-error contract. §4.3 size-bound names a truncation mechanism (`truncated: true` flag) + 50-element cap; producer is already pinned in §4.3 (skill handlers in `skillExecutor.ts`). Complete.
- Integrity check: 0 issues found this round.

### Top themes

- **Mirrored telemetry failure-modes.** Every best-effort telemetry write needs a risks-and-mitigations entry naming its swallow point and WARN tag. §15.6 pattern now mirrored in §15.8 — future best-effort writes should follow the same template.
- **Contract bytes-budget.** Stable payload shapes need a serialised-size bound if they can include unbounded array fields. `callerChildIds` is the realistic offender; 4 KiB + 50-element cap is the mitigation.

---

## Final Summary

- **Rounds:** 2
- **Total findings:** 11 (8 in round 1, 3 in round 2)
- **Accepted:** 4 | **Rejected:** 5 | **Deferred:** 2
- **Index write failures:** 0
- **Deferred to tasks/todo.md § Spec Review deferred items / hierarchical-delegation-dev-spec:**
  - Nearest-common-ancestor routing for cross-subtree reassigns — requires algorithmic design + UX decision for how NCA is surfaced to the caller; pulls in prompt-engineering work; out of scope for v1 where root-only is the deliberate simplification.
  - Violation sampling / alerting tier above the rejection-rate metric — valid ops tooling improvement but observability concern, not delegation-contract concern; belongs in a post-launch ops playbook or a dedicated monitoring spec.
- **KNOWLEDGE.md updated:** yes (2 entries — see §Pattern extraction below)
- **Consistency check across rounds:** no contradictions. Round 1's uniform-contract block was extended (not rewritten) by round 2's size-bound addition. Round 2's §15.8 reuses the §10.3 "detached try/catch, swallow, WARN" pattern established by §15.6. No cross-round drift.
- **Implementation-readiness checklist:**
  - All inputs defined ✓
  - All outputs defined ✓
  - Failure modes covered ✓ (§15.1–§15.8 cover rollout friction, split-brain, staleness, adaptive default, upward-reassign, outcome-write failure, seed flatness, event-write failure)
  - Ordering guarantees explicit ✓ (§10.6 trace-continuity invariant; §11 phase graph; §15.5 validator ordering call-out)
  - No unresolved forward references ✓ (integrity checks both rounds clean)
- **PR:** #181 — https://github.com/michaelhazza/automation-v1/pull/181

### Pattern extraction (→ KNOWLEDGE.md candidates)

1. **Best-effort telemetry writes need a named swallow point + distinct WARN tag.** Every dual-write that backs up a best-effort primary (e.g. `delegation_outcomes` + `agent_execution_events` in this spec) needs its OWN §15-style failure-mode entry — not just the primary's. The swallow point has to be a named service method (not inline try/catch) so tests and runbooks can target it; the WARN tag has to be distinct per surface so operators can tell which dual-write failed. Mirror of §15.6 ↔ §15.8.
2. **Stable contract payloads need a serialised-size bound when they admit array-valued diagnostic fields.** Shape + extensibility alone don't prevent prompt-blowup or multi-megabyte log rows. 4 KiB + first-N-elements truncation with a `truncated: true` sibling flag is the pattern. Caught by round 2 when round 1's uniform contract pinned shape but left size implicit.

### Consistency Warnings

None. Round 2 refines round 1's contract without contradicting it.

