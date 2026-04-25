# Spec Review Iteration 2 — codebase-audit-remediation-spec

**Spec commit at start:** 879fff56 (after iter1)
**Iteration:** 2 of MAX_ITERATIONS=5
**Codex output:** tasks/review-logs/_spec-review-codebase-audit-remediation-iter2-codex-output.txt

## Codex findings (7 — all downstream of iter1 edits)

### FINDING #1 — §1 / §8.1 / §15.3 — new primitive vs "zero new primitives" claim
- Source: Codex
- Section: §1 line 101, §15.3 (line 1729 area)
- Description: §1 and §15.3 claim "no new service layers or primitives are introduced by this spec" / "introduces zero new architectural primitives". §8.1 (after iter1 rewrite) now introduces server/lib/rateLimitStore.ts as a new shared primitive.
- Codex's suggested fix: Either justify rateLimitStore.ts as a narrow exception with a "why not extend" paragraph, or rewrite §8.1 to reuse an existing primitive.
- Verified: Confirmed in spec — both statements coexist after iter1.
- Classification: mechanical
- Reasoning: Internal contradiction directly created by iter1's §8.1 rewrite. The §15.3 claim is overstated even before iter1 (the spec did already introduce briefVisibilityService, onboardingStateService, etc.); the right fix is to soften both §1 and §15.3 from "zero new primitives" to "every new primitive has a why-not-extend justification" — which the spec template already requires per §docs/spec-authoring-checklist.md §1. Add the why-not-extend paragraph for rateLimitStore.ts. Surgical wording fix.
- Disposition: auto-apply

### FINDING #2 — §4.1 / §9.1 SQL skeleton hand-waves 6 of 8 tables
- Source: Codex
- Section: §4.1 SQL skeleton
- Description: Iter1 enumerated memory_review_queue and drop_zone_upload_audit but left "repeat for the others" for the remaining 6.
- Codex's suggested fix: Replace placeholders with eight explicit table blocks.
- Verified: Confirmed — iter1 left the rest as a comment-block hand-wave.
- Classification: mechanical
- Reasoning: Spec correctness depends on exact policy names; "repeat" for 6 tables is exactly the failure-mode the historical-policy-name DROP discipline was meant to prevent. Enumerate all 8 explicitly.
- Disposition: auto-apply

