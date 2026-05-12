# Spec Review Log — operator-backend, iteration 4

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Codex raw output:** `tasks/review-logs/_codex_operator-backend_iter4_2026-05-12T05-58-10Z.txt`
**Repo HEAD at start:** `a56892be`

15 findings from Codex. All mechanical. Several critical (sandbox-orphan on dispatch crash, duplicate dispatch race, terminal-event guard).

## Findings (1–15) — all accepted mechanical

- **F1 (§ 7.1 / § 10.2)** — Sandbox-orphan on dispatch crash before `vendor_session_id` update. **ACCEPT**. Add provider-side idempotency token + adoption-on-retry rule.
- **F2 (§ 7.3 / § 3.4)** — Dispatch-next handler allowed to proceed on `delegated`, can dispatch chain N+1 while N is running. **ACCEPT**. Add the `NOT EXISTS operator_runs WHERE status IN ('pending','running')` precondition.
- **F3 (§ 3.16)** — "Settings application" still says snapshot is sole source for concurrency cap; § 3.16 enforcement points clarifies it's live. **ACCEPT**. Tighten the "Settings application" wording.
- **F4 (§ 10.4 / § 4.7 / § 3.11)** — `artefact_harvested` event post-terminal violates § 10.4. **ACCEPT**. Pin emission timing.
- **F5 (§ 3.14 / § 3.4 / § 3.17)** — Hard-cap unresumable: immediate pause vs 3-failure threshold. **ACCEPT**. Pin: immediate pause; the 3-failure threshold is only for start failures.
- **F6 (§ 7.5)** — GC `gc_in_progress` reclaim missing for crash-during-delete. **ACCEPT**. Add `gc_started_at` reclaim rule.
- **F7 (§ 3.17.2 / § 10.2)** — Incident emission idempotency key missing. **ACCEPT**.
- **F8 (§ 3.10 / § 10.4)** — Task-terminal event race between cancel and finaliser. **ACCEPT**. Add singleton-key guard.
- **F9 (§ 3.12 / § 3.3 / § 4.11)** — `cost_sandbox_compute_cents` cache writer unstated. **ACCEPT**. Pin the writer and the precedence.
- **F10 (§ 3.14.10 / § 4.6 / § 5)** — Checkpoint encryption helper file unnamed. **ACCEPT**. Pin tentatively with build-chunk-confirmation fallback.
- **F11 (§ 5.1 / § 10.6)** — Route error-handler file not in § 5.3. **ACCEPT**.
- **F12 (§ 6.5 / § 5)** — Permission-coverage gate file not in § 5.3. **ACCEPT**.
- **F13 (§ 4.8b)** — CS notification idempotency timestamp source unclear. **ACCEPT**.
- **F14 (§ 3.7 item 6)** — Fallback-stickiness anchor `event_emitted_at` can be NULL on partial finaliser failure. **ACCEPT**. Use coalesce chain.
- **F15 (§ 8 / § 11)** — Verdicts not in structured form. **ACCEPT** (minor). Add `Verdict: BUILD` to § 8; prefix § 11 bullets with `DEFER —`.

## Iteration 4 Summary

- Mechanical findings accepted: 15
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- Spec commit after iteration: (to be recorded after Step 8b)

