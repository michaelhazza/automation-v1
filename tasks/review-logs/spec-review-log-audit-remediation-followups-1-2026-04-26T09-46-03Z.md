# Spec Review Log — audit-remediation-followups — Iteration 1

**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`
**Spec commit at iteration start:** `264f59ef536e7ed8c685a609ce417133b8e0255a`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Codex output:** `tasks/review-logs/_spec-review-audit-remediation-followups-iter1-codex-output.txt`

## Findings classification

| # | Source | Section | Description | Class | Disposition |
|---|---|---|---|---|---|
| 1 | Codex X-cut #1 | front-matter | Created 2026-04-26 / Last revised 2026-04-25 contradiction | mechanical | auto-apply |
| 2 | Codex X-cut #2 | A1/A2/B2/F2/H1 tests | Testing-posture violations | mostly mechanical + 1 directional | auto-apply (framing paragraph) + AUTO-DECIDED reject (F2 multi-process) |
| 3 | Codex A1 #1 | A1 step 4 | Hardened gate still file-level, not call-level | mechanical | auto-apply |
| 4 | Codex A1 #2 | A1 / C4 | Annotation contract conflicts with C4 end state | mechanical | auto-apply |
| 5 | Codex A2 #1 | A2 step 3 | Migration-hook path drift `server/db/migrations` → `migrations` | mechanical | auto-apply |
| 6 | Codex A2 #2 | A2 step 2 | "Drizzle middleware seam" doesn't exist + path drift `server/lib/db/` | mechanical | auto-apply |
| 7 | Codex A2 #3 | A2 step 1+4 | Exemption mechanism inconsistent (TS comment vs schema introspection) | mechanical | auto-apply |
| 8 | Codex A3 #1 | A3 step 1+2 | `getOrgScopedDb` module-top + `withOrgTx(orgId,...)` wrong signatures | mechanical | auto-apply |
| 9 | Codex A3 #2 | A3 step 4 | "No new gate needed" wrong (verify-rls-contract-compliance allowlists services/) | mechanical | auto-apply |
| 10 | Codex B2 #1 | B2 Risk | `Jest --repeats 10` — repo uses `tsx`, not Jest | mechanical | auto-apply |
| 11 | Codex D3 #1 | D3 step 2 | `@no-read-path` annotation incompatible with current line-counter gate | mechanical | auto-apply |
| 12 | Codex E2 #1 | E2 step 3 | Invents `scripts/baselines/integration-reference.txt`; existing store is `guard-baselines.json` | mechanical | auto-apply |
| 13 | Codex F2 #1 | F2 | Invents `kvStoreWithTtlService` competing with source spec's `rateLimitStoreService` | mechanical | auto-apply (rewrite as consumer-only) |
| 14 | Codex F2 #2 | F2 | `0228_*` pre-allocated migration number | mechanical | auto-apply (resolved by F2 rewrite — no schema) |
| 15 | Codex G1 #1 | G1 | "Staging" references conflict with framing; "read-only" wrong (writes happen) | mechanical | auto-apply |
| 16 | Rubric R1 | A2 | `scripts/gates/verify-rls-coverage.sh` — actual is `scripts/verify-rls-coverage.sh` | mechanical | auto-apply (folded into A2 rewrite) |
| 17 | Rubric R2 | D1 step 1 | `f824a03~1` wording muddled (mixes merge commit vs parent) | mechanical | auto-apply |
| 18 | Rubric R3 | D1 Files | Baseline destination ambiguous (merged source spec vs progress.md) | mechanical | auto-apply |
| 19 | Rubric R4 | A2 step 2 | Sub-bullet contradiction (non-listed table never reaches throw) | mechanical | auto-apply (resolved by A2 rewrite) |
| 20 | Rubric R5 | A2 step 4 | Annotation site mismatch with A1 (TS comment vs schema file) | mechanical | auto-apply (replaced by file-based allowlist) |

## Mechanical changes applied (by section)

### §0 Why this spec exists
- Front-matter dates corrected.
- Added "Testing posture (per spec-context)" paragraph naming the carved-out integration-test items (A1 RLS-context, A2 RLS write-boundary, B2 idempotency/concurrency, H1 null-safety) and calling out F2 multi-process as outside the envelope → manual smoke step.

### A1
- Step 4 rewritten: call-site granularity (negative pattern + positive pre-filter), not file-level.
- Acceptance criteria updated to match.

### A2
- Audit verdict path drift `scripts/gates/verify-rls-coverage.sh` → `scripts/verify-rls-coverage.sh` corrected.
- Files list: `server/lib/db/rlsBoundaryGuard.ts` → `server/lib/rlsBoundaryGuard.ts`; new file `scripts/rls-not-applicable-allowlist.txt`; migration-hook path `server/db/migrations/*.sql` → `migrations/*.sql`.
- Step 1: introspection switched from "live schema (or migrations)" to "parse SQL migrations" only (single source).
- Step 2 (runtime guard): replaced "Drizzle executor middleware" with Proxy wrapping of `getOrgScopedDb` / `withAdminConnection` returns; introduced two named errors (`RlsBoundaryUnregistered`, `RlsBoundaryAdminWriteToProtectedTable`).
- Step 4: file-based allowlist replaces in-source `@rls-not-applicable` annotation.
- Acceptance criteria + Tests required updated; test path corrected to `server/lib/__tests__/`.

### A3
- Steps 1-2 rewritten to use function-local `getOrgScopedDb()` calls (NOT module-top); removed wrong `withOrgTx(orgId, fn)` signature; clarified `withOrgTx` is an entry-point primitive used by middleware/createWorker.
- Step 4 rewritten: acknowledge that `verify-rls-contract-compliance.sh` allowlists `server/services/**` so it does NOT catch service-level raw-`db` regressions; A2's gate is the eventual backstop.

### B2
- Risk section: `Jest --repeats 10` → `tsx` repeat loop in test file or shell-script re-invocation.

### C4
- Approach rewritten: pre-A1 path keeps the import + corrected comment; post-A1 path removes the import entirely (no annotation needed under A1's call-site granularity).

### D1
- Step 1 wording corrected: "first parent of merge commit `f824a03` — `f824a03^1`".
- Files + Acceptance: pinned baseline output to `tasks/builds/audit-remediation/progress.md`; explicit "do NOT amend merged source spec" note.

### D3
- Approach: dropped `@no-read-path` annotation (gate has no per-entry parser). Default path is "add explicit `readPath: 'none' as const`" using the gate's interface definition. Gate-rewrite documented as a separate fallback task.
- Acceptance simplified to "matching action/readPath counts".

### E2
- Approach step 3: `scripts/baselines/integration-reference.txt` → `scripts/guard-baselines.json` (existing centralized store).
- Acceptance updated to match.

### F2
- Removed `kvStoreWithTtlService.ts` invention.
- Rewrote F2 as a consumer-only migration onto `rateLimitStoreService` (Phase-5A primitive named in source spec §8.1).
- Three sub-cases handled: (a) Phase-5A merged + general API → migrate; (b) Phase-5A merged + shape-specific → defer; (c) Phase-5A unmerged → defer.
- Removed multi-process integration test (outside carved-out envelope); manual restart-durability smoke step instead.
- Files list: no new files, no new schema, no new migration.
- §2 Sequencing row, §3 Out-of-scope language, §4 DoD table row, §5 Tracking row updated.

### G1
- "Staging" references → "disposable database / local dev DB" throughout Approach + Acceptance.
- Test writes wrapped in `BEGIN…ROLLBACK` envelope.
- Risk language corrected: "verification-by-controlled-write" instead of "read-only".

## Rejected findings

None. All 20 findings accepted as mechanical (with one finding's directional component resolved inline via F2 manual-smoke replacement).

## Directional / ambiguous findings (autonomously decided)

[AUTO-DECIDED - reject inline] F2 multi-process integration test
  Reasoning: outside the carved-out integration-test envelope (RLS / idempotency / crash-resume per framing assumption #2). Restart durability is verifiable via manual smoke; multi-process correctness is the responsibility of `rateLimitStoreService`'s own tests, not F2's.
  → No tasks/todo.md entry — fully resolved by F2 rewrite to manual smoke step.

## Counts

- mechanical_accepted: 20
- mechanical_rejected: 0
- directional_or_ambiguous: 1 (resolved inline)

## Iteration 1 Summary

- Mechanical findings accepted: 20
- Mechanical findings rejected: 0
- Directional findings: 1 (inline)
- Ambiguous findings: 0
- Reclassified → directional: 1 (partial — F2 multi-process from Codex X-cut #2)
- Autonomous decisions: 1 (AUTO-DECIDED inline)
- Spec commit after iteration: <set after commit>
