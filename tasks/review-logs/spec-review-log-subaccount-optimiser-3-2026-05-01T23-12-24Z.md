# Spec Review — subaccount-optimiser — Iteration 3

- Spec commit at start: 64171bb6
- Spec-context commit: 03cf8188
- Codex output: tasks/review-logs/_codex_iter3.txt

## Codex findings

### #1 — render cache key contradiction (`dedupe_key` vs `evidence_hash`)
- Sections: §2, §5, §8, §9
- Issue: §2 / §5 / §8 / §9 still say "cached by dedupe_key" while §6.2 says re-render triggers on evidence_hash mismatch. Pin one cache key.
- Classification: mechanical
- Disposition: auto-apply. Cache key is `(category, dedupe_key, evidence_hash)`. Update §2, §5, §8.

### #2 — `includeDescendantSubaccounts={true}` missing from §7 / §9 examples
- Section: §6.3 / §7 / §9 Phase 3
- Issue: Org-context examples just pass `scope={{ type: 'org', orgId: … }}` with no `includeDescendantSubaccounts`. The default is false (per §6.3), so the documented call site doesn't produce the documented rollup result.
- Classification: mechanical
- Disposition: auto-apply.

### #3 — `<AgentRecommendationsList>` lacks a total-count + see-all expansion contract
- Section: §6.3 / §7
- Issue: §7 promises "See all N →" inline expansion but the component prop interface has no total-count output and no expansion-state control.
- Classification: mechanical
- Disposition: auto-apply. Add `onTotalChange?: (total: number) => void` callback and `mode: 'collapsed' | 'expanded'` prop (default `'collapsed'`); when `'expanded'` ignores `limit`.

### #4 — cap enforcement is not concurrency-safe
- Section: §6.2 / §13
- Issue: A `SELECT count(*) … then INSERT` even in the same transaction is not safe under concurrent calls (two transactions read 9, both insert, end at 11). Spec needs to name a real mechanism.
- Classification: mechanical
- Disposition: auto-apply. Two acceptable mechanisms: (a) `pg_advisory_xact_lock(hashtext('output.recommend.cap:' || scope_type || ':' || scope_id || ':' || producing_agent_id))` taken before the count; (b) drop the cap to "best-effort, soft cap of 10 per pair". Pick (a) — the cap is load-bearing for noise mitigation; advisory lock is the canonical pattern in this codebase (see `feature_requests` per architecture.md). Cite the pattern.

### #5 — `common_step` field type unspecified
- Section: §5 / §6.5
- Issue: `optimiser.scan_workflow_escalations` returns `common_step` but the `action_hint` schema needs a step ID. ID vs slug vs label is unclear.
- Classification: mechanical
- Disposition: auto-apply. Pin: `common_step_id` (the workflow step's id from `flow_step_outputs.stepId` or its equivalent). Add separate `common_step_label` only if needed for copy — keep the §5 return shape minimal for now.

### #6 — "configurable" optimiser schedule has no persisted source
- Section: §4 / §9
- Issue: Spec says the daily 06:00 cron is "configurable" but doesn't name a column or settings source for overrides.
- Classification: mechanical
- Disposition: auto-apply. Drop "configurable" from §4. The optimiser is a sub-account agent under the existing three-tier model, so its schedule lives on `subaccount_agents.scheduleCron` / `scheduleEnabled` / `scheduleTimezone` like every other sub-account agent — that IS the configurability surface; no new column needed. State this explicitly so the implementer doesn't add a separate config table.

### #7 — Phase 2 integration milestone covers `escalation.repeat_phrase` whose tokeniser ships in Phase 4
- Section: §9
- Issue: Phase 2 says "Integration test: full run end-to-end against test sub-account with seeded telemetry, assert recommendation rows appear with expected dedupe_keys" — but if the tokeniser hasn't shipped (Phase 4), the `escalation.repeat_phrase` evaluator is incomplete.
- Classification: mechanical
- Disposition: auto-apply. Move the tokeniser work into Phase 1/2 (where the query + evaluator already are) and remove Phase 4. Net cost: ~3h moves earlier; total estimate stays at 28h.

### #8 — `server/websocket/emitters.ts` and `server/index.ts` missing from §10
- Section: §10 / §6.5
- Issue: Spec adds a new socket event and a new HTTP router; both need registration in existing files. §10 inventory misses these.
- Classification: mechanical
- Disposition: auto-apply. Add both files to §10.

### #9 — dismiss / acknowledge route says `23505` but no unique constraint applies
- Section: §6.2 / §6.5
- Issue: Acknowledge / dismiss are UPDATE-by-id routes; no unique-constraint edge exists. The `23505` sentence is copied from the insert path.
- Classification: mechanical
- Disposition: auto-apply. Replace with state-based idempotency: row-count check on guarded UPDATE; 0 rows affected = race lost (already dismissed/acknowledged) → 200 with `alreadyDismissed=true` / `alreadyAcknowledged=true`.

## Iteration 3 Summary

- Codex findings: 9 (all mechanical, 0 ambiguous, 0 directional)
- Rubric findings: 0
- Mechanical accepted: 9
- Mechanical rejected: 0
- Reclassified → directional: 0
- Directional: 0
- AUTO-DECIDED: 0
