# Spec Review Log — operator-backend, iteration 3

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Codex raw output:** `tasks/review-logs/_codex_operator-backend_iter3_2026-05-12T05-50-33Z.txt`
**Repo HEAD at start:** `90a5c18f`

15 findings from Codex. All mechanical — cascade ripples, missing concrete file paths, missing CI workflow inventory, state-machine cancellation contradiction.

## Findings (1–15)

All accepted mechanical. Brief notes:

- **F1** (§ 3.4 / § 3.10.3 / § 10.7) — `pending → cancelled` allowed in § 3.4 / § 3.10 but forbidden in § 10.7. **ACCEPT**. Loosen § 10.7 forbidden list.
- **F2** (§ 10.1 / § 10.7) — Generic `WHERE status IN ('delegated','paused_*')` permits illegal transitions. **ACCEPT**. Split predicates: terminal `completed|failed` requires `WHERE status='delegated'`; terminal `cancelled` keeps the broader set.
- **F3** (§ 3.4 retry counter / § 7.3) — Increment predicate too narrow if retries start from paused states. **ACCEPT**. Widen to all pre-terminal states with the queued-job reason gate.
- **F4** (§ 7.4 / § 10.4) — Progress event after terminal violates post-terminal prohibition. **ACCEPT**. Add status-guard in handler.
- **F5** (§ 7.4) — `greatest(last_progress_at, ...)` is NULL-unsafe on first event. **ACCEPT**. Replace with `coalesce(..., '-infinity'::timestamptz)`.
- **F6** (§ 3.16 / § 3.3 / § 4.11) — Concurrency-cap is a both-sides cap (must use live settings at dispatch). **ACCEPT**. Document that `concurrent_operator_sessions_cap` reads live; in-flight caps read from settings_snapshot.
- **F7** (§ 3.4) — `paused_budget_exceeded` definition needs to cover max-wall-clock too. **ACCEPT**.
- **F8** (§ 3.17.4 / § 4.9) — Audit event naming conflict: `task.operator_budget.extended` vs `task.operator.budget_extended`. **ACCEPT**. Pick `task.operator.budget_extended`.
- **F9** (§ 3.7.2) — `ApiKeyEnvelope` introduced without contract. **ACCEPT**. Pin shape inline.
- **F10** (§ 3.3 / § 6 / § 5.2) — RLS manifest entry can't be added by SQL migration. **ACCEPT**. Change wording.
- **F11** (§ 5.3) — `.github/workflows/ci.yml` missing from § 5. **ACCEPT**.
- **F12** (§ 14.8 / § 5) — Concrete files for permission registry + route registration missing. **ACCEPT**.
- **F13** (§ 13.1 / § 5.3 / § 14.10-13) — OpenTaskView family missing from chunk plan. **ACCEPT**. Add to Chunk 11.
- **F14** (§ 10.6) — `OperatorBackendConflictError` mapper file unnamed. **ACCEPT**. Add concrete file.
- **F15** (§ 3.2 / § 4.1 / § 5.3) — `session_identity` is new in this spec but framed only as `long_running` extension. **ACCEPT**. Clarify.

## Iteration 3 Summary

- Mechanical findings accepted: 15
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- Spec commit after iteration: (to be recorded after Step 8b)

