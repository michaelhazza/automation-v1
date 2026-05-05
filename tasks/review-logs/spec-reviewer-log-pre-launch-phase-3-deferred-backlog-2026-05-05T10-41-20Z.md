# spec-reviewer log — pre-launch-phase-3-deferred-backlog

**Spec:** `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md`
**Branch:** `claude/pre-launch-phase-3`
**Reviewer:** spec-coordinator (Opus, inline) running spec-reviewer playbook
**Cap:** MAX_ITERATIONS = 5
**Codex CLI:** v0.125.0 (authenticated via ChatGPT login)

---

## Pre-loop context check

- `docs/spec-context.md` last_reviewed_at: 2026-04-16. Current date: 2026-05-05. Age: 19 days. Within `stale_after_days: 60`. GREEN — proceed.
- Spec framing matches spec-context.md (pre-production, no live users, commit-and-revert, prefer existing primitives, no feature flags). No mismatches logged.

---

## Iteration 1

**Codex command:** `codex review --commit d9949056 --title "pre-launch-phase-3-deferred-backlog spec review iteration 1"`
**Codex verdict:** "introduces actionable implementation guidance that would produce a brittle CI gate and a non-idempotent GHL pagination job under retries"
**Findings:** 2 (both P2 / important)

### Finding 1 — B.3 grep gate brittleness

- **Source:** Codex
- **Section:** §11 B.3 (verify-rate-limit-key-normalisation.sh)
- **Description:** Gate spec says "Pattern-match for `.toLowerCase().trim()` or `normaliseEmail(` in the same expression" — would reject the existing valid pattern where email is normalised once into a variable then passed.
- **Codex's suggested fix:** Allow normalised-variable patterns at the call site, not inline normalisation only.
- **Classification:** mechanical (load-bearing claim with mechanically-broken enforcement)
- **Disposition:** auto-apply

### Finding 2 — D.5 GHL pagination idempotency

- **Source:** Codex
- **Section:** §11 D.5 (`ghl:auto-enrol-locations-page` job) + §12.1 (job idempotency row)
- **Description:** `WHERE NOT EXISTS subaccount.ghl_location_id = page_cursor` predicate uses a pagination token in place of a location id. Re-runs would duplicate work or hit uniqueness errors.
- **Codex's suggested fix:** Key the predicate on each page item's location id, not the page cursor.
- **Classification:** mechanical (broken idempotency posture — exact §10.1 finding the spec-authoring checklist catches)
- **Disposition:** auto-apply

---

## Iteration 1 — fixes applied

Both findings auto-applied via Edit. See `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md` post-iter-1 commit.

---

## Iteration 1 — stopping heuristic

- Findings: 2 mechanical, 0 directional, 0 ambiguous, 0 rejected.
- Continue: yes — at least one round of mechanical-only is required to verify no follow-on findings.

---

## Iteration 2

**Codex command:** `codex review --commit 5729d580 --title "pre-launch-phase-3-deferred-backlog spec review iteration 2"`
**Codex verdict:** "directs implementers to use an ON CONFLICT target that will not match the partial unique index it also defines"
**Findings:** 1 (P2 / important)

### Finding 3 — D.5 ON CONFLICT predicate mismatch

- **Source:** Codex
- **Section:** §11 D.5 + §12.1
- **Description:** ON CONFLICT clause `WHERE external_id_namespace = 'ghl_location'` is a subset of the partial-unique-index predicate `external_id_namespace = 'ghl_location' AND deleted_at IS NULL`. Postgres requires the conflict target's WHERE clause to match the index predicate exactly to infer the index — otherwise: `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
- **Codex's suggested fix:** include `AND deleted_at IS NULL` in the ON CONFLICT predicate.
- **Classification:** mechanical (broken SQL — exact replication of a known-bad pattern)
- **Disposition:** auto-apply

## Iteration 2 — fixes applied

`INSERT ... ON CONFLICT (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL DO NOTHING` — applied via Edit `replace_all` to both §11 D.5 and §12.1 GHL job row.

## Iteration 2 — stopping heuristic

- Findings: 1 mechanical, 0 directional, 0 ambiguous, 0 rejected.
- Continue: yes — one more round to confirm convergence.

---

## Iteration 3

**Codex command 1:** `codex review --commit 039e3e8a --title "iter 3"` — scoped to the iter-2 commit.
**Verdict:** CLEAN. "I did not find any introduced correctness issue in the changed lines."

**Codex command 2:** `codex review --base main --title "iter 3 full branch"` — scoped to the full branch diff vs main, to catch findings outside the latest commit.
**Verdict:** 1 P2 finding (outside spec — on `tasks/current-focus.md`).

### Finding 4 — Mission Control parser ignores parallel block

- **Source:** Codex
- **Section:** `tasks/current-focus.md` line 15 (`mission-control-parallel` block) — outside spec scope
- **Description:** Mission Control dashboard's `parseCurrentFocusBlock` only matches the canonical `<!-- mission-control ... -->` regex; the new parallel block is ignored.
- **Codex's suggested fix:** teach the parser about parallel blocks OR use an existing mechanism for in-flight builds.
- **Classification:** ambiguous (operational tooling drift, not a spec finding; outside the spec under review)
- **Disposition:** auto-decide → log to `tasks/todo.md` as a deferred operational item; do not block Phase 3 spec on dashboard tooling.
- **Reasoning:** The operator explicitly authorised parallel operation per the Phase 3 invocation instructions ("a parallel `baseline-capture` build is currently in REVIEWING ... Don't disturb its active-build pointer — add the Phase 3 entry alongside it"). The dashboard limitation is a known consequence of running two coordinator sessions in parallel; the spec is not the venue for fixing the dashboard parser. The Phase 3 build is correctly tracked via `tasks/builds/pre-launch-phase-3-deferred-backlog/progress.md` and the handoff file regardless of dashboard visibility.

## Iteration 3 — stopping heuristic

- Findings: 0 mechanical, 0 directional, 1 ambiguous (auto-decided + routed to todo.md), 0 rejected.
- The mechanical-only signal is now achieved (commit-scoped iter 3 = CLEAN). Full-branch iter 3 raised one operational finding outside spec scope.
- **STOP** — two consecutive rounds with no spec-scope mechanical findings (iter 2 was the last one). Spec is mechanically tight.
- Iterations used: 3 of 5.

---

## Final verdict

**spec-reviewer:** READY_FOR_BUILD with one operational note routed to `tasks/todo.md`.

**Iteration count used:** 3 of 5. Two remain available if a major edit triggers a re-review.

**Mechanical findings applied:** 3 across iterations 1-2 — gate brittleness, GHL idempotency, ON CONFLICT predicate.

**Directional findings:** 0. The spec stayed inside framing assumptions throughout.

**Ambiguous findings:** 1 (Mission Control dashboard parallel-block parsing) — auto-decided to defer; outside spec scope.
