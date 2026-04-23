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

