# ChatGPT Spec Review Session — closed-loop-skill-improvement — 2026-05-18T20-30-00Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md
- Branch: claude/review-mockup-suggestions-tVf84
- PR: #353 — https://github.com/michaelhazza/automation-v1/pull/353
- Mode: manual
- Started: 2026-05-18T20:30:00Z
- Finalised: 2026-05-18T21:25:00Z
- **Verdict:** APPROVED (3 rounds)

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

---

## Round 2 — 2026-05-18T20:55:00Z

### ChatGPT Feedback (raw)

Round 2 findings on the updated spec (after Round 1 edits landed):

1. **Snapshot `ON CONFLICT DO NOTHING` silently masks divergence**
Severity: high / Category: bug
The §8.1 step 5 snapshot write uses `ON CONFLICT (run_id, system_skill_id, org_skill_id) DO NOTHING`. If a second resolver call for the same run produces a different composed body or different amendment IDs (due to a cache mismatch, race, or a resolver version bump between calls), the conflict is silently ignored and the first row wins — without any check that it matches what the current call actually produced. §15.5 says "snapshot wins for replay", which means a wrong-but-first snapshot would mis-ground every downstream consumer.

2. **Snapshot write does not distinguish transient vs permanent failure**
Severity: medium / Category: improvement
§8.1 step 5 says "any snapshot-write failure propagates as a resolution error and refuses the run." But a transient DB blip (connection reset, lock timeout) is operationally different from a constraint violation or a divergence — the former is retryable by the agent boot path / pg-boss; the latter is an integrity violation. Without a typed distinction, callers cannot decide whether to retry.

3. **RCA context still uses live amendment stack instead of snapshot**
Severity: high / Category: bug
§9.1 step 5 RCA context assembly says "current amendment stack on this skill+subaccount" as one of the 6 inputs. But the failed run is historical — the amendment stack that was actually composed at run time is in `skill_amendment_run_snapshot.included_amendment_ids` / `excluded_amendment_ids`. A live query at RCA time would include amendments accepted between the run and the RCA dispatch, which is exactly the mis-grounding F1 (round 1) was meant to prevent on the inherited-skill detection. The same fix needs to extend to context assembly.

4. **OpenAI header retry wording (low — already covered)**
Severity: low / Category: style
The `llmRouter` retry table row could mention specific HTTP status codes for 429/5xx classification. Cosmetic.

5. **Router exhaustion not terminally classified**
Severity: medium / Category: improvement
§9.1 step 10 routes peer review through `llmRouter.routeCall()` (Round 1 fix). But §18.4's terminal-event list does not include a "router exhausted retries" event. If the router fails after its full retry budget, the job currently has no closed terminal-event branch — it could either loop forever (pg-boss redispatch with no terminal) or silently proceed (worse, un-peer-reviewed amendment reaches `pending_review`).

