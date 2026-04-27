# Spec Conformance Log

**Spec:** `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`
**Spec commit at check:** `004c4652` (most recent spec commit on the branch — finalise ChatGPT spec review session)
**Branch:** `claude/add-system-monitoring-BgLlY`
**Base:** `ee428901` (merge-base with `main`)
**Scope:** all-of-spec — branch tip is `ce7ed103` ("programme-end verification complete + progress.md close-out") confirming Slices A→D shipped per `progress.md`. Verification narrowed to system-monitor files; the merge-from-main brought in unrelated audit-remediation-followups + pre-launch-hardening churn that is OUT_OF_SCOPE for this spec.
**Changed-code set:** ~100+ files across the branch (committed only); ~80 in scope after filtering to system-monitor surface
**Run at:** 2026-04-27T06:52:33Z

---

## Summary

- Requirements extracted:     34 (high-level; per-spec-subcomponent)
- PASS:                       28
- MECHANICAL_GAP → fixed:     2  (REQ 2.6 sweep cap env vars, REQ 2.7 partial_success logic)
- DIRECTIONAL_GAP → deferred: 6  (sweep cron interval, rate-limit unwired + auto-escalate, feedback metadata fields, sweepCoverageDegraded stub, hardcoded iteration cap, write_event enum mismatch)
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     n/a (audit-remediation + pre-launch-hardening files are not part of this spec; not counted)

> `AMBIGUOUS` is reported separately for diagnostic visibility; both AMBIGUOUS and DIRECTIONAL items route to `tasks/todo.md`. None classified AMBIGUOUS this run.

**Verdict:** NON_CONFORMANT — 6 directional gaps must be addressed by the main session before `pr-reviewer`. The most operationally significant: (a) sweep runs every 15 min instead of 5; (b) the rate-limit module exists but is dead code so the cap is 5 not 2; (c) the `sweep-coverage-degraded` synthetic check is a stub. The two mechanical gaps are now fixed in-session.

---

## Requirements extracted (full checklist)

| REQ | Category | Spec section | Verdict |
|---|---|---|---|
| A.1 Idempotency LRU at recordIncident | service | §4.1 | PASS |
| A.2 Per-fingerprint throttle | service | §4.2 | PASS |
| A.3 SystemPrincipal variant on PrincipalContext union | type | §4.3 | PASS |
| A.4 getSystemPrincipal/withSystemPrincipal singleton | service | §4.3 | PASS |
| A.5 assertSystemAdminContext guard (Conditions A + B) | service | §4.4 | PASS |
| A.6 Guard wired into all system_incidents mutations | wiring | §4.4 | PASS |
| A.7 system_incidents new columns (8) | schema | §4.5 | PASS |
| A.8 system_monitor_baselines table | schema | §4.5 | PASS |
| A.9 system_monitor_heuristic_fires table | schema | §4.5 | PASS |
| A.10 Phase A migration with seed | migration | §4.6 | PASS (0233/0234/0235) |
| A.11 New tables in rls-not-applicable-allowlist | config | §4.6 step 7 | PASS |
| A.12 Event-type enum extension | type | §12.1 | PASS |
| 1.1 system-monitor-synthetic-checks 60s tick | job | §8.1 | PASS |
| 1.2 Day-one synthetic check set (8 checks) | service | §8.2 | DIRECTIONAL_GAP (sweepCoverageDegraded is stubbed) |
| 1.3 Synthetic incidents w/ fingerprintOverride + idempotencyKey | wiring | §8.3 | PASS |
| 1.4 SYNTHETIC_CHECKS_ENABLED kill switch | config | §8.4 | PASS |
| 1.5 Cold-start tolerance per check | behavior | §8.2 | PASS |
| 2.1 system_monitor agent row seeded | migration | §9.1 | PASS |
| 2.2 Incident-driven trigger conditions | behavior | §9.2 | PASS |
| 2.3 Incident-driven outbox pattern + singletonKey | wiring | §9.2 | PASS |
| 2.4 Sweep job 5-minute tick | config | §9.3 / §9.10 | DIRECTIONAL_GAP (cron is `*/15`, not `*/5`) |
| 2.5 Sweep two-pass design | behavior | §9.3 | PASS |
| 2.6 Sweep candidate / payload caps env-configurable | config | §9.10 | MECHANICAL_GAP_FIXED |
| 2.7 Sweep partial_success contract | behavior | §9.3 | MECHANICAL_GAP_FIXED |
| 2.8 Sweep singletonKey + idempotency | wiring | §9.3 / §4.8 | PASS |
| 2.9 Diagnosis-only skill set (11 skills) | service | §9.4 | PASS |
| 2.10 Day-one heuristic set (14 modules) | service | §9.5 | PASS |
| 2.11 Phase 2.5 heuristic set (9 modules) | service | §9.6 | PASS |
| 2.12 Agent system prompt = Investigate-Fix Protocol authoring | service | §9.7 | PASS |
| 2.13 investigate_prompt validation | service | §9.8 | PASS |
| 2.14 write_diagnosis idempotent on (incidentId, agentRunId) | service | §9.8 | PASS |
| 2.15 Per-fingerprint rate limit (default 2 / 24h) | service | §9.9 | DIRECTIONAL_GAP (rateLimit.ts unwired; admit uses cap=5 hardcoded) |
| 2.16 Auto-escalation past rate-limit window | service | §9.9 | DIRECTIONAL_GAP (maybeAutoEscalate dead code) |
| 2.17 SYSTEM_MONITOR_ENABLED kill switch | config | §9.10 | PASS |
| U.1 DiagnosisAnnotation component | client | §10.3 | PASS |
| U.2 InvestigatePromptBlock + copy button | client | §10.2 | PASS |
| U.3 FeedbackWidget | client | §10.4 | PASS |
| U.4 DiagnosisFilterPill | client | §10.5 | PASS |
| U.5 ?diagnosis= list filter on GET /api/system/incidents | route | §10.5 | PASS |
| U.6 POST /api/system/incidents/:id/feedback | route | §10.4 | PASS |
| F.1 prompt_was_useful + prompt_feedback_text columns | schema | §11.1 | PASS |
| F.2 investigate_prompt_outcome event metadata | event | §11.2 | DIRECTIONAL_GAP (4 required metadata fields missing) |
| F.3 First-submission idempotency on recordPromptFeedback | behavior | §4.9.3 | PASS |
| X.1 Investigate-Fix Protocol doc | docs | §5.1 / §5.2 | PASS |
| X.2 CLAUDE.md hook | docs | §5.3 | PASS |
| X.3 Heuristic registry interface | type | §6.2 | PASS |
| X.4 BaselineReader read API | service | §7.5 | PASS |
| X.5 Baseline refresh job 15-min tick | job | §7.3 | PASS |
| X.6 Baseline drift reset | service | §7.6 | PASS |
| X.7 architecture.md System Monitor Active Layer section | docs | §13.1 | PASS |
| X.8 docs/capabilities.md entry | docs | §13.1 | PASS |
| X.9 Staging smoke checklist file | docs | §14.3 | PASS |
| X.10 verify-heuristic-purity.sh CI gate | gate | §17.3 | PASS |
| X.11 verify-event-type-registry.sh CI gate | gate | §17.3 | PASS |
| E.1 (subset) Sweep cap env vars consumed | config | §9.10 | MECHANICAL_GAP_FIXED |
| E.1 (subset) Sweep interval / rate-limit env vars consumed | config | §9.10 | DIRECTIONAL_GAP |
| E.2 write_event DB-stored enum vs runtime ALLOWED_TYPES | migration | §9.4 / §12.1 | DIRECTIONAL_GAP |

