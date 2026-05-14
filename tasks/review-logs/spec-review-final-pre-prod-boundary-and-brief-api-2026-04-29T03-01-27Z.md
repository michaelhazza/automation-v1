# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Spec commit at start:** untracked (working-tree-only at `93e855e7`)
**Spec commit at finish:** `e2bc57026deb25f59a24a1364b4822f898bbe170`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD (3 iterations, 42 mechanical fixes applied across 18 sections; 3 directional items routed to `tasks/todo.md` for human review)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 18 | 3 (R1 folded, R2 stale phrase, R3 AC2 staleness) | 17 (14 Codex + 3 rubric) | 1 (architect-deferral) | 0 | 0 | 3 (F2, F11, F13) |
| 2 | 16 | 0 | 14 | 2 (1 architect-deferral + 1 iter1 duplicate) | 0 | 0 | 0 (zero NEW) |
| 3 | 16 | 0 | 11 | 6 (4 architect-deferrals + 1 iter1 duplicate + 1 hallucination) | 0 | 0 | 0 (zero NEW) |

Totals: 50 distinct Codex findings across 3 iterations; 42 mechanical fixes applied; 9 rejections (5 architect-deferrals, 3 re-flags of already-routed items, 1 hallucination); 3 AUTO-DECIDED items routed to `tasks/todo.md`.

---

## Mechanical changes applied (grouped by spec section)

### §1 Framing
- Removed stale "until Phase 2 trigger" testing-posture language; explicit citation of F8 sessionMessage as the only deviation.

### §2 Goals
- G1: spillover-at-5-MB → `multer.diskStorage` for all uploads with 50 MB cap (no architect hedge).
- G3: "all five" → "every existing in-process / `express-rate-limit` call site enumerated in §6.2.5".
- G6: "Unit test on the pure helper" → references the extracted `shouldSearchEntityHint` helper.
- G9: "wraps in `db.transaction`" → "raw `pg` `Pool` client transaction (`BEGIN` / `COMMIT` / `ROLLBACK` on the same client)".

### §4 Existing primitives search
- `shared/types/briefCreationEnvelope.ts` proposed-name → corrected to "`BriefCreationEnvelope` type in `shared/types/briefFastPath.ts`".
- Reseed env-guard row: "import `env` (or script-level equivalent)" → "Direct `process.env.NODE_ENV` check at script entry".

### §5 File inventory
- `server/index.ts` row: Phase 3 → Phase 2 + 3 (added cleanup-job registration responsibility).
- `validate.ts` row: "spillover above 5 MB" → "all uploads use `multer.diskStorage`".
- `sessionMessage.ts` row: "Path C response carries…" → "every `brief_created` arm (Paths A/B/C)".
- `GlobalAskBar.tsx` row: "Path C handler" → "every `brief_created` response arm (Paths A/B/C)".
- `scopeResolutionService.ts` row: extended to name `shouldSearchEntityHint` and its consumption inside `findEntitiesMatching`.
- `_reseed_restore_users.ts` row: "Wrap in `db.transaction`" → "Wrap in raw `pg` `Pool` client transaction".
- `Callers of checkTestRunRateLimit` row replaced with explicit enumeration of the four route files (`agents.ts`, `skills.ts`, `subaccountAgents.ts`, `subaccountSkills.ts`) at the exact line numbers, plus deletion entry for `testRunRateLimitPure.test.ts`.
- Added `package.json` (root) + `package-lock.json` row with the transitive-dep clarification.
- Added `rateLimiterPure.test.ts` and `scopeResolutionPure.test.ts` rows (Phase 2 + Phase 5 pure-unit deliverables).

### §6.1 Phase 1 (Multer)
- Title: "disk spillover" → "disk storage" (matching all-disk verdict).
- Multer prose: hybrid-engine option deferred; pure `multer.diskStorage` chosen.
- `limits.fileSize` hedge "50 MB vs 25 MB" removed; 50 MB committed.
- Tempfile cleanup: middleware-level verdict committed; iteration over `req.files` array pinned with explicit code block; `ENOENT` handled as success.

### §6.2 Phase 2 (rate limiter)
- §6.2.1 migration retained.
- §6.2.3 implementation invariants:
  - SQL CTE pinned with positional bind parameters (`$1`/`$2`/`$3`) and a leading param-naming comment.
  - "concurrency-safe under SERIALIZABLE" → "per-row atomic at any isolation level".
  - "every `check()` does the read + UPSERT" (2 round-trips) → "every `check()` does the single CTE round-trip described above".
  - Sliding-window math factored into pure helper `computeEffectiveCount`.
- §6.2.4 cleanup job:
  - 1-hour cutoff → 2-hour cutoff. Retention rationale (`2 * max(windowSec)`) carried inline. Critical correctness fix.
