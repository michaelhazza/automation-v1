# ChatGPT Spec Review Session — closed-loop-skill-improvement — 2026-05-18T20-30-00Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md
- Branch: claude/review-mockup-suggestions-tVf84
- PR: #353 — https://github.com/michaelhazza/automation-v1/pull/353
- Mode: manual
- Started: 2026-05-18T20:30:00Z

---

## Round 1 — 2026-05-18T20:30:00Z

### ChatGPT Feedback (raw)

I'll review the attached spec directly and focus on implementation-readiness gaps rather than wording polish.

I've found a few implementation-readiness issues that matter more than polish: the resolver fallback path, snapshot durability, and LLM governance/cost attribution.

1. **Snapshot fallback can resolve the wrong skill state**
Severity: high / Category: bug
The failure_post_mortem fallback calls resolveSkillsForAgent if the run snapshot is missing. That may resolve the current skill/amendment state, not the state at the failed run. Use a base-origin resolver that does not compose amendments, or make snapshot persistence mandatory before the failure job can run.

2. **Fire-and-forget snapshot conflicts with replay/audit guarantees**
Severity: high / Category: architecture
Snapshot writes are described as non-blocking, but the spec relies on snapshots for historical replay, RCA grounding, and run trace composition. Missing snapshots create degraded provenance with no explicit retry, alert, or dead-letter contract.

3. **Direct OpenAI peer review bypasses LLM governance**
Severity: high / Category: architecture
The spec explicitly bypasses llmRouter for peer review because it is "one-shot," but that also bypasses cost tracking, retry policy, model governance, and central audit controls. At minimum, define equivalent logging, timeout, retry, token-cost, and redaction contracts.

4. **No behaviour flag for resolver rewrite**
Severity: medium / Category: improvement
"No feature flag needed" is risky because the resolver path changes even when the table is empty. Data-gated is useful, but a resolver-level kill switch would make rollback safer if composition, snapshot writes, or cache invalidation misbehave.

5. **Application-only validation for context_fact is brittle**
Severity: medium / Category: bug
The spec rejects imperative wording only in service validation, not DB constraints. That leaves future imports, migrations, scripts, or backfills able to bypass the invariant unless every writer is forced through skillAmendmentService.

6. **Cache invalidation contract is underspecified**
Severity: medium / Category: improvement
The cache key depends on amendment_version_set_hash, but the spec does not clearly define where that hash is computed, stored, or invalidated across multiple app instances. In-process cache is fine for pre-prod, but needs explicit stale-read boundaries.

7. **Open questions says "None," but several external references remain load-bearing**
Severity: low / Category: style
The spec depends on dev brief sections, prototype state, intent Q&A, and existing subsystem assumptions. That is fine, but "Open Questions: None" overstates readiness unless those source files are locked and referenced as acceptance inputs.

Overall verdict: CHANGES_REQUESTED

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Snapshot fallback resolves wrong skill state (§9.1 step 4) | technical-escalated (high severity) | apply | apply (user) | high | Real bug: fallback calls `resolveSkillsForAgent` which composes current amendments, not historical base. Resolution: snapshot is now synchronous (F2 decision), and §9.1 step 4 no longer falls back to live resolver — missing snapshot aborts the job with new terminal event `amendment.dropped.snapshot_missing` (§18.4) + `composition.degraded` alert. |
| F2 — Fire-and-forget snapshot vs replay/audit (§8.1 step 5, §15.5) | technical-escalated (high severity) | apply | apply (user) | high | Operator chose synchronous snapshot write. Edited §8.1 step 5, §16, §6.6, §23 self-consistency to reflect awaited write on the critical resolution path; failure propagates as a resolution error that refuses to start the run. ON CONFLICT idempotency posture (§18.2) preserved. |
| F3 — Direct OpenAI peer review bypasses llmRouter (§5, §9.1 step 10, §16) | technical-escalated (locked-policy contradiction + high severity) | apply | apply (user) | high | Operator chose routing through llmRouter. Edited §5 primitives row, §9.1 step 10, §15.3 (new router-call params block), §16 execution model row, §18.2 retry row, §19 trust-boundary box, §4 framing assumption. Peer review now `routeCall({ taskType: 'peer_review', executionPhase: 'evaluation', sourceType: 'failure_post_mortem', modelFamily: 'gpt', idempotencyKey: scorecard_judgement_id })`. |
| F4 — No behaviour flag for resolver rewrite (§4) | technical | reject | auto (reject) | medium | Contradicts `docs/spec-context.md` `feature_flags: only_for_behaviour_modes` and `rollout_model: commit_and_revert`. Spec's data-gated reasoning is correct per project context. |
| F5 — Application-only validation for context_fact (§7.1 CHECK constraints) | technical | reject | auto (reject) | medium | Spec already evaluated and documented the trade-off ("too expensive at insert time; service validation is the primary gate"). Single-writer invariant is acceptable in pre-production. |
| F6 — Cache invalidation contract across instances (§8.4) | technical-escalated (defer recommendation) | defer | defer (user) | medium | Operator approved defer. Added §22 entry "Multi-instance resolver cache invalidation" + tasks/todo.md backlog row. |
| F7 — "Open Questions: None" overstates readiness (§24) | technical | reject | auto (reject) | low | Stylistic; spec explicitly cites grill-me + dev brief §7 closure. Adding a "load-bearing references" list would be inventory bloat. |

### Integrity check (§4a)

Integrity check: 1 issue found this round (auto: 1, escalated: 0).

- `§23 Self-Consistency Pass line 1023` — still described snapshot DB write as "fire-and-forget side effect" after synchronous-snapshot decision landed. Mechanical fix, auto-applied: updated to "synchronous, awaited side effect outside the pure boundary; snapshot-write failure propagates as a resolution error (§8.1 step 5)."

Post-integrity sanity (§4c): clean. All forward references resolve (`§9.1 step 4`, `§18.4`, `§15.5`, `§8.1 step 5`, `§6.6`, `§13.4`). New terminal event `amendment.dropped.snapshot_missing` is defined in §18.4 and referenced from §9.1 step 4. The remaining "fire-and-forget" matches in §10.1 (pg-boss send), §20 audit/alert events are not snapshot-related and remain correct.

### Applied (auto-applied technical + user-approved user-facing)

- [user] F1 — Rewrote §9.1 step 4 inherited-skill-detection to drop fallback to live resolver; added `amendment.dropped.snapshot_missing` terminal event entry in §18.4.
- [user] F2 — Made `skill_amendment_run_snapshot` write synchronous and awaited. Edited §8.1 step 5, §16 execution model row, §6.6 governance invariant, §23 self-consistency line.
- [user] F3 — Routed peer review through `llmRouter.routeCall()`. Edited §5 existing-primitives row, §9.1 step 10, §15.3 contract (new router-call params block), §16 execution model row, §18.2 retry-classification row, §19 trust-boundary diagram (PEER REVIEWER box), §4 framing-assumption bullet.
- [user] F4 — Added §22 deferred entry "Multi-instance resolver cache invalidation"; routed to tasks/todo.md.
- [auto] Integrity fix — §23 self-consistency line updated to reflect synchronous snapshot.
