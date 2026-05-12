# ChatGPT Spec Review — Round 3 Prompt (paste into the SAME chatgpt.com conversation as Rounds 1 + 2)

Continue the existing conversation. Copy the block below and paste it as a follow-up message.

## Copy from here ⬇

=====

I have applied all 8 findings (F1-F3 + R1-R5) and all 5 nits from your Round 2 review. Below is the full updated spec. Your Round 2 verdict said *"After Round 1, the spec is close. I'd apply the three required fixes above, then lock. The remaining issues are mostly count drift and contract polish, not architectural gaps."* — we applied the three required fixes AND all the tightenings AND the nits.

Please verify Round 3:

1. Each Round 2 finding (F1, F2, F3, R1-R5) is fully resolved with no consistency drift introduced by the fix.
2. The CURRENT_VERSION / PUBLISHED_VERSION two-file split (F2) is internally coherent across §10.2, §15.2, §15.3, §19.1, §23.
3. The seven-job + five-table counts (F1, R2, R3) are now consistent everywhere in the spec (no leftover "four tables" / "five jobs" stragglers).
4. The CHECK constraint refactor in §20.3 (R5) captures the invariant cleanly and doesn't contradict the lifecycle in §13.1.
5. Nothing new is surfaced that would block the lock.

If APPROVED with no remaining issues, say so plainly and confirm the spec is lock-ready. If anything remains, list it as Fn / Rn with the Round 1/2 severity scale.

## Updated spec

[PASTE THE FULL CONTENT OF `tasks/builds/sandbox-isolation/spec.md` HERE (now 1677 lines)]

## Summary of Round 2 changes applied (your reference)

- **F1 (counts):** §4.1 / §6 / §14.4 / §14.4a / §19.3 / §19.4 / §25.3 / §26.1 / §29.7 all updated to five sandbox tables + four SQL migrations + one sequencing script + seven pg-boss jobs. `rlsProtectedTables.ts` row now lists all five. `server/jobs/index.ts` row now lists all seven.
- **F2 (CURRENT_VERSION reproducibility):** §15.2 split into `CURRENT_VERSION` (human-committed pre-build: version, template_resource_class, max_cost_cents_per_second, base_image_digest, deps_lockfile_hash) + `PUBLISHED_VERSION` (CI-attestation-PR-committed post-build: version, image_digest, ci_build_commit, registry_published_at, scanner_result_hash). Deterministic-build requirements locked. CI is the final-digest source of truth. §15.3 updated to read `PUBLISHED_VERSION.image_digest`. §10.2 + §19.1 reference the new field name.
- **F3 (max_cost_cents_per_second in CURRENT_VERSION):** Folded into F2's full contract. `templateVersionParserPure.ts` added to §19.1.
- **R1 (C1 chunk scope):** §23 C1 row updated to five schemas + four SQL migrations + one sequencing script.
- **R2 (sandboxWallClockKillJob in C11):** Added to §23 C11 + §23.1 dependency notes + §19.1.
- **R3 (sandboxLogsPruneJob in C11):** Added to §23 C11.
- **R4 (§14.4a Run Trace virtual view → 5 sources):** Added `sandbox_logs` as the fifth join source.
- **R5 (CHECK constraint wording §20.3):** Refactored as four CHECKs: closed-enum status; `(provider_sandbox_id IS NULL OR status <> 'pending')`; `(status NOT IN ('running', 'harvesting') OR provider_sandbox_id IS NOT NULL)` (your recommended positive invariant); `(start_attempt_count >= 0)`.
- **Nits (all 5):** §17.3 "at runtime"; §14.4 / §25.3 / §29.7 counts aligned; §26.1 aligned with §19.4.

## Response format

```
## Verdict
APPROVED — LOCK | CHANGES_REQUESTED | NEEDS_DISCUSSION

## Resolution of Round 2 findings
F1: RESOLVED | PARTIAL | NEW_ISSUE
F2: ...
F3: ...
R1: ...
R2: ...
R3: ...
R4: ...
R5: ...
Nits: RESOLVED | ...

## New findings (if any)
### Fn. [title]
**Severity:** Blocker | Strong | Recommendation | Polish
...

## Lock recommendation
LOCK | DO NOT LOCK
```

If verdict is APPROVED — LOCK, no more rounds needed.

=====

## ⬆ Paste up to here

## Operator instructions

Same paste mechanics as Rounds 1 + 2. Replace the placeholder with the actual spec content (1677 lines). Continue the existing chatgpt.com thread. Paste ChatGPT's response back to me.

If ChatGPT returns APPROVED — LOCK, we proceed to handoff write + Phase 1 closeout in this session.
