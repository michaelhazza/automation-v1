# spec-reviewer log — pre-launch-phase-3

**Spec:** `tasks/builds/pre-launch-phase-3/spec.md`
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

**Codex command:** `codex review --commit d9949056 --title "pre-launch-phase-3 spec review iteration 1"`
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

Both findings auto-applied via Edit. See `tasks/builds/pre-launch-phase-3/spec.md` post-iter-1 commit.

---

## Iteration 1 — stopping heuristic

- Findings: 2 mechanical, 0 directional, 0 ambiguous, 0 rejected.
- Continue: yes — at least one round of mechanical-only is required to verify no follow-on findings.

---

## Iteration 2

**Codex command:** `codex review --commit 5729d580 --title "pre-launch-phase-3 spec review iteration 2"`
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