Overall verdict: CHANGES_REQUESTED (focused — 3 high/medium fixes; close after this)

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Snapshot `ON CONFLICT DO NOTHING` silently masks divergence (§8.1 step 5) | technical-escalated (high severity) | apply | apply (user) | high | Real integrity hole. Applied shape (a): `ON CONFLICT (..) DO NOTHING ... RETURNING`; on `RETURNING`-empty, wrapper `SELECT`s the existing snapshot and compares against recomputed values. Mismatch raises typed `composition.divergence` error (new §18.7), fails closed, agent boot refuses the run. Match continues as benign retry-after-success. |
| F2 — Snapshot transient vs permanent failure handling (§8.1 step 5, §18.2) | technical | apply | auto (apply) | medium | Mechanical fix tied to F1. Added typed `composition.snapshot_write_failed` (retryable) vs `composition.divergence` (non-retryable) split in §18.7; §18.2 row updated; §16 row updated. |
| F3 — RCA context uses live amendment stack instead of snapshot (§9.1 step 5) | technical-escalated (high severity) | apply | apply (user) | high | Same mis-grounding family as Round-1 F1 (inherited-skill detection). §9.1 step 5 now reads amendment-stack membership from `skill_amendment_run_snapshot.included_amendment_ids` / `excluded_amendment_ids` (snapshot is source of truth per §15.5). Bodies still come from live `skill_amendments` by ID (Phase 1 doesn't version-pin bodies; `acceptAfterEdit` creates new rows, so snapshot IDs point at immutable body text). §19 trust boundary diagram updated to match. |
| F4 — OpenAI header retry wording (§18.2) | technical | reject | auto (reject) | low | Factually wrong — Round 1 F3 already routes peer review through `llmRouter`, and `llmRouter`'s standard retry policy (per DEVELOPMENT_GUIDELINES.md §4) is the authoritative source for HTTP status-code classification. Embedding specific codes in this spec would duplicate and risk drifting from the router contract. |
| F5 — Router exhaustion not terminally classified (§9.1 step 10, §18.4) | technical | apply | auto (apply) | medium | Mechanical gap. Added new terminal event `amendment.dropped.peer_review_unavailable` to §18.4 (fired when `llmRouter` exhausts retries — provider timeout, 429/5xx after backoff, all-providers-down, open circuit-breaker). §9.1 step 10 now references it. Closes the post-terminal guarantee for the routed-peer-review path. |

### Integrity check (§4a)

Integrity check: 1 issue found this round (auto: 1, escalated: 0).

- `§23 Self-Consistency Pass line 1040` — described snapshot-write failure as a single resolution error after F1/F2 introduced the typed split (`composition.snapshot_write_failed` vs `composition.divergence`). Mechanical fix, auto-applied: updated to reference both typed errors and the divergence comparison.

Post-integrity sanity (§4c): clean. All forward references resolve — §18.7 (new) is referenced from §8.1 step 5 (twice), §18.2, §16, §23. `amendment.dropped.peer_review_unavailable` (new in §18.4) is referenced from §9.1 step 10. `composition.divergence` and `composition.snapshot_write_failed` are defined in §18.7 and referenced from §8.1 step 5, §16, §18.2, §23. §15.5 source-of-truth precedence still aligns with §9.1 step 5's new snapshot-read posture. No empty sections.

### Applied (auto-applied technical + user-approved user-facing)

- [user] F1 — Rewrote §8.1 step 5 to use `ON CONFLICT ... DO NOTHING ... RETURNING` + fall-back `SELECT` + value comparison; fail-closed on divergence via typed `composition.divergence` error.
- [auto] F2 — Added §18.7 "Typed resolution errors" subsection defining `composition.divergence` (non-retryable) and `composition.snapshot_write_failed` (retryable); updated §18.2 row and §16 row.
- [user] F3 — Updated §9.1 step 5 RCA context assembly to read amendment-stack membership from `skill_amendment_run_snapshot.included_amendment_ids` / `excluded_amendment_ids` instead of live `skill_amendments`. Updated §19 trust-boundary diagram to match.
- [auto] F5 — Added new terminal event `amendment.dropped.peer_review_unavailable` to §18.4 with router-exhaustion semantics, idempotency note, and alert tag. §9.1 step 10 now emits it on router retry-budget exhaustion.
- [auto] Integrity fix — §23 self-consistency line updated to reflect typed-error split.

---

## Round 3 — 2026-05-18T21:20:00Z

### ChatGPT Feedback (raw)

I don't see any remaining blocking issues from the review threads you described.

The two substantive integrity risks are now properly closed:
- snapshot durability is authoritative and fail-closed
- RCA grounding is tied to historical snapshot state instead of live resolver state

The llmRouter migration also removed the biggest governance inconsistency in the original draft.

One very small thing to sanity-check before merge:

Consider — **Snapshot uniqueness invariant should be explicit**
If not already stated, ensure the spec explicitly defines the uniqueness basis for `skill_amendment_run_snapshot`, e.g. one row per `(agent_run_id)` or one row per `(run_id, resolver_version)`. Right now the review history references conflict handling heavily, so the uniqueness contract itself should be trivially discoverable in schema/invariants, not inferred from UPSERT behaviour.

That is refinement-level, not merge-blocking.

Overall verdict: APPROVED

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Snapshot uniqueness invariant should be explicit (§7.7) | technical | apply | auto (apply) | low | Operator-instructed lock-and-apply. Re-wrote §7.7 uniqueness paragraph as invariant-first: (1) prose statement of the unique-row-per-(run, skill) property and why it matters (`snapshot row IS the historical record`; §15.5 "snapshot wins for replay" only holds if unique); (2) `UNIQUE NULLS NOT DISTINCT` clause + the reason that semantic is required (exactly one of `system_skill_id` / `org_skill_id` is non-null per row — default `NULLS DISTINCT` would let two rows for the same `(run, skill)` pair coexist because the other FK is NULL on both); (3) `ON CONFLICT … DO NOTHING` idempotency posture in §18.2 and the §8.1 step 5 divergence-detection path explicitly named as downstream consumers, not the source. |

### Integrity check (§4a)

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Forward references resolve cleanly — §15.5 (line 709), §18.2 (line 820), §8.1 step 5 (line 385) all reachable from the rewritten §7.7 paragraph. No headings renamed; no sections left empty. Post-integrity sanity (§4c): clean — no break-check follow-ups.

### Applied (auto-applied technical + user-approved user-facing)

- [auto] F1 — Re-wrote `skill_amendment_run_snapshot` uniqueness paragraph (§7.7 line 336) as invariant-first prose, with `UNIQUE NULLS NOT DISTINCT` enforcement explanation and downstream `ON CONFLICT` / §8.1 divergence path explicitly framed as consumers. Frontmatter: `Status: reviewing → accepted`; `Last updated` bumped to today with round-3 rationale.

---

## Consistency Check (across all 3 rounds)

Scanned all 13 findings (R1: 7, R2: 5, R3: 1) for the same finding type applied in one round and rejected in another, regardless of decision source.

- **No contradictions.** Each round refined the prior round's direction rather than reversing it:
  - R1 made snapshot writes synchronous and source-of-truth (F1, F2) and routed peer review through llmRouter (F3).
  - R2 hardened the synchronous-snapshot posture by adding divergence detection on `ON CONFLICT` (F1), a typed retryable/non-retryable split (F2), and grounded RCA context-assembly in the snapshot (F3) — all extensions of R1's direction. R2-F5 closed the new router-exhaustion path opened by R1-F3 with a terminal event.
  - R3 promoted the uniqueness constraint that backs R2-F1's divergence detection to a first-class invariant — a documentation refinement of the schema R1/R2 locked.
- All rejections (R1-F4 feature flag, R1-F5 DB CHECK, R1-F7 open-questions style, R2-F4 HTTP-code wording) cite a stable rationale that subsequent rounds did not contradict.
- The single defer (R1-F6 multi-instance cache invalidation) was correctly routed to `tasks/todo.md § Spec Review deferred items` and not re-raised in R2 or R3.

No Consistency Warnings.

---

## Implementation Readiness Checklist

- [x] All inputs defined — §15.1 (failure_post_mortem payload), §15.3 (peer reviewer params), §9.1 step 5 (RCA context inputs from snapshot).
- [x] All outputs defined — §15.2 (RCA proposer output schema), §15.4 (amendment list API response), §13.4 (run trace composition panel).
- [x] Failure modes covered — §18.4 terminal-event enumeration (including `amendment.dropped.snapshot_missing` and `amendment.dropped.peer_review_unavailable`), §18.7 typed resolution errors (`composition.divergence` non-retryable, `composition.snapshot_write_failed` retryable).
- [x] Ordering guarantees explicit — §8.1 step ordering (fetch → compose → snapshot-write → return), §15.5 source-of-truth precedence (snapshot > live for audit; live > snapshot for current views), §6.6 deterministic-resolver invariant, §18.3 concurrency guards for racing writes.
- [x] No unresolved forward references — verified by R1, R2, and R3 integrity checks; §7.7 uniqueness paragraph references §15.5, §18.2, §8.1 step 5, all resolve.

Spec is implementation-ready. No checklist failures.

---

## Final Summary

- Rounds: 3
- Auto-accepted (technical): 5 applied | 4 rejected | 0 deferred
- User-decided:              6 applied | 0 rejected | 1 deferred (F6 round 1)
- Index write failures: 0
- Deferred to tasks/todo.md § Spec Review deferred items / closed-loop-skill-improvement:
  - [user] Multi-instance resolver cache invalidation — Phase 1's in-process cache is correct under single-instance pre-prod posture; multi-instance invalidation contract needed when horizontal scaling lands in Phase 2.
- KNOWLEDGE.md updated: yes (1 entry — "Schema uniqueness invariants must lead, not derive from `ON CONFLICT` wording")
- architecture.md updated: no — grepped `closed-loop`, `skill_amendment`, `amendment_proposer`, `skill_regression`; zero hits. Spec introduces wholly new identifiers; no existing architecture.md reference is stale.
- capabilities.md updated: n/a: docs-only change (spec authoring; no merge yet; Capability Registration runs at the build's `finalisation-coordinator` Step 6, not here)
- integration-reference.md updated: no — grepped `closed-loop`, `skill_amendment`, `amendment_proposer`; zero hits. No integration scope/skill/OAuth/MCP surface touched by this spec.
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — grepped `closed-loop`, `skill_amendment`, `amendment_proposer` in DEVELOPMENT_GUIDELINES.md; zero hits. No build-discipline, RLS, service-tier, gate, or §8 rule changed by this spec.
- spec-context.md updated: no — grepped `closed-loop`, `skill_amendment`, `amendment`; zero hits. No accepted_primitive or convention_rejection changed by this spec; framing assumptions in §4 of the spec align with existing `docs/spec-context.md` posture.
- frontend-design-principles.md updated: no — grepped `closed-loop`, `skill_amendment`, `amendment`; zero hits. UI surface for this spec (§13.1-13.4) follows existing inline-state and one-primary-action conventions; no new design hard-rule introduced.
- PR: #353 — https://github.com/michaelhazza/automation-v1/pull/353
- Spec status: `reviewing` → `accepted` (frontmatter updated this round)