- §6.2.5 call-site migration:
  - "five call sites" → "every call site enumerated below".
  - Test-run callers row enumerated with file paths + line numbers.
  - "by env override of the per-call-site constants" → "two-line PR raising the per-call-site `limit` constants or reverting the commit; no env-flag knob is introduced".
  - `Retry-After` made mandatory (matches §7.1 contract).
  - Deletion list updated for the actual import location and transitive-dep nuance.

### §6.3 Phase 3 (webhook)
- §6.3.2 prose: "a single warning at boot answers that" → "a single warning on the first callback verification per process answers that" (matches the implementation's first-call branch).

### §6.4 Phase 4 (brief envelope)
- §6.4.1 prose: "optional resolved-context fields" → "required at the type level; the name fields and `subaccountId` may be `null` …".
- §6.4.2 retitled to cover every `brief_created` arm explicitly (Path A `pendingRemainder`, Path B decisive, Path C plain).
- §6.4.3 modal `fastPathDecision` hedge removed; verdict committed (modal does not act on it; type-only import).

### §6.1 / §6 Phase 6
- §6.1 (subsection 6.6.1) retitled "Rate-limit middleware on `/api/session/message`" (was "Path C").
- T5 description rewritten to clarify that T5 covers the route-level guard; the service-level guard is verified by the pure-unit test in §12.

### §6.7 Phase 7 (reseed)
- §6.7.1 hedge removed; verdict (`NODE_ENV` only) committed inline.
- §6.7.2 prose: "wrap in `pool.query('BEGIN') / 'COMMIT'`" → "lease a single `client` via `pool.connect()` and run all of `BEGIN` / `UPDATE` / `COMMIT` / `ROLLBACK` through `client.query`. Never call `pool.query` for any of these — that returns a different connection per call and would not establish a transaction."

### §7.1 Contract — `RateLimiter` primitive
- `check()` JSDoc rewritten — "does NOT throw for denial outcomes; operational DB errors propagate as a rejected promise; caller MUST NOT retry".
- `RateLimitCheckResult.remaining` formula pinned: `Math.max(0, Math.floor(limit - effectiveCount))`.
- `RateLimitCheckResult.resetAt` formula pinned: `new Date((window_start_seconds + windowSec) * 1000)`.
- `Retry-After` derivation pinned: `Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))`.
- Cleanup-row example updated: `now - 2h` (matches the new TTL).

### §7.4 Contract — `BriefCreationEnvelope`
- Producer line enumerated to cover Path A / B / C.
- Consumer line enumerated for Layout + every `brief_created` arm in GlobalAskBar.
- Example JSON `fastPathDecision` rewritten to match the real `FastPathDecision` shape (`{ route, scope, confidence, tier, secondLookTriggered, keywords, reasoning }`).

### §7.5 / §10.7 Contract — Reseed transaction
- "All-or-nothing" invariant preserved; the contradicting "rerun over partial commit no-ops" sentence rewritten — failed runs roll back to the pre-run state; only successful prior runs produce the no-op-on-rerun behaviour. The two cases are now explicitly separate.
- §10.7 idempotency-posture bullet rewritten in the same shape.

### §10.1 / §10.2 / §10.5 / §10.6 Execution-safety contracts
- §10.1 SERIALIZABLE wording removed (matches the new §6.2.3 atomicity claim).
- §10.2 cleanup operation cutoff updated to `2 hours` with cross-reference to §6.2.4.
- §10.5 no-shim rationale: "by env override" → "two-line PR; no env-flag knob is introduced".
- §10.6 wording: tempfile cleanup operation iterates over the file array (matches §6.1 code block).

### §12 Test matrix
- `rateLimiter.check` integration rows (concurrent race + TTL cleanup) replaced with a pure-unit test of `computeEffectiveCount`. Concurrency correctness now declared as a static-inspection concern (per-row UPSERT atomicity in §10.1); TTL correctness is structural (single DELETE statement in §10.2).
- `findEntitiesMatching` pure-unit test row → `shouldSearchEntityHint` (the actual pure helper).
- Reseed `_reseed_restore_users.ts` integration row → static inspection (`pg` transaction semantics are not under test).
- Reseed `_reseed_drop_create.ts` pure-unit test row → static inspection (the literal env-guard block is not extractable as a pure helper without unwarranted abstraction).
- "Multer disk-spillover smoke check >5 MB" → "Multer upload-flow smoke at ~20 MB via the new `multer.diskStorage`".

### §13 Deferred items
- `Retry-After` deferral entry replaced with a one-line HTML comment noting "NOT deferred — Phase 2 / 6 mandate it everywhere".

### §14 Acceptance criteria
- AC1: spillover wording → all-disk wording.
- AC2: integration tests → pure-unit `computeEffectiveCount` test + static inspection for concurrency / TTL.
- AC3: "all five" → "every rate-limit call site enumerated in §6.2.5".
- AC7: "T-set covers a 429 path" → static route inspection only (the T1–T8 set deliberately does not include a 429 case).

---

## Rejected findings

| # | Iter | Section | Description | Rejection reason |
|---|---|---|---|---|
| F7 | 1 | §6.2.4 | Cleanup-job pg-boss vs setInterval verdict undecided | Intentional architect-deferral per the user's invocation note. Default recommendation (pg-boss) is in the spec; architect agent records the final verdict during plan breakdown. |
| i2-F3 | 2 | §6.2.4 | Same as F7 | Same reason — re-flag. |
| i3-F1 | 3 | §6.2.4 | Same as F7 | Same reason — third re-flag. |
| i3-F2 | 3 | §6.2.3 | Sliding-window weighted vs fixed-window verdict undecided | Intentional architect-deferral per the user's note. Default (weighted) is in the spec. |
| i3-F10 | 3 | §6.6.1 | `/api/session/message` rate-limit key shape per-user vs per-user+org undecided | Intentional architect-deferral per the user's note. |
| i3-F11 | 3 | §5 / §6.3.2 / §7.3 | Webhook fallback warn-once cardinality (per-process vs per-secret) undecided | Intentional architect-deferral per the user's note. |
| i2-F7 | 2 | §6.2.5 / §8 | Login limiter pre-validation but key uses email | Re-flag of iter1 F13 — already AUTO-DECIDED and routed to `tasks/todo.md`. The decision is intentional design call deferred to architect/human. |
| i3-F6 | 3 | §6.2.5 / §8 | Same as iter1 F13 | Re-flag — same reason. |
| i3-F17 | 3 | "throughout" | Mojibake in headings / cross-references / arrows | Codex hallucination. The spec file on disk is valid UTF-8 (`file` reports "Unicode text, UTF-8 text"; em-dashes hex-decode as `e2 80 94`). The mojibake Codex saw was a terminal-codec artifact in its own preview output. |

---

## Directional and ambiguous findings (autonomously decided)

| Iteration | Finding | Classification | Decision type | Rationale |
|---|---|---|---|---|
| 1 | F2 — Test matrix exceeds the F8-only deviation (rateLimiter concurrent + TTL cleanup; reseed rollback all integration tests) | directional (testing-posture: "fewer tests below the envelope") | AUTO-DECIDED — accept | Reduction aligns with the framing (`runtime_tests: pure_function_only`). Auto-collapsed rateLimiter rows into pure-helper `computeEffectiveCount` test; reseed rollback row replaced with static inspection. Routed to `tasks/todo.md` for human to confirm or restore one with explicit framing acknowledgement. |
| 1 | F11 — `windowSec` not in `rate_limit_buckets` PK (latent risk if same `key` reused with different `windowSec`) | directional (architecture / contract change) | AUTO-DECIDED — accept | Routed to `tasks/todo.md`. Today every call site uses a single `windowSec` per key namespace, so the issue is latent and does not block implementation. The architect should choose between (a) name the convention in §7.1 — "callers MUST encode `windowSec` in the key string when reusing a namespace with multiple window sizes" — or (b) add a `window_sec` column to the PK. |
| 1 | F13 — Login rate limiter is keyed on `ip + emailLower` but invoked before `validateBody` | directional (validation pipeline order vs limiter key shape) | AUTO-DECIDED — accept | Routed to `tasks/todo.md` with reviewer recommendation: move `validateBody` first. Re-flagged in iter2 (i2-F7) and iter3 (i3-F6) but kept in the same routed entry — the design call is intentional. |

All three are tracked under `tasks/todo.md` § "Deferred from spec-reviewer review — pre-prod-boundary-and-brief-api". None of them blocks implementation.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against three rounds of Codex review. The reviewer adjudicated every directional finding that surfaced. However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 Framing section yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. The architect-call items (cleanup-job pg-boss vs setInterval, sliding-window weighted vs fixed-window, `/api/session/message` per-user vs per-user+org key, warn-once-per-process vs warn-once-per-secret, login limiter pre/post-validation, `windowSec`-in-PK vs key-encoded) are intentional deferrals. The architect agent will record the final verdicts during plan breakdown.

**Recommended next step:** re-read the spec's §1 Framing + §2 Goals + §3 Non-goals (first ~80 lines), confirm the headline findings match your current intent, then invoke the `architect` agent to break the spec down into implementation chunks. The three AUTO-DECIDED items in `tasks/todo.md` can be triaged at any time — they are informational, not gates on the architect pass.
