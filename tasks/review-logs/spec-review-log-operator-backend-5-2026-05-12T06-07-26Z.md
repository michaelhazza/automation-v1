# Spec Review Log — operator-backend, iteration 5 (last per MAX_ITERATIONS=5)

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Codex raw output:** `tasks/review-logs/_codex_operator-backend_iter5_2026-05-12T06-07-26Z.txt`
**Repo HEAD at start:** `0f28a36c`

15 findings from Codex. All mechanical. Several critical (finaliser idempotency, sandbox primitive surface, terminal-event guard, broker contract).

## Findings (1–15) — all accepted mechanical

- **F1 (§ 7.2 / § 7.6)** — Finaliser idempotency contradiction: § 7.2 says no-op when row is terminal, but § 7.6 requires cost-writer retry from terminal state with `event_emitted_at IS NULL`. **ACCEPT**. Key idempotency on `event_emitted_at`.
- **F2 (§ 10.3)** — Two-concurrent-finalises guard refers to a re-set of terminal status that § 7.6 forbids. **ACCEPT**. Use advisory lock + `event_emitted_at` stamp.
- **F3 (§ 7.1 / § 5 / § 2)** — `adoptOrStart` + `sandbox_start_key` extends Spec B's primitive surface but not in inventory. **ACCEPT**. Document the extension explicitly in § 2 and § 5.3.
- **F4 (§ 10.4)** — Task-terminal guard introduced a hypothetical `task_terminal_event_guard` table without inventory entry. **ACCEPT**. Pin pg-boss singleton key as the mechanism; remove the table option.
- **F5 (§ 3.6 / § 2)** — `OperatorSessionEnvelope` has no `subaccountId` field for the subaccount-match assertion. **ACCEPT**. Extend the contract (Spec C surface; technical extension as part of this spec's broker-wiring).
- **F6 (§ 3.3 / § 3.16)** — settings_snapshot note still says "all caps including concurrency" — concurrency is live. **ACCEPT**. Tighten the § 3.3 note.
- **F7 (§ 3.4 / § 3.14)** — Hard-cap unresumable: counter contradicts the "single-event pause" rule. **ACCEPT**. Pin: counter for diagnostics only.
- **F8 (§ 7.3 step 5)** — Counter UPDATE predicate excludes paused states; retries from those states never count. **ACCEPT**. Widen.
- **F9 (§ 3.12)** — `subscription_mediated` eligibility derived from "START mode" but mutable column can't anchor it. **ACCEPT**. Add `credential_start_mode` immutable column.
- **F10 (§ 4.7 / § 3.14)** — `preparing_checkpoint` and `auto_extending` lifecycle events declared but no writer named. **ACCEPT**. Pin writers.
- **F11 (§ 3.10 / § 10.4)** — Cancellation can race: immediate `status='cancelled'` while runtime still emitting. **ACCEPT**. Pin sequence: set `cancel_requested_at` first; status update only after acknowledgement.
- **F12 (§ 3.14 item 10)** — Tentative encryption helper still tentative. **ACCEPT**. Lock the contract; if absent, Chunk 1 creates.
- **F13 (§ 4.10)** — LLM-request writer file unnamed; Open Q 2 still open. **ACCEPT**.
- **F14 (§ 1.3 non-goals)** — Non-goals lack explicit `WON'T DO IN PHASE 1` verdict. **ACCEPT** (minor). Add verdict column.
- **F15 (§ 9 vs § 14)** — § 9 chunk-order description contradicts § 14 (sandbox rename is Chunk 4, before service layer). **ACCEPT** (minor). Update § 9 narrative.

## Iteration 5 Summary

- Mechanical findings accepted: 15
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0

This is the final iteration (MAX_ITERATIONS=5). Exit condition: **iteration-cap**. Spec is mechanically tighter but Codex continues to find new ripples per iteration — this is expected for a Major spec of this size (1800+ lines, 13 contract types, three new tables, four pg-boss queues, two state machines, three CI gates).

The remaining "loose ends" the operator should know about:
- Iterations 4 and 5 each surfaced ~2–3 critical findings AFTER previous critical findings were resolved. The spec is dense enough that each round of edits creates a new wave of cascade-ripples. Cap-hit does NOT mean the spec is bug-free; it means the agent's deterministic budget is exhausted.
- AUTO-DECIDED items from iter 1 still hold (capability-literal pattern).
- Open Questions § 16 still has 4 items even after iter-2 closing two of them.
