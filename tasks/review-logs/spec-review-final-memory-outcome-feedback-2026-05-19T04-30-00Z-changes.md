# Per-section change inventory — memory-outcome-feedback spec review

84 mechanical changes applied across 4 iterations. Grouped by spec section.

## Header / intro paragraph
- Reframed "memory confidence" -> "promotion score"; intro paragraph no longer implies a separate confidence field.

## §1 Goals
- G1: narrowed to fail-with-reject-OR-rollback (matches §4.1).
- G3: zero rows; optional single terminal info log; status `noop`.
- G5: aligned to canonical RLS posture (org at SQL, subaccount at service).
- G6: dispatchers early-return; three layers of defence.
- G7: replay condition includes `asOf`.

## §2 Non-Goals
- "Decay only" -> "score reduction only; no confidence field mutated".
- Added per-artefact-attribution exclusion.
- Cancelled-runs via verdict-null.

## §3 Framing & Brief Departures
- §3.4 reworked: explicit decisionId + decidedAt; coarse task-level attribution acknowledged.
- §3.5 expanded: writeConversationMessage(tx, ...) signature; before/after side-effect table; conversation_messages.id as decisionId source.
- §3.7 dispatcher-early-return locked.

## §4 Architecture
- §4.1 classification: explicit parentheses; `length > 0` for positive; rollbackFiredForRun = false in v1.
- §4.3 cap query: pg_advisory_xact_lock; replay-friendly $asOf.
- §4.4 approval payload: decisionId + decidedAt.
- §4.5 handler flow: flag check (step 1); withOrgTx citation; counters reconciled post-flush.
- §4.5.1 added: injected_entry_ids validation (UUID parse, dedupe, 200-cap).
- §4.5.2 added: source-data lookup (canonical state, NOT trusting payload; (taskId, artefactId) lookup).
- §4.5.3 added (iter4): tenant-consistency pre-validation under withOrgTx.
- §4.6 reinforcement-batch: outcome-feedback row schema; ON CONFLICT DO NOTHING + per-row SAVEPOINT; synchronous flush inside handler tx.
- §4.7 evaluatePromotion: batched query (WHERE entry_id = ANY); negative-totalScore behaviour; missing-weight normalisation; config.reinforcementWindow citation; second batched query for memory.retrieved enrichment.

## §5 Data Model
- §5.1 schema: numeric(6,3); WITH CHECK; classification column; scorecard_verdict nullable; source_ref jsonb; subaccount in lookup index.
- §5.1 prose: tenant-consistency invariant points to §4.5.3 as the explicit guard.

## §6 Contracts
- §6.1 payload: scorecard verdict advisory; approval decisionId + decidedAt.
- §6.2 rules: explicit parentheses; zero-approval example; fail-no-reject-no-rollback example.
- §6.4: LIMIT 51 truncation detector; fanout_cap_truncated event.
- §6.5: namespace consistency (memory.outcome_feedback.*); seven event types (added tenant_mismatch); terminal-event shape with counts.written = { positive, negative }; optional reason field; tenantMismatch counter; memory.retrieved enrichment via second batched query.

## §7 Permissions / RLS
- Two-argument current_setting; WITH CHECK; withOrgTx citation; FK delete-cascade decision documented.

## §8 Execution Model
- DLQ / retry envelope cited (failure:post-mortem sibling).

## §9 Phase Sequencing & Chunk Plan
- Chunk 0 (architect pre-implementation) added: locks migration number; memory.retrieved emitter; rollback owner.

## §10 Execution-Safety Contracts
- §10.1: scorecard singleton by scorecardJudgementId; approval singleton by decisionId.
- §10.3: scenario (c) advisory-lock; (b.1) first-approval-signal-sticks; (b.2) first-scorecard-signal-sticks.
- §10.4: `noop` status; writtenTotal helper; idempotent-only retries -> success; status precedence.
- §10.5: partial-status conditions rewritten without `expected` field; 23505 alone does not produce partial.
- §10.6: 23505 handled per-row via ON CONFLICT.

## §11 Observability
- Seven event types; derived metric (not separately emitted); classification breakdown.

## §12 Rollout & Rollback
- Three-layer flag-off defence; soft-rollback deploy-coupled note; coupled-flag rollout note.

## §13 Determinism & Replayability
- Active-config-aggregation rule; missing-weight normalisation; worked totalScore example.

## §14 Audit-Script Extension
- Check 8: eligibility denominator; entry_id + run_id cross-tenant scans.
- Check 9: SQL fixed to use existing `e.tier`; drop-vs-clamp wording.
- Check 10: reads structured logs; `skipped` when log source unavailable.

## §15 Testing Posture
- Pure-only stance preserved; new filterTenantMatched helper test; >=12 truth-table cases for classifyOutcome; framing assumption explicitly stated re cap-race testing.

## §16 Files in Scope
- File counts reconciled: 3 source + 4 test + 12 modified + 1 stub + 1 fixture dir = 21 touches + 1 migration. Config normalisation owner pinned in memoryConsolidationConfig.ts.

## §17 Success Criteria
- All 7 criteria tightened with explicit verifiability; criterion 8 added (negative totalScore does not erroneously promote).

## §18 Deferred Items
- Per-artefact attribution; per-decision and per-judgement re-scoring; operator UI; rollback wiring; tier_at_apply; cap-race DB-integration tests; composite-FK enforcement.

## ABCd Lifecycle Estimate
- Build sizing prose updated re corrected counts + 3 Chunk 0 placeholders.
- Carry sizing prose corrected re "no synchronous per-memory-entry writes".
