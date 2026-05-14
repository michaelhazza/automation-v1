# Spec Review — Iteration 1

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-29T02-31-12Z
**Branch HEAD at start:** `93e855e720daed6e012751860749683006b50238`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`

---

## Findings (Codex output)

Codex returned 18 findings. Each is enumerated below with the classification, disposition, and (if mechanical) the fix applied.

### F1 — Stale "until Phase 2 trigger" framing language
- Source: Codex
- Section: §1 Framing, line 50
- Description: "no E2E / API-contract / frontend tests until Phase 2 trigger" — there is no "Phase 2 trigger" in `docs/spec-context.md`; the only deviation is F8.
- Codex's fix: replace with "no E2E / API-contract / frontend tests; the only runtime integration-test deviation is F8 sessionMessage."
- Classification: mechanical (stale phrase / contradiction)
- Disposition: ACCEPT
- Fix applied: Updated framing line to remove "until Phase 2 trigger" and explicitly cite F8 `sessionMessage.test.ts` as the only deviation.

### F2 — Test matrix exceeds the F8-only deviation
- Source: Codex
- Section: §12 Test matrix, lines 623–637; §14 AC2, AC8, line 671 / 678
- Description: integration tests for `rateLimiter.check` (concurrent race, TTL cleanup) and reseed rollback contradict the spec's own "pure-function unit tests only" posture.
- Codex's fix: remove non-F8 integration tests; replace with static inspection and pure-function unit coverage.
- Classification: directional (testing-posture signal: "Add fewer tests below the envelope")
- Disposition: AUTO-DECIDED — accept (route to `tasks/todo.md`)
- Reasoning: this aligns with the framing assumption (rapid evolution / pure-function-only). The spec's framing-acknowledgment paragraph says "the *only* deviation is F8"; the matrix violated that. Auto-collapsed the rateLimiter rows into a pure-helper unit test of `computeEffectiveCount`; reseed rollback row replaced with static inspection. Routed to tasks/todo.md so the human can approve / restore one of the integration tests with an explicit framing-deviation acknowledgement if desired.

### F3 — Multer hybrid (5 MB) vs all-disk inconsistency
- Source: Codex
- Section: §2 G1 (line 58); §6 Phase 1 (lines 133–136); §14 AC1 (line 670)
- Description: G1 + AC1 say "spillover at 5 MB threshold"; Phase 1 default-recommends "disk-storage for all uploads".
- Codex's fix: pick one verdict; preferably all-disk-storage with 50 MB cap, defer hybrid.
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix applied: G1, AC1, Phase 1 prose, file-inventory row all updated to "all uploads use `multer.diskStorage`". The hybrid 5 MB threshold remains in §13 Deferred items as the recorded fallback.

### F4 — "All five" call-site count vs 6 rows in migration table
- Source: Codex
- Section: §2 G3 (line 60); §6 Phase 2 (lines 142, 188–203); §14 AC3 (line 672); §10.5 (line 579)
- Description: spec says "all five" but the migration table lists six rows (auth login, auth signup, auth forgot+reset, formSubmission, pageTracking, testRunRateLimit).
- Codex's fix: enumerate explicitly, or use a generic phrase.
- Classification: mechanical (inventory drift)
- Disposition: ACCEPT
- Fix applied: G3, Phase 2 lead paragraph, §6.2.5 lead, AC3, and §10.5 all changed to "every existing in-process / `express-rate-limit` call site enumerated in §6.2.5".

### F5 — Env-override language vs framing's WEBHOOK_SECRET / NODE_ENV-only constraint
- Source: Codex
- Section: §1 Framing (line 51); §6 Phase 2 (line 209); §10.5 (lines 581–582)
- Description: "env override of the per-call-site constants" and "by env override" contradict the framing rule that the only env-driven knobs are `WEBHOOK_SECRET` and `NODE_ENV`.
- Codex's fix: remove env-override language; use "two-line PR changing constants" instead.
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix applied: §6.2.5 closing paragraph and §10.5 item 4 reworded to describe the kill-switch as "two-line PR raising the per-call-site `limit` constants or reverting the commit; no env-flag knob is introduced".

### F6 — `server/index.ts` missing Phase 2 inventory entry for cleanup-job registration
- Source: Codex
- Section: §5 File inventory (line 111); §6.2.4 (line 186); §11 Phase sequencing (lines 610–613)
- Description: cleanup-job registration in `server/index.ts` is required if pg-boss (the default recommendation) is chosen, but the inventory only lists Phase 3.
- Codex's fix: add Phase 2 to the `server/index.ts` row and to the Phase 2 row of the sequencing table.
- Classification: mechanical (file-inventory drift)
- Disposition: ACCEPT
- Fix applied: `server/index.ts` inventory row now reads "Modified | 2 + 3" with both Phase 2 (cleanup-job registration) and Phase 3 (boot assertion) responsibilities described. Phase sequencing table row 2 updated to include `index.ts` cleanup-job registration; row 3 updated to clarify "boot assertion only".

### F7 — Cleanup-job pg-boss vs setInterval undecided
- Source: Codex
- Section: §6.2.4 (line 186); §9 Execution model (lines 523–525)
- Description: cleanup-job execution mechanism left as architect call.
- Codex's fix: record a verdict (pg-boss recommended).
- Classification: rejected-mechanical (intentional architect-deferral per the user's invocation note)
- Disposition: REJECT
- Reason: The user explicitly noted that "cleanup-job pg-boss vs setInterval" is one of the architect-call items intentionally deferred. The spec already names pg-boss as the default recommendation; the architect agent will record the final verdict during plan breakdown. No spec edit required.

### F8 — `db.transaction` (G9 / inventory) vs raw `pg` BEGIN/COMMIT (§6.7.2)
- Source: Codex
- Section: §2 G9 (line 66); §5 File inventory (line 122); §6.7.2 (lines 342–361)
- Description: the goal and inventory describe the wrap as `db.transaction`, but the actual phase-plan code block uses raw `pg` `Pool` `client.query('BEGIN' / 'COMMIT' / 'ROLLBACK')`.
- Codex's fix: align the wording.
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix applied: G9 verification text and the file-inventory row both rewritten to say "raw `pg` `Pool` client transaction (`BEGIN` / `COMMIT` / `ROLLBACK` on the same client); the script uses raw `pg`, not Drizzle".

### F9 — env import vs process.env mismatch in reseed env guard
- Source: Codex
- Section: §4 Existing primitives search (line 90); §6.7.1 (lines 326–338)
- Description: §4 says "Reuse existing env validation by importing `env` from `server/lib/env.ts`"; §6.7.1 actually uses `process.env.NODE_ENV` directly.
- Codex's fix: pick one path; recommend direct `process.env.NODE_ENV` for the standalone CLI script.
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix applied: §4 row 5 changed to "Direct `process.env.NODE_ENV` check at script entry" with rationale that pulling `env` would import the full server-side validation chain into a standalone CLI script.

### F10 — `briefCreationEnvelope.ts` proposed-name vs `briefFastPath.ts` final placement
- Source: Codex
- Section: §4 Existing primitives search (line 87)
- Description: the §4 row's "Proposed" cell names `shared/types/briefCreationEnvelope.ts`, but the verdict + inventory + §7.4 all place the type in `shared/types/briefFastPath.ts`.
- Codex's fix: rename the proposed cell.
- Classification: mechanical (terminology drift)
- Disposition: ACCEPT
- Fix applied: §4 row's proposed cell renamed to "`BriefCreationEnvelope` type in `shared/types/briefFastPath.ts`".

### F11 — `windowSec` not in `rate_limit_buckets` PK
- Source: Codex
- Section: §6.2.1 (lines 151–166); §7.1 (lines 376–391); §7.2 (lines 423–432)
- Description: same opaque `key` reused with two different `windowSec` values would cross-pollute the sliding-window read.
- Codex's fix: either add `window_sec` to the table PK + contract, or require callers to encode the window size in the key string.
- Classification: directional (architecture / contract change)
- Disposition: AUTO-DECIDED — accept (route to `tasks/todo.md`)
- Reasoning: changing the PK is a substantive schema design call. Naming the convention in §7.1 is the lower-impact path. Routed to tasks/todo.md so the architect can confirm during plan breakdown. Today every call site uses a single `windowSec` per key namespace, so the issue is latent — does not block implementation.

### F12 — SERIALIZABLE claim vs no-retry contract
- Source: Codex
- Section: §6.2.3 (lines 177–180); §10.1 (lines 543–550)
- Description: "concurrency-safe under SERIALIZABLE" implies an isolation level that can produce retryable serialization failures, conflicting with the no-retry contract.
- Codex's fix: drop "SERIALIZABLE" and state the primitive is correct at any isolation level.
- Classification: mechanical (technical inaccuracy / load-bearing claim without correct mechanism)
- Disposition: ACCEPT
- Fix applied: §6.2.3 invariant rewritten to "PostgreSQL's `INSERT ... ON CONFLICT DO UPDATE` is per-row atomic at any isolation level (no explicit locking required, no SERIALIZABLE needed)".

### F13 — Login limiter pre-validation but key uses email
- Source: Codex
- Section: §6.2.5 (lines 191–193); §8 access-control table (lines 512–513)
- Description: limiter runs before `validateBody`, but the key shape includes the lowercased email — which may be missing or malformed.
- Codex's fix: either move validation before the limiter, or drop email from the pre-validation key.
- Classification: directional (substantive design call: trades audit signal for input safety)
- Disposition: AUTO-DECIDED — accept (route to `tasks/todo.md`)
- Reasoning: a real correctness concern, but the fix changes either the validation pipeline order or the limiter key shape — both are design calls. Routed to tasks/todo.md with the reviewer's recommendation (move `validateBody` first).

### F14 — Phase 6 title says "Path C" but body says all paths
- Source: Codex
- Section: §6.1 heading and body (lines 295–303)
- Description: subsection 6.1 is titled "Rate-limit middleware on Path C" but the body explicitly applies the limit to all paths (A/B/C).
- Codex's fix: rename the subsection.
- Classification: mechanical (title-vs-body drift)
- Disposition: ACCEPT
- Fix applied: §6.1 retitled to "Rate-limit middleware on `/api/session/message`". File-inventory row for `sessionMessage.ts` updated to clarify "applied to all paths (A/B/C)".

### F15 — AC7 says T-set covers 429 but T1–T8 doesn't
- Source: Codex
- Section: §6.2 table (lines 311–320); §14 AC7 (line 676)
- Description: AC7 claims the T-set covers a 429 path; T1–T8 has no 429 case.
- Codex's fix: change AC7 to static route inspection only, OR add a T9 429 case.
- Classification: mechanical (AC drift)
- Disposition: ACCEPT
- Fix applied: AC7 rewritten to "Static route inspection: `rateLimiter.check` is invoked after authentication and before the permission check. The T1–T8 set deliberately does not include a 429 case — the rate-limit edge is covered by the primitive's own tests in Phase 2."

### F16 — `findEntitiesMatching` is async svc; spec asks pure unit test
- Source: Codex
- Section: §2 G6 (line 63); §6 Phase 5 (lines 275–291); §12 Test matrix (line 633)
- Description: `findEntitiesMatching` is `Promise<ScopeCandidate[]>` — not unit-testable as a pure helper; but the spec's verification is "Unit test on the pure helper".
- Codex's fix: name a pure helper to test, e.g. `shouldSearchEntityHint(hint)`.
- Classification: mechanical (testing-posture vs implementation drift)
- Disposition: ACCEPT
- Fix applied: §6 Phase 5 reworked to extract `shouldSearchEntityHint(hint: string): boolean` as an exported pure helper that `findEntitiesMatching` consults at the top. G6 verification, file-inventory row, and §12 test matrix all updated to reference the helper.

### F17 — Key-builder unit test row but spec uses inline strings
- Source: Codex
- Section: §6.2.5 (lines 191–203); §12 Test matrix (line 632)
- Description: the test matrix asks for a "per-call-site key shape determinism" pure-fn permutation test, but the phase plan does not introduce named key-builder functions — every call site uses inline string concatenation.
- Codex's fix: either introduce named key builders, or remove the test row.
- Classification: mechanical (test plan vs implementation plan drift)
- Disposition: ACCEPT
- Fix applied: removed the key-shape determinism row from the test matrix. Replaced with a pure-helper unit test of `computeEffectiveCount` (the sliding-window math), which is the load-bearing pure function in the primitive. Inline string concatenation is verifiable by static inspection.

### F18 — All-or-nothing reseed vs partial-commit no-op contradiction
- Source: Codex
- Section: §7.5 (lines 494–498); §10.7 (lines 592–597)
- Description: §7.5 first paragraph says "all-or-nothing... mid-loop failure leaves the DB unchanged"; second paragraph mentions "re-running over a partial commit just no-ops". §10.7 has the same contradiction. After a successful `ROLLBACK` there is no "partial commit" to re-run over.
- Codex's fix: remove the partial-commit/no-op sentence; clarify rerun semantics after rollback vs after success.
- Classification: mechanical (internal contradiction)
- Disposition: ACCEPT
- Fix applied: §7.5 rewritten to separate the two cases: (a) failed run → `ROLLBACK` → DB unchanged → re-run starts clean; (b) successful run → re-run no-ops because target rows already match the backup. §10.7 idempotency-posture bullet rewritten in the same shape.

---

## Rubric findings (my own pass, not from Codex)

R1 — Reseed rollback integration test (§12 row "Reseed `_reseed_restore_users.ts`") was internally inconsistent with the same paragraph's "the only deviation is F8". Folded into F2's resolution (replaced with static inspection). Mechanical accept.

R2 — Phase 1 subsection title and ToC entry retained "disk spillover" terminology after the all-disk verdict landed. Mechanical accept; both updated to "Multer cap + disk storage".

R3 — AC2 ("`server/lib/rateLimiter.ts` shipped with unit + integration tests covering window edges, concurrent-increment race, TTL cleanup") was made stale by F2's resolution. Mechanical accept; rewritten to reference the pure-unit test of `computeEffectiveCount` and to declare concurrency + TTL correctness as static-inspection concerns (per-row UPSERT atomicity from §10.1; structural single-DELETE from §10.2).

No additional rubric findings beyond Codex's set + R1 + R2 + R3.

---

## Iteration 1 Summary

- Mechanical findings accepted:  14 from Codex (F1, F3, F4, F5, F6, F8, F9, F10, F12, F14, F15, F16, F17, F18) + 3 rubric (R1 folded into F2 resolution; R2 stale phrase; R3 AC2 staleness) = **17 mechanical fixes applied**
- Mechanical findings rejected:   1 (F7 — intentional architect-deferral)
- Directional findings:           3 (F2, F11, F13)
- Ambiguous findings:             0
- Reclassified → directional:     0
- Autonomous decisions (directional/ambiguous): 3
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             3 (F2, F11, F13 — see `tasks/todo.md` § Deferred from spec-reviewer review — pre-prod-boundary-and-brief-api)
- Spec commit after iteration:   pending — committed at end of Step 8b

**Stopping heuristic check:** N=1, mechanical_accepted=17, mechanical_rejected=1, directional=3. Not at cap. Not two consecutive mechanical-only rounds (only 1 round so far). Codex produced findings. Acceptance rate non-zero. Proceed to iteration 2.
