# Spec Review Plan — audit-remediation-followups

- **Spec path:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`
- **Spec commit at start:** `264f59efpsaud8c685a609ce417133b8e0255a` → actual `264f59ef536e7ed8c685a609ce417133b8e0255a`
- **Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
- **MAX_ITERATIONS:** 5 (full lifetime headroom — no prior reviews on this spec)
- **Prior iterations found:** none
- **Stopping heuristic:** two consecutive mechanical-only rounds → stop before cap.

## Pre-loop context check

- Spec-context loaded: `docs/spec-context.md` (last modified 2026-04-16; commit `03cf81883b6c420567c30cfc509760020d325949`).
- Spec framing vs context: spec is post-merge backlog; explicitly states "PR #196 has merged" and "none of these items are blocking" — consistent with `pre_production: yes`, `rollout_model: commit_and_revert`. No mismatch detected.
- G1 explicitly self-marks SUPERSEDED. G2 noted as "ACTIONABLE". Proceeding.

## Pre-known mechanical/rubric findings (to drive iteration 1 rubric pass)

These were identified before invoking Codex — they will be cross-referenced after Codex output is parsed.

1. **Path drift (`scripts/gates/verify-rls-coverage.sh` → `scripts/verify-rls-coverage.sh`).** Spec A2 line 133 references `scripts/gates/verify-rls-coverage.sh`. Actual file lives at `scripts/verify-rls-coverage.sh`. The header comment in `rlsProtectedTables.ts` repeats the wrong path — but spec is the artifact under review, and spec line 139 also references `scripts/gates/verify-rls-coverage.sh` (same wrong path).
2. **Migration number drift (`0228_*` → `0227` is current latest).** Spec F2 line 838 says "the next available number — `0228_*` at time of writing". Latest migration on disk is `0227_rls_hardening_corrective.sql`, so 0228 is in fact correct as the next number. **No drift — spec is correct.** Confirmed.
3. **Anchor link drift in §1 ToC.** Item B2 anchor in ToC: `#b2--b2-ext--job-idempotency-audit--concurrency-standard` — verify it matches the actual heading slug. The actual heading is `#### B2 + B2-ext — Job idempotency audit + concurrency standard`. GitHub-flavoured slug for this would be `b2--b2-ext--job-idempotency-audit--concurrency-standard` — appears matched.
4. **`onboardingStateService.ts` line claim (`:51`).** Spec A3 says transaction at `:51`. Actual `db.insert` starts at `:51` (verified by sed sample). **No drift.**
5. **`briefVisibilityService.ts:30, :49`.** Spec A3 line 191 cites read paths at `:30, :49`. Actual read paths begin at `:30` (`db.select`) and `:49` (`db.select`). Close enough; minor drift acceptable.
6. **D1 footnote: `f824a03` parent ref.** Spec D1 line 538 says "checkout `main` at `f824a03` (PR #196 merge commit's parent — `f824a03~1`)". This is contradictory. `f824a03` IS the merge commit; its parent is `f824a03~1` or `f824a03^1` (first-parent of merge commit, which is the prior `main` HEAD). Spec is asking the reader to "checkout main at f824a03" but then says "f824a03~1 is the pre-PR-196 state". Wording is muddled — should say "checkout `f824a03^1` (or `f824a03~1`) — the parent of the merge commit". Mechanical fix.
7. **D1 baseline output destination contradiction.** Spec D1 line 533 references "`docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md` § 5.7 / `tasks/builds/audit-remediation/progress.md`" — but writing baselines into a previously-merged source spec is unusual and the wording ambiguates between "the already-merged spec" and "this followups spec". A mechanical fix is to clarify the destination is the followups spec OR a dedicated baseline artefact.
8. **A2 step 2 sub-bullet contradiction.** Spec A2 step 2 line 153: "If not listed and not annotated `@rls-not-applicable`: throw `RlsBoundaryUnregistered`." But the dev/test guard wraps `getOrgScopedDb` writes to listed tables — for a non-listed table, the guard wouldn't even fire (no lookup match). This bullet contradicts the lookup-then-decide flow described two bullets earlier. Mechanical clarification needed.
9. **Annotation site mismatch (A2).** Step 4 says annotation goes "in the schema file" — but A1's analogous annotation goes "at top of file". Both should be consistent. Verify whether schema or service file is the right home.

These will be added to the iteration-1 finding queue regardless of what Codex surfaces.
