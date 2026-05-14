# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Spec commit at start:** untracked (HEAD `ffd9a08a` — spec was a new file)
**Spec commit at finish:** `59c3d710`
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318` (last_reviewed_at 2026-05-11, age 2 days, GREEN)
**Iterations run:** 5 of 5
**Exit condition:** two-consecutive-mechanical-only (iterations 4 + 5) AND iteration-cap hit simultaneously
**Verdict:** NEEDS_REVISION (two unresolved AUTO-DECIDED schema-strategy decisions block specific chunks — both routed to `tasks/todo.md` for operator/architect input; full audit trail follows)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Mech accepted | Mech rejected | AUTO-DECIDED |
|---|----|----|----|----|----|
| 1 | 16 | 3 (R1 subsumed, R2 mech, R3 directional) | 16 | 0 | 1 (PA-V2-OP-S1) |
| 2 | 6  | 1 (R4 mech) | 7  | 0 | 0 |
| 3 | 4  | 0 | 3+ (C3-3 narrowed) | 0 | 1 (PA-V2-OP-S2) |
| 4 | 4  | 0 | 4  | 0 | 0 |
| 5 | 3  | 0 | 3  | 0 | 0 |
| **Totals** | **33** | **4** | **33** | **0** | **2** |

---

## Mechanical changes applied

Grouped by spec section:

### §1 Goals + non-goals + framing
- Reframed Universal OpenTaskView invariant to clarify the controller-style badge / chain-link / budget events are ALREADY-EMITTED operator-backend (Spec D) events; V2 adds only the four event variants inventoried in §4.6.
- Enumerated all four new V2 event variants in the framing bullet.

### §3 Source-of-truth references
- Extended the ranked list to include `tasks/builds/user-owned-agents/brief.md`, `tasks/builds/operator-backend/brief.md` (Spec D), `tasks/builds/personal-assistant-v1/brief.md`; promoted `docs/spec-authoring-checklist.md` to ranked entry #6.

### §4 File inventory lock
- §4.1: added placeholder migration 0346 row for the §13 #1 file-events backing store (strategy-pending) with both candidate strategies named.
- §4.2: added `crossOwnerDelegationRequestAssembler.ts` + pure helper (owns the `CROSS_OWNER_DELEGATION_REQUEST` shape and the `cross_owner_approval_timeout_policy` write). Strategy-neutralised the file-event bridge.
- §4.3: replaced the TBD orchestrator routing module row with the concrete path `server/tools/capabilities/capabilityDiscoveryHandlers.ts`. Added rows for `agentExecutionEventService.ts`, `server/routes/taskEventStream.ts`, `server/routes/agentRuns.ts` wiring `runTraceProjectionForViewer` into the run-trace read path.
- §4.6: now lists all four V2 event variants and both cross-owner pause-reason constants; added `shared/types/agentExecutionLog.ts` row for criticality registry entries.
- §4.7: doc-sync row for verify-rls-coverage made conditional on §13 #1.
- §4.8 (NEW SUB-TABLE): "Referenced existing primitives (no code change, named for traceability)" — lists every file/path/agent cited in §1, §6, §8, §10, §13, and Appendix A that is NOT modified by V2.

### §5 Domain model + contracts
- §5 intro: softened blanket "every contract has an example" claim to "example where copy-paste clarity is the point".
- §5.2 RoutingContext: consumer line narrowed; explicit note that `runTraceProjectionForViewer` doesn't consume `RoutingContextV2`.
- §5.3 Addressing parser: matcher score-scale source-of-truth pinned to `capabilityMapService.matchCapability`; recalibration plan documented.
- §5.4 Cross-owner delegation: producer line corrected to `crossOwnerDelegationRequestAssembler.build(...)`. Initiator-visible row rewritten to separate lifecycle (read-model) from emitted events. State record strategy-neutralised.
- §5.6 Timeout policy: producer line corrected to assembler. `ask_initiator` branch now names the concrete mechanism (existing V1 approval-row plumbing). Each timeout branch enumerates its exact terminal event + reason.
- §5.7 File events: source-of-truth precedence and tool-call-vs-watcher precedence text strategy-neutralised.

### §6 Permissions / RLS
- §6.1 made explicitly conditional on §13 #1 resolution.

### §8 Chunk sequencing
- Chunk 3 renamed and expanded to include the new assembler + `runTraceProjectionForViewer` + projection acceptance criterion.
- Chunk 7 description strategy-neutralised re: backing-store table.

### §9 Execution-safety contracts
- §9.1, §9.2, §9.3, §9.6: file-events backing-store references all strategy-neutralised; version-allocator concrete form deferred to §13 #1.
- §9.4: rewrote multi-path-termination to enumerate the full closed terminal set including `ask_initiator` branches. Added canonical `substep_id` contract (strategy-neutral). Defined the terminal-event uniqueness mechanism (row-level UPDATE-with-`terminal_at IS NULL` predicate).
- §9.7: rewrote state-machine diagram to include `awaiting_cross_owner_approval → approved → executing` resume edge and the approved/rejected failure edge. Pinned the canonical 10-status vocabulary explicitly.

### §10 Testing posture
- `verify-operator-event-registry.sh` now references all four V2 variants.
- RLS gates made strategy-conditional.

### §11 Self-consistency
- Single-source-of-truth bullet made strategy-neutral.
- "Every load-bearing claim has a named mechanism" subsection expanded to include privacy-projection consumers, `ask_initiator` decision-request loop, and terminal-event uniqueness predicate.

### §13 Open questions
- Replaced "None blocking" with two genuine open questions (§13 #1 file-events backing store, §13 #2 `delegation_outcomes` state machine); both BLOCKS-CHUNK-X flagged; both with candidate strategies enumerated and routed to `tasks/todo.md`.

### Appendix A
- Clarified that prose descriptions are illustrative; code is source-of-truth for fixture shapes; prose is source-of-truth for outcomes.


## Rejected findings

None. Every Codex finding across five iterations was accepted as mechanical or reclassified to AUTO-DECIDED. Zero `[REJECT]` decisions logged.

## Directional and ambiguous findings (autonomously decided)

Two AUTO-DECIDED items routed to `tasks/todo.md` under `## Deferred spec decisions — personal-assistant-v2-operator`. Both are SCHEMA STRATEGY decisions spec-reviewer cannot silently pick.