### FINDING #3 — §3.1 / §3.5 / §4.5 0202/0203 reconciliation
- Source: Codex
- Section: §3.1 + §3.5 vs §4.5
- Description: §3.1 reconciliation includes 8 historical-noise entries (0202–0208 + 0212). §3.5 lists 14 migrations including 0202/0203. §4.5 explicitly excludes 0202/0203 from the baseline allowlist (says they are not historical noise). The math in §3.1 is "47 + 8 + 2 + 8 - 2 = 63" — the +8 historical-noise count assumes 0202–0208 + 0212 (8 files) are noise. But §4.5 says only 6 are noise (0204–0208 + 0212).
- Codex's suggested fix: Pick one answer and align all three sections.
- Verified: Confirmed — the +8 historical-noise count in §3.1 conflicts with the §4.5 "six files" finding.
- Classification: mechanical
- Reasoning: Internal arithmetic-and-narrative contradiction. The §4.5 "six files" answer is the one supported by repo evidence (0202/0203 don't have phantom-var policies; they were the original creation migrations for reference_documents/reference_document_versions, repaired BY 0213 not before it). Update §3.1 reconciliation: 8 → 6 historical-noise entries. Recompute: 47 + 8 + 2 + 6 - 2 = 61. Or check §3.5 count delta carefully. Surgical math fix.
- Disposition: auto-apply

### FINDING #4 — §5.4 / §12.2 ghlWebhook iter1 correction did not fully cascade
- Source: Codex
- Section: §5.4 fix-per-file table preceding paragraph + §12.2 entry
- Description: §5.4 still says ghlWebhook "receives req.orgId from auth middleware" (the table caller-context column), and §12.2 still says "Use fromOrgId(req.orgId!, subaccountId)".
- Codex's suggested fix: Normalize all references to the unauthenticated HMAC lookup flow.
- Verified: Confirmed — the iter1 fix touched the fix-per-file row but not the caller-context preceding paragraph or §12.2.
- Classification: mechanical
- Reasoning: Iter1 cascade incomplete. Fix the remaining references.
- Disposition: auto-apply

### FINDING #5 — §9.2 rate-limit-buckets contract stale
- Source: Codex
- Section: §9.2
- Description: §9.2 names server/lib/testRunRateLimit.ts as Producer (after iter1's §8.1 rewrite, the actual producer is server/lib/rateLimitStore.ts).
- Codex's suggested fix: Rewrite §9.2 with rateLimitStore.ts as producer/contract surface; list testRunRateLimit / formSubmission / pageTracking as callers.
- Verified: Confirmed — §9.2 was not updated in iter1.
- Classification: mechanical
- Reasoning: Iter1 missed cascade to §9.2. Fix.
- Disposition: auto-apply

### FINDING #6 — §10.1 / §13.5 test plan drift
- Source: Codex
- Section: §10.1 + §13.5
- Description: §12.1 (after iter1) lists rateLimitStore.test.ts + testRunRateLimit.test.ts as separate test files. §10.1's "Tests that ARE added" table only has the testRunRateLimit one. §13.5 says "All four pure-function tests in §10.1 exist and pass" — but §10.1 actually lists only 4 entries; the new rateLimitStore one is missing.
- Codex's suggested fix: Add rateLimitStore.test.ts to §10.1; ensure §13.5 count is consistent.
- Verified: Confirmed.
- Classification: mechanical
- Reasoning: Iter1 cascade incomplete. Fix.
- Disposition: auto-apply

### FINDING #7 — §2.5 / §8.1 / §8.4 / §13.5 <NNNN> placeholder concurrent-PR race
- Source: Codex
- Section: §2.5 + §8.1 + §8.4 + §13.5
- Description: "Pick the next available number at PR-open time" allows concurrent Phase 5 PRs to claim the same migration number before either merges.
- Codex's suggested fix: Change rule to "assign/renumber immediately before merge/rebase onto latest main"; add to PR checklist.
- Verified: Confirmed — current rule wording allows concurrent collision.
- Classification: mechanical
- Reasoning: Real but bounded sequencing risk. The fix is to clarify "assign at merge time, after rebase against main" rather than at open time. Add to §2.5 (migration discipline) since that's the canonical rule home.
- Disposition: auto-apply

## Iteration 2 classification summary

- Codex findings: 7
- Rubric findings: 0 (claude's pass surfaced nothing not already raised by Codex)
- Total: 7
- All mechanical. All auto-apply.
- mechanical_accepted: 7
- mechanical_rejected: 0
- directional: 0
- ambiguous: 0
- reclassified -> directional: 0


## Iteration 2 Summary

- Mechanical findings accepted:    7
- Mechanical findings rejected:    0
- Directional findings:            0
- Ambiguous findings:              0
- Reclassified -> directional:     0
- Autonomous decisions:            0

### Notable mechanical edits

- §1 / §15.3 — softened "no new primitives" claim to acknowledge §4.2 service relocations + Phase 5 §8.1 rateLimitStore.ts; added explicit "why not reuse" paragraph in §8.1.
- §4.1 — fully enumerated all 8 table blocks in the SQL skeleton (no more "repeat for the others" hand-wave).
- §3.1 — corrected math reconciliation: 47 + 8 + 2 + 6 - 2 = 61, plus +2 §4.5 gate-baseline deliverables = 63. 0202/0203 explicitly excluded from historical-noise set.
- §5.4 caller-context table + §12.2 — full ghlWebhook cascade: removed all `req.orgId` references, replaced with `config.organisationId` / `dbAccount.subaccountId` lookup pattern.
- §9.2 — rewrote Producer/Consumer surface around rateLimitStore.ts; testRunRateLimit and the public routes now listed as callers.
- §10.1 — added rateLimitStore.test.ts row separately from testRunRateLimit.test.ts; tests now match §12 inventory.
- §13.5 — updated test count from "four" to "five" to match expanded test plan.
- §2.5 — added concurrent-PR migration-number assignment rule (rename at merge time, not open time).

