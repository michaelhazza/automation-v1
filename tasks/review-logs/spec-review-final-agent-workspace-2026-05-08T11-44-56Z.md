# spec-reviewer final report — agent-workspace

**Spec:** `tasks/builds/agent-workspace/spec.md`
**Review run:** 2026-05-08
**Iterations:** 5 / 5 (MAX_ITERATIONS reached)
**Mode:** Inline (Codex CLI invoked directly from spec-coordinator session because no Task tool was available; classification + adjudication run inline by the coordinator).

## Summary

| Iteration | Codex findings | Mechanical applied | Directional / ambiguous | Notes |
|---|---|---|---|---|
| 1 | 14 | 14 | 0 | Canonical name fixes (RLS setting, `iee_artifacts` join path, ORG_PERMISSIONS, RunTracePage path), file-inventory drift, idempotency-watermark scope bug (run-local vs cross-run), §11.7-vs-§12.3 stale-state contradiction, MetricCard non-replacement, append-only DB trigger, working-time worker-side compute boundary, Phase 5 hard-block on Phase 1 contract. |
| 2 | 10 | 10 | 0 | SSE-only server-observed recovery, freshness-thresholds constant table, presence_projections degraded_reason + degraded_base_state CHECK constraints, failed-before-degraded resolution order, observation idempotency_key, working-time event ledger as single mechanism, G8 chart-vs-invoice locked to per-agent. |
| 3 | 7 | 7 | 0 | degraded_base_state biconditional CHECK, SSE-only sweep across §4/§9/§13/§17, working-time rollup retry classification corrected, degraded recovery → freshly-resolved primary state, default-tab write path deferred to v1.1 with v1 read-only, current-focus cache backend default to process-local, observation pin/unpin maintenance bypass closed-list. |
| 4 | 4 | 4 | 0 | Polling-fallback removed from status pill, SSE replay contract complete (id: lines + lastEventId query param + buffer-overflow path), presence_subtitle clarified as server-only, default-tab UX wording disambiguated. |
| 5 | 6 | 6 | 0 | Supersession read-path corrected to anti-join, observation-immutability bypass internally consistent (per-mode allow-lists in trigger function), SSE event envelope eventTimestamp+serverNow on every event, replay key typing with ring-buffer-resolution, §3 CurrentFocus reference fix, retention wildcard removed. |

**Total:** 41 findings raised, 41 applied as mechanical. 0 routed to directional / `tasks/todo.md`.

## Stopping reason

Iteration cap reached (`MAX_ITERATIONS = 5`). Loop did not converge to two consecutive zero-finding rounds within the cap; the spec is mechanically much tighter than at draft but reviewers should note that further mechanical findings are likely to remain. **Per the agent's own escalation protocol, this is acceptable — the cap was reached, not exceeded, and the spec is sufficiently tight to hand to ChatGPT spec review and then to feature-coordinator.**

## Framing-assumption rejections

None. Every finding raised was a real mechanical issue — none asked for a feature flag, staged rollout, frontend test, API contract test, or new abstraction.

## Spec-context cross-reference

Read once at start of run. `last_reviewed_at: 2026-05-05` — green. No mismatches with this spec's framing.

## Auto-decided directional items routed to `tasks/todo.md`

None.

## Notes for ChatGPT spec review (next stage)

Recommend the operator focus ChatGPT-web rounds on:
- Anything mechanical still missed (the cap stops at 5; one more round may surface lingering items).
- The Phase 5 / Phase 1 deep-link contract — this is the only hard cross-build dependency in the spec and the most likely source of friction at build time.
- §7.5 Working Time accounting boundaries — the closed table is precise but the Phase 4 wiring needs verification against actual IEE worker event semantics.
- §11.3 concurrency guards for sub-agent delegation — sub-agent session creation under `parent_run_id` is described but not stress-tested for race semantics.

## Spec commit at end of review

(Spec-reviewer in inline mode does not auto-commit. Final commit happens at end of Phase 1 in spec-coordinator's commit step.)