| Iter | Item | Section | Classification | Decision | Rationale |
|---|---|---|---|---|---|
| 1 | `PA-V2-OP-S1` — File-events backing-store schema | §4.1 mig 0346, §5.7, §9 | directional (architecture signal) | AUTO-DECIDED | Existing `execution_files` table has none of the columns the spec assumes. Architect must choose: (a) new `operator_run_files` table OR (b) extend `execution_files`. **BLOCKS Chunk 7.** |
| 3 | `PA-V2-OP-S2` — `delegation_outcomes` state-machine columns | §5.4, §9.4, §9.7, §13 #2 | directional (architecture signal) | AUTO-DECIDED | Existing `delegation_outcomes` has no `status` or `terminal_at` column. Architect must choose: (a) extend in migration 0345 OR (b) new `cross_owner_substep_state` table. **BLOCKS Chunk 3.** |

Both items carry: candidate strategies enumerated in §13 open questions, routed entries in `tasks/todo.md`, self-resolving criteria (what to update once a strategy is picked), and a recommendation from spec-reviewer (strategy (a) in both cases — conservative default).

## Mechanically tight, but verify directionally

This spec is mechanically tight against the rubric and against Codex's best-effort review across five iterations. The human has TWO directional items to adjudicate before Chunk 3 (PA-V2-OP-S2) and Chunk 7 (PA-V2-OP-S1) can ship; both are in `tasks/todo.md`.

However:

- The review did not re-verify framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 framing / §10 testing posture / §11 self-consistency sections before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- The two AUTO-DECIDED schema decisions are GENUINE blockers — Chunks 3 and 7 cannot be implemented without picking a strategy. Spec-reviewer recommends strategy (a) in both cases but the call is yours.

**Recommended next step:**
1. Resolve PA-V2-OP-S1 and PA-V2-OP-S2 in `tasks/todo.md` (a 15-minute architectural decision per item — both have pre-analysed candidate strategies in §13).
2. Update the spec rows the §13 questions point at (migrations 0345 / 0346, the conditional language in §6.1 / §11, the §9.4 `terminal_at` reference).
3. Re-read §1 framing and §11 self-consistency once after both decisions land, to verify the strategy-neutral wording resolves coherently.
4. Then start Chunk 1 (foundation: schema + types + CI gate) which is unblocked.

---

## Provenance

- `tasks/review-logs/spec-review-plan-personal-assistant-v2-operator-2026-05-13T06-00-56Z.md` — pre-loop context check and review plan
- `tasks/review-logs/spec-review-log-personal-assistant-v2-operator-{1..5}-*.md` — per-iteration scratch logs
- `tasks/review-logs/.codex-iter{1..5}-personal-assistant-v2-operator-*.txt` — raw Codex outputs
- `tasks/review-logs/.codex-prompt-iter{1..5}-personal-assistant-v2-operator-*.txt` — Codex input prompts (for reproducibility)
- Spec commits: `418bcf7d` (iter 1) → `8bd64306` (iter 2) → `774823c1` (iter 3) → `f143e166` (iter 4) → `59c3d710` (iter 5)
- Final report commit: this commit