---

## Mechanical fixes applied

- `server/services/systemMonitor/triage/selectTopForTriage.ts` — replaced hardcoded `CANDIDATE_CAP = 50` and `PAYLOAD_CAP_BYTES = 200 * 1024` with env-var resolvers that honor `SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP` and `SYSTEM_MONITOR_SWEEP_PAYLOAD_CAP_KB` per spec §9.10. Defaults preserved (50 / 200 KB) so behavior is unchanged when env is unset. Spec quote: "Hard ceiling on triage candidates per sweep ... Configurable via `SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP`."
- `server/services/systemMonitor/triage/sweepHandler.ts` — replaced `errored.length > 0 && firedRecords.length === 0 ? 'partial_success' : 'success'` with `errored.length > 0 || capped !== null ? 'partial_success' : 'success'` per spec §9.3 partial-success contract. Spec quote: "`partial_success` — at least one heuristic errored (`errored.length > 0`) OR the input cap was hit (`capped != null`)."

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

See `tasks/todo.md § "Deferred from spec-conformance review — system-monitoring-agent (2026-04-27)"` for the full deferred-items section. Six items routed:

- REQ 2.4 Sweep cron interval is hard-coded `*/15` minutes; spec defaults to 5
- REQ 2.15 + 2.16 `rateLimit.ts` module unwired — admit uses hardcoded cap-of-5
- REQ F.2 `investigate_prompt_outcome` event missing 4 required metadata fields (linked_pr_url, resolved_at, diagnosis_run_id, heuristic_fires)
- REQ 1.2 `sweepCoverageDegraded` synthetic check is a stub
- REQ E.1 (subset) hardcoded triage iteration / token caps not env-configurable (low priority)
- REQ E.2 `write_event` migration 0234 enum is narrower than runtime ALLOWED_TYPES (corrective migration needed)

---

## Files modified by this run

- `server/services/systemMonitor/triage/selectTopForTriage.ts` (env-var resolvers for sweep caps)
- `server/services/systemMonitor/triage/sweepHandler.ts` (corrected partial_success boolean)
- `tasks/todo.md` (appended deferred-items section)
- `tasks/review-logs/spec-conformance-log-system-monitoring-agent-2026-04-27T06-52-33Z.md` (this file)

The scratch file `tasks/review-logs/spec-conformance-scratch-system-monitoring-agent-2026-04-27T06-52-33Z.md` is informational and is removed at end of run.

---

## Next step

NON_CONFORMANT — 6 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — system-monitoring-agent (2026-04-27)". After fixes land, re-run `pr-reviewer` on the expanded changed-code set (the reviewer needs to see the post-fix state). The two mechanical fixes applied this run also expanded the changed-code set; `pr-reviewer` should be re-run on that expanded set regardless of whether the directional gaps are fixed first.
